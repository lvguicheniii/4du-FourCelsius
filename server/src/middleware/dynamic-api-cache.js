const IMMUTABLE_API_PREFIXES = [
  '/notification-assets/',
  '/app-updates/ota/assets/',
];

function isImmutableApiAsset(pathname) {
  const normalized = String(pathname || '');
  return IMMUTABLE_API_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function disableDynamicApiCaching(req, res, next) {
  if (isImmutableApiAsset(req.path)) return next();

  // React Native may retain validators between OTA reloads. Express interprets
  // matching validators as a fresh response and silently converts a JSON 200
  // into an empty 304, which makes every data-driven screen appear blank.
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}

module.exports = {
  disableDynamicApiCaching,
  isImmutableApiAsset,
};
