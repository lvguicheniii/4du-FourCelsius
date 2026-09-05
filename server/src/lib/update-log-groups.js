function baseVersionName(value) {
  return String(value || '')
    .replace(/-(android|ios)$/i, '')
    .replace(/-R\d+$/i, '');
}

function mergedPlatform(platforms) {
  const values = new Set(platforms);
  if (values.has('all') || (values.has('android') && values.has('ios'))) return 'all';
  if (values.has('android')) return 'android';
  if (values.has('ios')) return 'ios';
  return 'all';
}

function mergePublicUpdateLogs(logs) {
  const groups = new Map();
  for (const log of logs) {
    const versionName = baseVersionName(log.versionName);
    const key = JSON.stringify([
      versionName,
      log.title,
      log.releaseNotes,
      log.releaseDate,
      log.stage,
    ]);
    const current = groups.get(key);
    if (current) {
      current.platforms.push(log.platform);
      continue;
    }
    groups.set(key, { log: { ...log, versionName }, platforms: [log.platform] });
  }
  return [...groups.values()].map(({ log, platforms }) => ({
    ...log,
    platform: mergedPlatform(platforms),
  }));
}

module.exports = { baseVersionName, mergePublicUpdateLogs, mergedPlatform };
