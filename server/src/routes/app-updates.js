const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { buildClientManifest, codeSigningHeader, resolveChannelManifest } = require('../lib/self-hosted-ota');
const { baseVersionName, mergePublicUpdateLogs } = require('../lib/update-log-groups');

const DEFAULT_PUBLIC_ORIGIN = process.env.APP_UPDATE_PUBLIC_ORIGIN || 'http://localhost:3001';
const ANDROID_EMBEDDED_OTA_MINIMUM_BUILD = Object.freeze({
  '00000000-0000-4000-8000-000000000013': 13,
});

function isAndroidOtaIncludedInNativeBuild(versionCode, updateId) {
  const minimumBuild = ANDROID_EMBEDDED_OTA_MINIMUM_BUILD[String(updateId || '').trim().toLowerCase()];
  return Number.isSafeInteger(minimumBuild) && versionCode >= minimumBuild;
}

function safeHeader(req, name, fallback = '') {
  const value = String(req.get(name) || fallback).trim();
  return value.replace(/[\r\n]/g, '');
}

function expoRequestHeaders(req) {
  return {
    Accept: safeHeader(req, 'Accept', 'multipart/mixed,application/expo+json,application/json'),
    'Expo-Platform': safeHeader(req, 'Expo-Platform', 'android'),
    'Expo-Runtime-Version': safeHeader(req, 'Expo-Runtime-Version'),
    'Expo-Protocol-Version': safeHeader(req, 'Expo-Protocol-Version', '1'),
    'expo-channel-name': safeHeader(req, 'expo-channel-name', 'production'),
  };
}

