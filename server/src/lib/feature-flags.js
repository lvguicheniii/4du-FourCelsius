const db = require('../db');

function stableBucket(key, userId) {
  const input = `${key}:${userId || 'guest'}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

function isFeatureEnabled(key, userId) {
  const flag = db.prepare('SELECT enabled, rollout_percent FROM feature_flags WHERE key = ?').get(key);
  if (!flag || !flag.enabled) return false;
  const rollout = Math.max(0, Math.min(100, Number(flag.rollout_percent) || 0));
  return rollout >= 100 || stableBucket(key, userId) < rollout;
}

function getFeatureState(userId) {
  const flags = db.prepare('SELECT key, enabled, rollout_percent FROM feature_flags ORDER BY key').all();
  return Object.fromEntries(flags.map((flag) => [flag.key, isFeatureEnabled(flag.key, userId)]));
}

module.exports = { stableBucket, isFeatureEnabled, getFeatureState };
