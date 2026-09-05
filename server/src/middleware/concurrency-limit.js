const scopes = new Map();

function concurrencyLimit({ scope, limit, retryAfterSeconds = 2 }) {
  if (!scope || !Number.isFinite(limit) || limit < 1) {
    throw new Error('Invalid concurrency limit configuration');
  }
  if (!scopes.has(scope)) scopes.set(scope, { active: 0, rejected: 0, limit });

  return (req, res, next) => {
    const state = scopes.get(scope);
    if (state.active >= limit) {
      state.rejected += 1;
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(503).json({
        error: '当前请求较多，请稍后重试',
        code: 'SERVER_BUSY',
        retryAfterSeconds,
      });
    }

    state.active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
    };
    res.once('finish', release);
    res.once('close', release);
    return next();
  };
}

function getConcurrencyStats() {
  return Object.fromEntries([...scopes.entries()].map(([scope, state]) => [scope, { ...state }]));
}

module.exports = { concurrencyLimit, getConcurrencyStats };
