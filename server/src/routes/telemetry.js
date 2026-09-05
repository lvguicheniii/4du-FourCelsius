const { Router } = require('express');
const { optionalAuth } = require('../middleware/auth');

const router = Router();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 20;
const buckets = new Map();

function takeRateLimit(key) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_REPORTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, WINDOW_MS);
cleanupTimer.unref();

function clean(value, maxLength) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

router.post('/client-error', optionalAuth, (req, res) => {
  const rateLimitKey = req.userId || req.ip || 'unknown';
  if (!takeRateLimit(rateLimitKey)) {
    return res.status(429).json({ error: '错误报告过于频繁', requestId: req.requestId });
  }

  console.error(JSON.stringify({
    level: 'error',
    type: 'client_error',
    requestId: req.requestId,
    incidentId: clean(req.body?.incidentId, 80),
    userId: req.userId || null,
    platform: clean(req.body?.platform, 30),
    appVersion: clean(req.body?.appVersion, 40),
    errorName: clean(req.body?.name, 100),
    errorMessage: clean(req.body?.message, 500),
    stack: clean(req.body?.stack, 4000),
  }));

  res.status(202).json({ ok: true, requestId: req.requestId });
});

module.exports = router;
