const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { auth } = require('../middleware/auth');
const COS = require('cos-nodejs-sdk-v5');
const sharp = require('sharp');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { idempotent } = require('../middleware/idempotency');
const { VIDEO_LIMITS, createTranscodeArgs, policyError, validateVideoMetadata } = require('../lib/video-policy');
const { isFeatureEnabled } = require('../lib/feature-flags');
const { rateLimit } = require('../middleware/rate-limit');
const { concurrencyLimit } = require('../middleware/concurrency-limit');
const { reserveDailyUpload } = require('../lib/upload-quota');
const { getMediaRuntime } = require('../lib/media-runtime');
const { findEmbeddedMp4Ranges } = require('../lib/motion-photo');

const router = Router();

// Validate the configured or packaged binaries before accepting uploads. A
// broken packaged binary falls back to the host runtime instead of taking all
// video and motion-photo uploads down with it.
const { ffmpegPath, ffprobePath } = getMediaRuntime();

const cos = new COS({
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY,
});

const BUCKET = process.env.COS_BUCKET;
const REGION = process.env.COS_REGION;

const tmpDir = path.join(__dirname, '..', '..', 'tmp');
const localUploadRoot = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
if (!fs.existsSync(localUploadRoot)) fs.mkdirSync(localUploadRoot, { recursive: true });

const IMAGE_TYPES = new Set(['p', 'a', 'c', 's', 'm', 'f']);
const VIDEO_TYPES = new Set(['v', 'vp', 'vm', 'vr']);
const IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const IMAGE_MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/gif', '.gif'],
  ['image/webp', '.webp'], ['image/bmp', '.bmp'], ['image/heic', '.heic'], ['image/heif', '.heif'],
]);
const MAX_IMAGE_BYTES = Math.max(1024 * 1024, Number(process.env.MAX_IMAGE_UPLOAD_BYTES) || 15 * 1024 * 1024);
const MAX_IMAGE_PIXELS = Math.max(4_000_000, Number(process.env.MAX_IMAGE_PIXELS) || 40_000_000);
const MAX_TRANSCODES = Math.max(1, Math.min(4, Number(process.env.MEDIA_TRANSCODE_CONCURRENCY) || 2));
let activeTranscodes = 0;
const transcodeWaiters = [];
const MAX_IMAGE_PROCESSING = Math.max(1, Math.min(8, Number(process.env.IMAGE_PROCESSING_CONCURRENCY) || 4));
let activeImageProcessing = 0;
const imageProcessingWaiters = [];
const uploadRateLimit = rateLimit({ scope: 'upload.file', limit: 30, windowMs: 60 * 60 * 1000 });
const uploadConcurrencyLimit = concurrencyLimit({ scope: 'media-upload', limit: 40 });

function requireStandaloneVideo(req, res, next) {
  if (!isFeatureEnabled('video_upload', req.userId)) {
    return res.status(403).json({ error: '普通视频功能暂未开放' });
  }
  return next();
}

function gateVideoUpload(req, res, next) {
  const type = String(req.query.type || req.body?.type || 'p');
  const isLivePhotoMotion = String(req.query.livePhoto || '') === '1';
  return VIDEO_TYPES.has(type) && !isLivePhotoMotion ? requireStandaloneVideo(req, res, next) : next();
}

async function withTranscodeSlot(task) {
  if (activeTranscodes >= MAX_TRANSCODES) await new Promise(resolve => transcodeWaiters.push(resolve));
  activeTranscodes += 1;
  try { return await task(); }
  finally {
    activeTranscodes -= 1;
    transcodeWaiters.shift()?.();
  }
}

function resolvedUploadExtension(file) {
  const originalExtension = path.extname(file.originalname || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(originalExtension) || VIDEO_EXTENSIONS.has(originalExtension)) return originalExtension;
  return IMAGE_MIME_EXTENSIONS.get(String(file.mimetype || '').toLowerCase()) || originalExtension || '.jpg';
}

