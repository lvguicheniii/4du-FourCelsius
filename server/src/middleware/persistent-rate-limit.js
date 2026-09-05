const db = require('../db');

function defaultSubject(req) {
  return String(req.userId || req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 200);
}

function persistentRateLimit({ scope, limit, windowMs, subject = defaultSubject, message = '操作太频繁，请稍后再试' }) {
  if (!scope || !Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1000) {
    throw new Error('Invalid persistent rate limit configuration');
  }

  const consume = db.transaction((key, now) => {
    const row = db.prepare(`
      SELECT request_count,reset_at
      FROM security_rate_buckets
      WHERE scope=? AND subject=?
    `).get(scope, key);
    const resetAt = row && Number(row.reset_at) > now ? Number(row.reset_at) : now + windowMs;
    const count = row && Number(row.reset_at) > now ? Number(row.request_count) + 1 : 1;
    db.prepare(`
      INSERT INTO security_rate_buckets(scope,subject,request_count,reset_at,updated_at)
      VALUES (?,?,?,?,datetime('now','+8 hours'))
      ON CONFLICT(scope,subject) DO UPDATE SET
        request_count=excluded.request_count,
        reset_at=excluded.reset_at,
        updated_at=excluded.updated_at
    `).run(scope, key, count, resetAt);
    return { count, resetAt };
  });

  return (req, res, next) => {
    const now = Date.now();
    const key = String(subject(req) || 'unknown').slice(0, 200);
    const bucket = consume(key, now);
    const remaining = Math.max(0, limit - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > limit) {
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: message, code: 'RATE_LIMITED', retryAfterSeconds });
    }
    return next();
  };
}

function prunePersistentRateLimits(now = Date.now()) {
  return db.prepare('DELETE FROM security_rate_buckets WHERE reset_at < ?').run(now - 24 * 60 * 60 * 1000).changes;
}

module.exports = { persistentRateLimit, prunePersistentRateLimits };
