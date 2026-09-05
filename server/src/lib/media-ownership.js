function normalizedHost(value) {
  return String(value || '').trim().toLowerCase().replace(/:\d+$/, '');
}

function decodedPathname(value) {
  try {
    const parsed = new URL(String(value), 'http://local.invalid');
    return decodeURIComponent(parsed.pathname).replace(/\\/g, '/');
  } catch {
    return '';
  }
}

function canonicalMediaUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const parsed = new URL(source, 'http://local.invalid');
    const pathname = decodeURIComponent(parsed.pathname);
    return pathname.startsWith('/uploads/') ? pathname : `${normalizedHost(parsed.hostname)}${pathname}`;
  } catch {
    return source.split(/[?#]/, 1)[0];
  }
}

function mediaLocation(value, req) {
  const source = String(value || '').trim();
  if (!source || source.includes('\\') || /[\u0000-\u001f\u007f]/.test(source)) return null;

  const pathname = decodedPathname(source);
  const isCosObject = /^\/USERS\/[^/]+\//.test(pathname);
  const isLocalUpload = /^\/uploads\/USERS\/[^/]+\//.test(pathname);
  if (!isCosObject && !isLocalUpload) return null;

  // Only a single-leading-slash path is local. `//evil.example/...` is a
  // protocol-relative external URL and must never inherit local trust.
  if (source.startsWith('/') && !source.startsWith('//')) {
    return isLocalUpload ? { pathname, type: 'local' } : null;
  }

  let parsed;
  try { parsed = new URL(source); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  const host = normalizedHost(parsed.hostname);

  if (isCosObject) {
    const bucket = String(process.env.COS_BUCKET || '').trim();
    const region = String(process.env.COS_REGION || '').trim();
    const cosHost = bucket && region ? `${bucket}.cos.${region}.myqcloud.com`.toLowerCase() : '';
    return cosHost && host === cosHost ? { pathname, type: 'cos' } : null;
  }

  const requestHosts = [req?.hostname, req?.get?.('host'), req?.get?.('x-forwarded-host')]
    .flatMap(item => String(item || '').split(','))
    .map(normalizedHost)
    .filter(Boolean);
  return requestHosts.includes(host) ? { pathname, type: 'local' } : null;
}

function isApprovedMediaUrl(value, req) {
  return !!mediaLocation(value, req);
}

function isOwnedMediaUrl(value, userId, req) {
  if (!userId) return false;
  const location = mediaLocation(value, req);
  if (!location) return false;
  const { pathname } = location;
  const ownedCosPrefix = `/USERS/${userId}/`;
  const ownedLocalPrefix = `/uploads/USERS/${userId}/`;
  return pathname.startsWith(ownedCosPrefix) || pathname.startsWith(ownedLocalPrefix);
}

function sameMediaUrl(left, right) {
  return !!left && !!right && canonicalMediaUrl(left) === canonicalMediaUrl(right);
}

module.exports = { canonicalMediaUrl, isApprovedMediaUrl, isOwnedMediaUrl, sameMediaUrl };