async function withImageProcessingSlot(task) {
  if (activeImageProcessing >= MAX_IMAGE_PROCESSING) {
    await new Promise(resolve => imageProcessingWaiters.push(resolve));
  }
  activeImageProcessing += 1;
  try { return await task(); }
  finally {
    activeImageProcessing -= 1;
    imageProcessingWaiters.shift()?.();
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tmpDir),
  filename: (req, file, cb) => {
    const ext = resolvedUploadExtension(file);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: VIDEO_LIMITS.maxInputBytes },
  fileFilter: (req, file, cb) => {
    const type = String(req.query.type || req.body?.type || 'p');
    const ext = path.extname(file.originalname).toLowerCase();
    const inferredImageExtension = IMAGE_MIME_EXTENSIONS.get(String(file.mimetype || '').toLowerCase());
    const image = IMAGE_TYPES.has(type) && /^image\//i.test(file.mimetype) && (IMAGE_EXTENSIONS.has(ext) || !!inferredImageExtension);
    const video = VIDEO_TYPES.has(type) && VIDEO_EXTENSIONS.has(ext) && /^video\//i.test(file.mimetype);
    if (image || video) return cb(null, true);
    cb(new Error('仅支持图片文件'));
  },
});

const motionPhotoUpload = multer({
  storage,
  limits: { fileSize: VIDEO_LIMITS.livePhotoMaxInputBytes },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext) && /^image\//i.test(file.mimetype)) return cb(null, true);
    cb(new Error('Motion photo source must be an image'));
  },
});

const TYPE_DIRS = {
  p: 'posts', a: 'avatars', c: 'covers', s: 'stickers', m: 'messages', f: 'feedback',
  v: 'videos', vp: 'videos/posts', vm: 'videos/messages', vr: 'videos/reefs',
};
const THUMB_WIDTH = 400;

function buildFilename(type, uid, ext) {
  const now = new Date();
  const y = String(now.getFullYear()).slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const M = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  // Multiple files can arrive within the same second. A unique suffix keeps
  // concurrent uploads from sharing and deleting the same temporary path.
  const unique = uuid().slice(0, 8);
  return `${type}_${uid}_${y}${m}${d}${h}${M}${s}_${unique}${ext}`;
}

function uploadToCOS(localPath, cosKey, contentType) {
  return new Promise((resolve, reject) => {
    const options = {
      Bucket: BUCKET,
      Region: REGION,
      Key: cosKey,
      Body: fs.createReadStream(localPath),
      ContentLength: fs.statSync(localPath).size,
      ...(contentType ? { ContentType: contentType } : {}),
    };
    cos.putObject(options, (err) => {
      if (err) return reject(err);
      fs.unlink(localPath, () => {});
      resolve(`https://${BUCKET}.cos.${REGION}.myqcloud.com/${cosKey}`);
    });
  });
}

function persistLocally(localPath, uid, dirName, filename) {
  const relativeDir = path.join('USERS', uid, dirName);
  const targetDir = path.join(localUploadRoot, relativeDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, filename);
  fs.renameSync(localPath, targetPath);
  return `/uploads/${relativeDir.replace(/\\/g, '/')}/${filename}`;
}

function storageUnavailable(cause) {
  const error = new Error('媒体存储暂时不可用，请稍后重试');
  error.statusCode = 503;
  error.code = 'MEDIA_STORAGE_UNAVAILABLE';
  error.cause = cause;
  return error;
}

