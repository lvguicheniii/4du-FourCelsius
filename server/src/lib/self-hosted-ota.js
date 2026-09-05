const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function safeSegment(value, fallback = '') {
  const normalized = String(value || fallback).trim();
  return /^[A-Za-z0-9._-]{1,100}$/.test(normalized) ? normalized : '';
}

function assetContentType(extension) {
  const types = {
    hbc: 'application/javascript', js: 'application/javascript', json: 'application/json',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    svg: 'image/svg+xml', xml: 'application/xml', ttf: 'font/ttf', otf: 'font/otf',
    mp3: 'audio/mpeg', mp4: 'video/mp4', mov: 'video/quicktime', wav: 'audio/wav',
  };
  return types[String(extension || '').toLowerCase()] || 'application/octet-stream';
}

function sha256Base64Url(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('base64url');
}

function resolveChannelManifest(rootDirectory, channel, platform, runtimeVersion) {
  const safeChannel = safeSegment(channel, 'production');
  const safePlatform = safeSegment(platform);
  const safeRuntime = safeSegment(runtimeVersion);
  if (!safeChannel || !['android', 'ios'].includes(safePlatform) || !safeRuntime) return null;
  const filePath = path.join(rootDirectory, 'channels', safeChannel, safePlatform, `${safeRuntime}.json`);
  try {
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (manifest?.runtimeVersion !== safeRuntime || manifest?.platform !== safePlatform) return null;
    return manifest;
  } catch {
    return null;
  }
}

function buildClientManifest(storedManifest, publicOrigin) {
  const assetUrl = (asset) => `${publicOrigin}/api/app-updates/ota/assets/${asset.key}`;
  const mapAsset = (asset) => ({
    hash: asset.hash,
    key: asset.key,
    fileExtension: asset.fileExtension,
    contentType: asset.contentType || assetContentType(asset.fileExtension),
    url: assetUrl(asset),
  });
  return {
    id: storedManifest.id,
    createdAt: storedManifest.createdAt,
    runtimeVersion: storedManifest.runtimeVersion,
    launchAsset: mapAsset(storedManifest.launchAsset),
    assets: (storedManifest.assets || []).map(mapAsset),
    metadata: {
      updateGroup: storedManifest.groupId,
      branchName: storedManifest.channel,
    },
    extra: {
      expoClient: storedManifest.expoClient || {},
      sidu: {
        source: 'tencent-self-hosted',
        versionName: storedManifest.versionName,
      },
    },
  };
}

function codeSigningHeader(storedManifest, clientManifestBody) {
  const signing = storedManifest?.codeSigning;
  if (!signing || signing.keyId !== 'main' || signing.algorithm !== 'rsa-v1_5-sha256') return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(String(signing.signature || ''))) return null;
  const digest = crypto.createHash('sha256').update(clientManifestBody).digest('hex');
  if (digest !== signing.manifestSha256) return null;
  return `sig="${signing.signature}", keyid="main", alg="rsa-v1_5-sha256"`;
}

module.exports = {
  assetContentType,
  buildClientManifest,
  codeSigningHeader,
  resolveChannelManifest,
  safeSegment,
  sha256Base64Url,
};
