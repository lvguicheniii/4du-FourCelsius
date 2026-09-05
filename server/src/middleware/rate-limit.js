const buckets = new Map();
let allowedRequests = 0;
let rejectedRequests = 0;

function clientKey(req) {
  return String(req.userId || req.ip || req.socket?.remoteAddress || 'unknown');
}

function prune(now = Date.now()) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

const pruneTimer = setInterval(prune, 60 * 1000);
pruneTimer.unref();

function rateLimit({ scope, limit, windowMs, message = '操作太频繁，请稍后再试' }) {
  if (!scope || !Number.isFinite(limit) || !Number.isFinite(windowMs)) {
    throw new Error('Invalid rate limit configuration');
  }

  return (req, res, next) => {
    const now = Date.now();
    const key = `${scope}:${clientKey(req)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      rejectedRequests += 1;
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: message,
        code: 'RATE_LIMITED',
        retryAfterSeconds,
      });
    }
    allowedRequests += 1;
    return next();
  };
}

function getRateLimitStats() {
  return { activeBuckets: buckets.size, allowedRequests, rejectedRequests };
}

module.exports = { rateLimit, getRateLimitStats, prune };