async function storeUserAsset(localPath, uid, dirName, filename, contentType) {
  const cosConfigured = Boolean(BUCKET && REGION && process.env.COS_SECRET_ID && process.env.COS_SECRET_KEY);
  if (cosConfigured) {
    try {
      return await uploadToCOS(localPath, `USERS/${uid}/${dirName}/${filename}`, contentType);
    } catch (error) {
      console.error('COS user media upload failed:', error?.message || error);
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_MEDIA_FALLBACK !== 'true') {
        throw storageUnavailable(error);
      }
    }
  } else if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_MEDIA_FALLBACK !== 'true') {
    throw storageUnavailable(new Error('COS is not configured'));
  }
  return persistLocally(localPath, uid, dirName, filename);
}

function assertSafeImageMetadata(metadata) {
  const width = Number(metadata?.width) || 0;
  const pageHeight = Number(metadata?.pageHeight || metadata?.height) || 0;
  const pages = Math.max(1, Number(metadata?.pages) || 1);
  const totalPixels = width * pageHeight * pages;
  if (!width || !pageHeight || totalPixels > MAX_IMAGE_PIXELS) {
    const error = new Error('图片尺寸过大或格式无效');
    error.statusCode = 413;
    throw error;
  }
}

async function normalizeImage(file) {
  const input = sharp(file.path, {
    animated: true,
    failOn: 'error',
    limitInputPixels: MAX_IMAGE_PIXELS,
  });
  const metadata = await input.metadata();
  assertSafeImageMetadata(metadata);
  const animated = Number(metadata.pages || 1) > 1;
  let extension;
  let mimeType;
  let pipeline = input.rotate();
  if (animated && metadata.format === 'gif') {
    extension = '.gif';
    mimeType = 'image/gif';
    pipeline = pipeline.gif({ effort: 3, reuse: true });
  } else if (animated) {
    extension = '.webp';
    mimeType = 'image/webp';
    pipeline = pipeline.webp({ quality: 88, effort: 4 });
  } else if (metadata.format === 'png') {
    extension = '.png';
    mimeType = 'image/png';
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else if (metadata.format === 'webp') {
    extension = '.webp';
    mimeType = 'image/webp';
    pipeline = pipeline.webp({ quality: 90, effort: 4 });
  } else {
    extension = '.jpg';
    mimeType = 'image/jpeg';
    pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
  }
  const normalizedPath = path.join(tmpDir, `normalized_${uuid()}${extension}`);
  try {
    const info = await withImageProcessingSlot(() => pipeline.toFile(normalizedPath));
    fs.unlinkSync(file.path);
    file.path = normalizedPath;
    file.filename = path.basename(normalizedPath);
    file.size = Number(info.size) || fs.statSync(normalizedPath).size;
    file.mimetype = mimeType;
    file.originalname = `${path.parse(file.originalname || 'image').name}${extension}`;
    return { width: info.width || metadata.width, height: info.height || metadata.height };
  } catch (error) {
    fs.unlink(normalizedPath, () => {});
    error.statusCode ||= 422;
    throw error;
  }
}

function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    execFile(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', filePath], { windowsHide: true, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        error.mediaStderr = String(stderr || '').trim().slice(-2000);
        return reject(error);
      }
      try {
        const data = JSON.parse(stdout);
        const stream = (data.streams || []).find(item => item.width && item.height) || {};
        resolve({ durationMs: Math.round(Number(data.format?.duration || 0) * 1000), width: Number(stream.width) || null, height: Number(stream.height) || null });
      } catch (parseError) { reject(parseError); }
    });
  });
}

function transcodeVideo(srcPath, destPath, options) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, createTranscodeArgs(srcPath, destPath, options), { windowsHide: true, timeout: 180000 }, (error, _stdout, stderr) => {
      if (error) error.mediaStderr = String(stderr || '').trim().slice(-4000);
      return error ? reject(error) : resolve();
    });
  });
}

function generateVideoPoster(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, ['-y', '-ss', '0.2', '-i', srcPath, '-frames:v', '1', '-vf', "scale=w='min(720,iw)':h=-2", '-q:v', '6', destPath], { windowsHide: true, timeout: 60000 }, (error, _stdout, stderr) => {
      if (error) error.mediaStderr = String(stderr || '').trim().slice(-4000);
      return error ? reject(error) : resolve();
    });
  });
}