function validAssetKey(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function validAndroidRelease(release) {
  if (!release) return false;
  let parsedUrl;
  try {
    parsedUrl = new URL(String(release.apk_url || ''));
  } catch {
    return false;
  }
  return parsedUrl.protocol === 'https:'
    && !parsedUrl.username
    && !parsedUrl.password
    && Number.isSafeInteger(release.file_size)
    && release.file_size > 0
    && release.file_size <= 1024 * 1024 * 1024
    && /^[a-f0-9]{32}$/i.test(String(release.md5 || ''))
    && /^[a-f0-9]{64}$/i.test(String(release.sha256 || ''));
}

function createAppUpdateRouter(db, options = {}) {
  const router = Router();
  const publicOrigin = String(
    options.publicOrigin || process.env.APP_UPDATE_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN,
  ).replace(/\/$/, '');
  const otaRootDirectory = options.otaRootDirectory
    || process.env.OTA_SELF_HOSTED_DIR
    || path.join(__dirname, '..', '..', '.cache', 'ota-self-hosted');
  const cacheDirectory = path.join(otaRootDirectory, 'assets');
  const accelRedirectEnabled = options.accelRedirect == null
    ? process.env.OTA_X_ACCEL_ENABLED === 'true'
    : !!options.accelRedirect;

  function serveCachedAsset(res, key, cachePath, cacheSize, contentType = 'application/octet-stream') {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Content-Type', contentType);
    if (accelRedirectEnabled) {
      res.set('X-Accel-Redirect', `/_ota-self-hosted-assets/${key}`);
      return res.status(200).end();
    }
    res.set('Content-Length', String(cacheSize));
    return fs.createReadStream(cachePath).pipe(res);
  }

  router.get('/ota/assets/:key', (req, res) => {
    const key = String(req.params.key || '');
    if (!validAssetKey(key)) return res.status(400).json({ error: '无效的更新资源标识' });

    const cachePath = path.join(cacheDirectory, key);
    if (!fs.existsSync(cachePath)) return res.status(404).json({ error: '更新资源不存在' });
    const cacheSize = fs.statSync(cachePath).size;
    if (cacheSize <= 0) return res.status(404).json({ error: '更新资源无效' });
    return serveCachedAsset(res, key, cachePath, cacheSize);
  });

  router.get('/ota', async (req, res, next) => {
    try {
      const headers = expoRequestHeaders(req);
      const stored = resolveChannelManifest(
        otaRootDirectory,
        headers['expo-channel-name'],
        headers['Expo-Platform'],
        headers['Expo-Runtime-Version'],
      );
      if (!stored) return res.status(404).json({ error: '当前运行时暂无可用更新' });
      const manifest = buildClientManifest(stored, publicOrigin);
      const manifestBody = JSON.stringify(manifest);
      const signature = codeSigningHeader(stored, manifestBody);
      if (safeHeader(req, 'Expo-Expect-Signature') && !signature) {
        return res.status(404).json({ error: '当前运行时暂无已签名更新' });
      }
      res.set('Content-Type', 'application/expo+json');
      res.set('Expo-Protocol-Version', '1');
      res.set('Expo-SFV-Version', '0');
      res.set('Expo-Update-ID', stored.id);
      res.set('X-Sidu-OTA-Source', 'tencent-self-hosted');
      if (signature) res.set('Expo-Signature', signature);
      res.set('Cache-Control', 'no-cache, private, max-age=10');
      return res.send(manifestBody);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/history', (req, res) => {
    const logs = db.prepare(`
      SELECT version_name AS versionName,title,release_notes AS releaseNotes,
             release_date AS releaseDate,stage,platform
      FROM app_update_logs
      WHERE is_visible=1
      ORDER BY release_date DESC, created_at DESC
      LIMIT 200
    `).all();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ logs: mergePublicUpdateLogs(logs) });
  });

  router.get('/running/:updateId', (req, res) => {
    const updateId = String(req.params.updateId || '').trim().toLowerCase();
    if (!/^[a-f0-9-]{36}$/.test(updateId)) return res.status(400).json({ error: '无效的更新标识' });
    const log = db.prepare(`
      SELECT version_name AS versionName,title,release_notes AS releaseNotes,
             release_date AS releaseDate,stage,platform,runtime_version AS runtimeVersion
      FROM app_update_logs
      WHERE update_id=? AND is_visible=1
      LIMIT 1
    `).get(updateId);
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ log: log ? { ...log, versionName: baseVersionName(log.versionName) } : null });
  });

  router.get('/native/:platform/:versionName', (req, res) => {
    const platform = String(req.params.platform || '').trim().toLowerCase();
    const versionName = String(req.params.versionName || '').trim();
    if (!['android', 'ios'].includes(platform) || !/^[0-9A-Za-z._-]{1,60}$/.test(versionName)) {
      return res.status(400).json({ error: '无效的原生版本标识' });
    }
    const log = db.prepare(`
      SELECT version_name AS versionName,title,release_notes AS releaseNotes,
             release_date AS releaseDate,stage,platform,runtime_version AS runtimeVersion
      FROM app_update_logs
      WHERE version_name=? AND stage='production' AND is_visible=1
        AND platform IN (?, 'all')
      LIMIT 1
    `).get(versionName, platform);
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ log: log ? { ...log, versionName: baseVersionName(log.versionName) } : null });
  });

  router.get('/android/latest', (req, res) => {
    const currentVersionCode = positiveInteger(req.query.versionCode);
    const runtimeVersion = String(req.query.runtimeVersion || '').trim();
    const currentUpdateId = String(req.query.updateId || '').trim().toLowerCase();
    const release = db.prepare(`
      SELECT version_code,version_name,runtime_version,apk_url,file_size,md5,sha256,
             release_notes,mandatory,published_at
      FROM app_releases
      WHERE platform='android' AND is_active=1 AND apk_url!=''
      ORDER BY version_code DESC
      LIMIT 1
    `).get();

    let ota = { available: null };
    if (runtimeVersion && runtimeVersion.length <= 100) {
      const latestOta = db.prepare(`
        SELECT update_id AS updateId,version_name AS versionName,release_date AS releaseDate
        FROM app_update_logs
        WHERE is_visible=1 AND update_id IS NOT NULL AND update_id!=''
          AND runtime_version=? AND platform IN ('android','all')
        ORDER BY release_date DESC, created_at DESC
        LIMIT 1
      `).get(runtimeVersion);
      if (latestOta) {
        ota = {
          available: latestOta.updateId.toLowerCase() !== currentUpdateId
            && !isAndroidOtaIncludedInNativeBuild(currentVersionCode, latestOta.updateId),
          latestUpdateId: latestOta.updateId,
          versionName: baseVersionName(latestOta.versionName),
          releaseDate: latestOta.releaseDate,
        };
      } else {
        // An exact runtime with no published OTA is a confirmed no-update
        // state. Returning null would make the client call the Expo endpoint,
        // where the intentionally missing manifest is a 404.
        ota = { available: false };
      }
    }

    res.set('Cache-Control', 'no-store');
    if (!validAndroidRelease(release)) {
      return res.json({ available: false, currentVersionCode, ota });
    }

    const available = release.version_code > currentVersionCode;
    return res.json({
      available,
      currentVersionCode,
      ota,
      release: available ? {
        versionCode: release.version_code,
        versionName: release.version_name,
        runtimeVersion: release.runtime_version,
        apkUrl: release.apk_url,
        fileSize: release.file_size,
        md5: release.md5,
        sha256: release.sha256,
        releaseNotes: release.release_notes,
        mandatory: !!release.mandatory,
        publishedAt: release.published_at,
      } : null,
    });
  });

  return router;
}

module.exports = createAppUpdateRouter;
module.exports.validAssetKey = validAssetKey;
module.exports.validAndroidRelease = validAndroidRelease;
module.exports.isAndroidOtaIncludedInNativeBuild = isAndroidOtaIncludedInNativeBuild;
