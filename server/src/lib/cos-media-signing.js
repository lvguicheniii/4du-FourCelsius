const COS = require('cos-nodejs-sdk-v5');

const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const MAX_CACHE_ENTRIES = 10000;

function boundedTtl(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.max(60, Math.min(7 * 24 * 60 * 60, Math.floor(parsed)));
}

function createCosMediaSigner(options = {}) {
  const secretId = String(options.secretId ?? process.env.COS_SECRET_ID ?? '').trim();
  const secretKey = String(options.secretKey ?? process.env.COS_SECRET_KEY ?? '').trim();
  const bucket = String(options.bucket ?? process.env.COS_BUCKET ?? '').trim();
  const region = String(options.region ?? process.env.COS_REGION ?? '').trim();
  const ttlSeconds = boundedTtl(options.ttlSeconds ?? process.env.COS_SIGNED_URL_TTL_SECONDS);
  const enabled = Boolean(secretId && secretKey && bucket && region);
  const host = enabled ? `${bucket}.cos.${region}.myqcloud.com`.toLowerCase() : '';
  const cos = enabled ? new COS({ SecretId: secretId, SecretKey: secretKey }) : null;
  const signedUrlCache = new Map();

  function objectKeyFromUrl(value) {
    if (!enabled || typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
    try {
      const parsed = new URL(value);
      if (parsed.hostname.toLowerCase() !== host) return null;
      const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      return key || null;
    } catch {
      return null;
    }
  }

  function pruneCache(now) {
    if (signedUrlCache.size < MAX_CACHE_ENTRIES) return;
    for (const [key, entry] of signedUrlCache) {
      if (entry.refreshAt <= now) signedUrlCache.delete(key);
    }
    if (signedUrlCache.size >= MAX_CACHE_ENTRIES) signedUrlCache.clear();
  }

  function signUrl(value) {
    const key = objectKeyFromUrl(value);
    if (!key) return value;
    const now = Date.now();
    const cached = signedUrlCache.get(key);
    if (cached && cached.refreshAt > now) return cached.url;
    pruneCache(now);
    const url = cos.getObjectUrl({
      Bucket: bucket,
      Region: region,
      Key: key,
      Method: 'GET',
      Sign: true,
      Expires: ttlSeconds,
      Protocol: 'https:',
    });
    const refreshMarginMs = Math.min(5 * 60 * 1000, Math.floor(ttlSeconds * 1000 / 2));
    signedUrlCache.set(key, {
      url,
      refreshAt: now + ttlSeconds * 1000 - refreshMarginMs,
    });
    return url;
  }

  function signPayload(value, transformedObjects = new WeakMap()) {
    if (!enabled) return value;
    if (typeof value === 'string') {
      const signed = signUrl(value);
      if (signed !== value) return signed;
      if (!value.includes(host) || !/^[\[{]/.test(value.trim())) return value;
      try {
        const parsed = JSON.parse(value);
        const transformed = signPayload(parsed, transformedObjects);
        return JSON.stringify(transformed);
      } catch {
        return value;
      }
    }
    if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
    if (transformedObjects.has(value)) return transformedObjects.get(value);
    const transformed = Array.isArray(value) ? [] : {};
    transformedObjects.set(value, transformed);
    if (Array.isArray(value)) {
      for (const item of value) transformed.push(signPayload(item, transformedObjects));
      return transformed;
    }
    for (const [key, item] of Object.entries(value)) transformed[key] = signPayload(item, transformedObjects);
    return transformed;
  }

  return {
    enabled,
    host,
    ttlSeconds,
    objectKeyFromUrl,
    signUrl,
    signPayload,
  };
}

const defaultSigner = createCosMediaSigner();

function signApiMediaResponses(req, res, next) {
  // Upload responses must keep canonical, unsigned URLs because clients persist
  // those values in posts and messages before the read API signs them.
  if (req.originalUrl.split('?')[0].startsWith('/api/upload')) return next();
  const originalJson = res.json;
  res.json = function signedJson(body) {
    return originalJson.call(this, defaultSigner.signPayload(body));
  };
  next();
}

module.exports = {
  createCosMediaSigner,
  defaultSigner,
  signApiMediaResponses,
};