/** 生成缩略图并上传到 COS */
async function generateThumbnail(srcPath, uid, dirName, baseFilename) {
  // 缩略图统一输出为 JPEG，并让对象扩展名与真实编码保持一致。
  const thumbFilename = `thumb_${path.parse(baseFilename).name}.jpg`;
  const thumbPath = path.join(tmpDir, thumbFilename);
  const cosKey = `USERS/${uid}/${dirName}/${thumbFilename}`;

  try {
    await withImageProcessingSlot(() => sharp(srcPath)
      .resize(THUMB_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(thumbPath));

    return { path: thumbPath, key: cosKey, filename: thumbFilename };
  } catch (e) {
    console.error('Thumbnail error:', e.message);
    fs.unlink(thumbPath, () => {});
    return null; // 缩略图生成失败不影响主流程
  }
}

router.post('/motion-photo', auth, idempotent('upload.motion-photo'), uploadRateLimit, uploadConcurrencyLimit, motionPhotoUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Please select a motion photo' });
  const context = ['post', 'message', 'reef'].includes(String(req.query.context)) ? String(req.query.context) : 'post';
  const uid = req.userId || 'unknown';
  try {
    reserveDailyUpload(uid, req.file.size);
    const sourceImageMetadata = await sharp(req.file.path, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
    assertSafeImageMetadata(sourceImageMetadata);
  } catch (error) {
    fs.unlink(req.file.path, () => {});
    return res.status(error.statusCode || 422).json({ code: error.code, error: error.message || '动态照片格式无效' });
  }
  const sourceBuffer = fs.readFileSync(req.file.path);
  const videoRanges = findEmbeddedMp4Ranges(sourceBuffer);
  if (!videoRanges.length) {
    fs.unlink(req.file.path, () => {});
    return res.status(422).json({ code: 'NOT_MOTION_PHOTO', error: '所选照片不包含动态内容' });
  }

  const mediaId = `media_${uuid()}`;
  const dirName = `live-photos/${context}s`;
  const stem = buildFilename('lp', uid, '').replace(/\.$/, '');
  const motionFilename = `${stem}_motion.mp4`;
  const motionSourceFilename = `${stem}_motion_source.mp4`;
  const posterFilename = `${stem}_poster.jpg`;
  const motionPath = path.join(tmpDir, motionFilename);
  const motionSourcePath = path.join(tmpDir, motionSourceFilename);
  const posterPath = path.join(tmpDir, posterFilename);
  fs.writeFileSync(motionSourcePath, sourceBuffer.subarray(videoRanges[0].start, videoRanges[0].end));

  try {
    const sourceMetadata = await probeVideo(motionSourcePath);
    validateVideoMetadata(sourceMetadata, { livePhoto: true });
    await withTranscodeSlot(() => Promise.all([
      transcodeVideo(motionSourcePath, motionPath, { livePhoto: true }),
      sharp(req.file.path)
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 76, mozjpeg: true })
        .toFile(posterPath),
    ]));
    fs.unlink(motionSourcePath, () => {});
    const metadata = await probeVideo(motionPath);
    const outputSize = fs.statSync(motionPath).size;
    if (outputSize > VIDEO_LIMITS.maxOutputBytes) throw policyError('处理后的视频仍然过大，请缩短视频后重试', 413);
    const motionKey = `USERS/${uid}/${dirName}/${motionFilename}`;
    const posterKey = `USERS/${uid}/${dirName}/${posterFilename}`;
    const [motionUrl, posterUrl] = await Promise.all([
      storeUserAsset(motionPath, uid, dirName, motionFilename, 'video/mp4'),
      storeUserAsset(posterPath, uid, dirName, posterFilename, 'image/jpeg'),
    ]);
    fs.unlink(req.file.path, () => {});
    const originalUrl = posterUrl;
    db.prepare(`
      INSERT INTO media_assets(id,owner_id,context_type,media_type,original_url,playback_url,still_url,motion_url,poster_url,mime_type,width,height,duration_ms,size_bytes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(mediaId, uid, context, 'live_photo', originalUrl, motionUrl, posterUrl, motionUrl, posterUrl, 'video/mp4', metadata.width, metadata.height, metadata.durationMs, outputSize, 'ready');
    res.status(201).json({ mediaId, mediaType: 'live_photo', originalUrl, motionUrl, stillUrl: posterUrl, posterUrl, width: metadata.width, height: metadata.height, durationMs: metadata.durationMs });
  } catch (error) {
    fs.unlink(req.file.path, () => {});
    fs.unlink(motionPath, () => {});
    fs.unlink(motionSourcePath, () => {});
    fs.unlink(posterPath, () => {});
    console.error('Motion photo processing failed:', {
      code: error?.code || null,
      signal: error?.signal || null,
      message: String(error?.message || error).slice(0, 1000),
      stderr: String(error?.mediaStderr || '').slice(-4000),
    });
    if (error?.statusCode) return res.status(error.statusCode).json({ code: error.code, error: error.message });
    return res.status(500).json({ code: 'MOTION_PHOTO_PROCESSING_FAILED', error: '动态照片处理失败，请稍后重试' });
  }
});

router.post('/', auth, gateVideoUpload, idempotent('upload.file'), uploadRateLimit, uploadConcurrencyLimit, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });

  const type = req.query.type || req.body.type || 'p';
  if (!TYPE_DIRS[type]) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Unknown upload type' });
  }
  if (IMAGE_TYPES.has(type) && req.file.size > MAX_IMAGE_BYTES) {
    fs.unlink(req.file.path, () => {});
    return res.status(413).json({ error: '图片不能超过15MB' });
  }
  const dirName = TYPE_DIRS[type] || 'posts';
  const uid = req.userId || 'unknown';
  const initialExt = resolvedUploadExtension(req.file);
  const isVideo = /^video\//i.test(req.file.mimetype) || /\.(mp4|mov|webm|m4v)$/i.test(initialExt);
  const isLivePhotoMotion = isVideo && String(req.query.livePhoto || '') === '1';
  const generatedTempPaths = [];

  if (isLivePhotoMotion && req.file.size > VIDEO_LIMITS.livePhotoMaxInputBytes) {
    fs.unlink(req.file.path, () => {});
    return res.status(413).json({ error: '实况照片不能超过30MB' });
  }

  try {
    reserveDailyUpload(uid, req.file.size);
    if (!isVideo) await normalizeImage(req.file);
    const ext = resolvedUploadExtension(req.file);
    const filename = buildFilename(type, uid, ext);
    const cosKey = `USERS/${uid}/${dirName}/${filename}`;
    if (isVideo) {
      const base = path.parse(filename).name;
      const playbackFilename = `playback_${base}.mp4`;
      const posterFilename = `poster_${base}.jpg`;
      const playbackPath = path.join(tmpDir, playbackFilename);
      const posterPath = path.join(tmpDir, posterFilename);
      generatedTempPaths.push(playbackPath, posterPath);
      const sourceMetadata = await probeVideo(req.file.path);
      validateVideoMetadata(sourceMetadata, { livePhoto: isLivePhotoMotion });
      await withTranscodeSlot(() => Promise.all([transcodeVideo(req.file.path, playbackPath, { livePhoto: isLivePhotoMotion }), generateVideoPoster(req.file.path, posterPath)]));
      const metadata = await probeVideo(playbackPath);
      const outputSize = fs.statSync(playbackPath).size;
      if (outputSize > VIDEO_LIMITS.maxOutputBytes) throw policyError('处理后的视频仍然过大，请缩短视频后重试', 413);
      const playbackKey = `USERS/${uid}/${dirName}/${playbackFilename}`;
      const posterKey = `USERS/${uid}/${dirName}/${posterFilename}`;
      // Persist only the normalized playback and compressed poster. Keeping
      // the unbounded source would duplicate every video in COS.
      const [playbackUrl, posterUrl] = await Promise.all([
        storeUserAsset(playbackPath, uid, dirName, playbackFilename, 'video/mp4'),
        storeUserAsset(posterPath, uid, dirName, posterFilename, 'image/jpeg'),
      ]);
      fs.unlink(req.file.path, () => {});
      const originalUrl = playbackUrl;
      const mediaId = `media_${uuid()}`;
      const contextType = type === 'vp' ? 'post' : type === 'vm' ? 'message' : type === 'vr' ? 'reef' : 'other';
      db.prepare(`
        INSERT INTO media_assets(id,owner_id,context_type,media_type,original_url,playback_url,poster_url,mime_type,width,height,duration_ms,size_bytes,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(mediaId, uid, contextType, 'video', originalUrl, playbackUrl, posterUrl, 'video/mp4', metadata.width, metadata.height, metadata.durationMs, outputSize, 'ready');
      return res.json({ url: playbackUrl, originalUrl, thumbUrl: posterUrl, filename: playbackFilename, uid, path: playbackKey, mediaId, mediaType: 'video', mimeType: 'video/mp4', width: metadata.width, height: metadata.height, durationMs: metadata.durationMs });
    }
    // 先读取仍存在的本地原图生成缩略图；原图上传成功后才会删除临时文件。
    // 旧顺序会先删掉原图，导致每一次缩略图生成都失败。
    const thumbnail = isVideo ? null : await generateThumbnail(req.file.path, uid, dirName, filename);
    let url;
    let thumbUrl = null;
    url = await storeUserAsset(req.file.path, uid, dirName, filename, req.file.mimetype);
    if (thumbnail) {
      thumbUrl = await storeUserAsset(thumbnail.path, uid, dirName, thumbnail.filename, 'image/jpeg');
    }
    let mediaId = null;
    if (isVideo) {
      mediaId = `media_${uuid()}`;
      const contextType = type === 'vp' ? 'post' : type === 'vm' ? 'message' : type === 'vr' ? 'reef' : 'other';
      db.prepare(`
        INSERT INTO media_assets(id,owner_id,context_type,media_type,original_url,playback_url,mime_type,size_bytes,status)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(mediaId, uid, contextType, 'video', url, url, req.file.mimetype, req.file.size || 0, 'ready');
    }
    res.json({ url, thumbUrl: thumbUrl || null, filename, uid, path: cosKey, mediaId, mediaType: isVideo ? 'video' : 'image', mimeType: req.file.mimetype });
  } catch (e) {
    console.error('COS error:', e);
    fs.unlink(req.file.path, () => {});
    generatedTempPaths.forEach(filePath => fs.unlink(filePath, () => {}));
    res.status(e.statusCode || 500).json({ code: e.code, error: e.message || '文件上传失败' });
  }
});

router.use((error, req, res, next) => {
  if (!(error instanceof multer.MulterError) || error.code !== 'LIMIT_FILE_SIZE') return next(error);
  const isMotionPhoto = req.path.includes('motion-photo');
  return res.status(413).json({ error: isMotionPhoto ? '实况照片不能超过30MB' : '上传文件过大' });
});

router.getPressureStats = () => ({
  imageProcessing: {
    active: activeImageProcessing,
    queued: imageProcessingWaiters.length,
    limit: MAX_IMAGE_PROCESSING,
  },
  videoTranscoding: {
    active: activeTranscodes,
    queued: transcodeWaiters.length,
    limit: MAX_TRANSCODES,
  },
});
router.securityTestHooks = { assertSafeImageMetadata, normalizeImage, storeUserAsset };

module.exports = router;
