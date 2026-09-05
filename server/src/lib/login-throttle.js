const crypto = require('crypto');
const { JWT_SECRET } = require('./security-config');

function subjectHash(subject) {
  return crypto.createHmac('sha256', JWT_SECRET)
    .update(String(subject || 'unknown').trim().toLowerCase())
    .digest('hex');
}

function keyFor(scope, subject) {
  return { scope: String(scope), subjectHash: subjectHash(subject) };
}

function checkLoginThrottle(db, scope, subject, policy, now = Date.now()) {
  const key = keyFor(scope, subject);
  const row = db.prepare(`
    SELECT failure_count, window_started_at, blocked_until
    FROM login_throttles WHERE scope=? AND subject_hash=?
  `).get(key.scope, key.subjectHash);
  if (!row) return { allowed: true, retryAfterSeconds: 0 };

  if (row.blocked_until && row.blocked_until > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((row.blocked_until - now) / 1000)),
    };
  }
  if (now - row.window_started_at >= policy.windowMs) {
    db.prepare('DELETE FROM login_throttles WHERE scope=? AND subject_hash=?')
      .run(key.scope, key.subjectHash);
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function recordLoginFailure(db, scope, subject, policy, now = Date.now()) {
  const key = keyFor(scope, subject);
  return db.transaction(() => {
    const row = db.prepare(`
      SELECT failure_count, window_started_at
      FROM login_throttles WHERE scope=? AND subject_hash=?
    `).get(key.scope, key.subjectHash);
    const windowExpired = !row || now - row.window_started_at >= policy.windowMs;
    const failureCount = windowExpired ? 1 : row.failure_count + 1;
    const windowStartedAt = windowExpired ? now : row.window_started_at;
    const blockedUntil = failureCount >= policy.maxFailures ? now + policy.blockMs : null;
    db.prepare(`
      INSERT INTO login_throttles(scope,subject_hash,failure_count,window_started_at,blocked_until,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(scope,subject_hash) DO UPDATE SET
        failure_count=excluded.failure_count,
        window_started_at=excluded.window_started_at,
        blocked_until=excluded.blocked_until,
        updated_at=excluded.updated_at
    `).run(key.scope, key.subjectHash, failureCount, windowStartedAt, blockedUntil, now);
    return { failureCount, blockedUntil };
  })();
}

function clearLoginFailures(db, scope, subject) {
  const key = keyFor(scope, subject);
  db.prepare('DELETE FROM login_throttles WHERE scope=? AND subject_hash=?')
    .run(key.scope, key.subjectHash);
}

function pruneLoginThrottles(db, now = Date.now()) {
  const retentionCutoff = now - 7 * 24 * 60 * 60 * 1000;
  return db.prepare(`
    DELETE FROM login_throttles
    WHERE updated_at < ? AND (blocked_until IS NULL OR blocked_until < ?)
  `).run(retentionCutoff, now).changes;
}

module.exports = { checkLoginThrottle, recordLoginFailure, clearLoginFailures, pruneLoginThrottles };
