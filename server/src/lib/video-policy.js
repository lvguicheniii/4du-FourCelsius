const MEBIBYTE = 1024 * 1024;

const VIDEO_LIMITS = Object.freeze({
  maxInputBytes: 50 * MEBIBYTE,
  maxOutputBytes: 30 * MEBIBYTE,
  maxDurationMs: 60_000,
  livePhotoMaxInputBytes: 30 * MEBIBYTE,
  livePhotoMaxDurationMs: 15_000,
  maxInputLongEdge: 4096,
  maxOutputLongEdge: 1920,
});

function policyError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateVideoMetadata(metadata, { livePhoto = false } = {}) {
  const durationMs = Number(metadata?.durationMs || 0);
  const width = Number(metadata?.width || 0);
  const height = Number(metadata?.height || 0);
  const maxDurationMs = livePhoto ? VIDEO_LIMITS.livePhotoMaxDurationMs : VIDEO_LIMITS.maxDurationMs;

  if (!durationMs) throw policyError('无法读取视频时长，请更换视频后重试');
  if (durationMs > maxDurationMs) {
    throw policyError(livePhoto ? '实况视频时长不能超过15秒' : '视频时长不能超过60秒');
  }
  if (!width || !height) throw policyError('无法读取视频分辨率，请更换视频后重试');
  if (Math.max(width, height) > VIDEO_LIMITS.maxInputLongEdge) {
    throw policyError('视频分辨率不能超过4K（最长边4096像素）');
  }
}

function createTranscodeArgs(srcPath, destPath, { livePhoto = false } = {}) {
  const maxRate = livePhoto ? '2000k' : '3000k';
  const bufferSize = livePhoto ? '4000k' : '6000k';
  return [
    '-y', '-i', srcPath,
    '-map', '0:v:0', '-map', '0:a?',
    '-vf', `scale=${VIDEO_LIMITS.maxOutputLongEdge}:${VIDEO_LIMITS.maxOutputLongEdge}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-maxrate', maxRate, '-bufsize', bufferSize,
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '96k',
    destPath,
  ];
}

module.exports = { VIDEO_LIMITS, createTranscodeArgs, policyError, validateVideoMetadata };
