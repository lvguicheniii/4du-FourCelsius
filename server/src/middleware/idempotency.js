const crypto = require('crypto');
const db = require('../db');

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function pruneIdempotencyRequests() {
  return db.prepare(`
    DELETE FROM idempotency_requests
    WHERE (state = 'completed' AND updated_at < datetime('now','+8 hours','-7 days'))
       OR (state = 'pending' AND updated_at < datetime('now','+8 hours','-1 day'))
  `).run().changes;
}

function requestHash(req) {
  return crypto
    .createHash('sha256')
    .update(`${req.method}\n${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`)
    .digest('hex');
}

function parseStoredJson(value) {
  try { return JSON.parse(value || '{}'); }
  catch { return {}; }
}

function idempotent(scope) {
  return (req, res, next) => {
    const requestKey = String(req.get('Idempotency-Key') || '').trim();
    if (!requestKey) return next();
    if (!req.userId) return res.status(401).json({ error: '请先登录' });
    if (!KEY_PATTERN.test(requestKey)) {
      return res.status(400).json({ error: '无效的幂等请求标识' });
    }

    const hash = requestHash(req);
    const claim = db.transaction(() => {
      const existing = db.prepare(`
        SELECT request_hash,state,response_status,response_json,
               updated_at < datetime('now','+8 hours','-2 minutes') AS stale
        FROM idempotency_requests
        WHERE user_id=? AND scope=? AND request_key=?
      `).get(req.userId, scope, requestKey);
      if (existing) {
        if (existing.request_hash !== hash) return { type: 'mismatch' };
        if (existing.state === 'completed') return { type: 'replay', row: existing };
        if (!existing.stale) return { type: 'pending' };
        db.prepare(`
          UPDATE idempotency_requests
          SET request_hash=?,state='pending',response_status=NULL,response_json=NULL,
              updated_at=datetime('now','+8 hours')
          WHERE user_id=? AND scope=? AND request_key=?
        `).run(hash, req.userId, scope, requestKey);
        return { type: 'claimed' };
      }
      db.prepare(`
        INSERT INTO idempotency_requests(user_id,scope,request_key,request_hash)
        VALUES (?,?,?,?)
      `).run(req.userId, scope, requestKey, hash);
      return { type: 'claimed' };
    })();

    if (claim.type === 'mismatch') {
      return res.status(409).json({ error: '同一请求标识不能用于不同操作' });
    }
    if (claim.type === 'pending') {
      return res.status(409).json({ error: '请求正在处理中，请稍候', retryable: true });
    }
    if (claim.type === 'replay') {
      res.set('Idempotency-Replayed', 'true');
      return res.status(Number(claim.row.response_status) || 200).json(parseStoredJson(claim.row.response_json));
    }

    let settled = false;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (!settled) {
        settled = true;
        if (res.statusCode >= 500) {
          db.prepare(`
            DELETE FROM idempotency_requests
            WHERE user_id=? AND scope=? AND request_key=? AND state='pending'
          `).run(req.userId, scope, requestKey);
        } else {
          db.prepare(`
            UPDATE idempotency_requests
            SET state='completed',response_status=?,response_json=?,updated_at=datetime('now','+8 hours')
            WHERE user_id=? AND scope=? AND request_key=?
          `).run(res.statusCode, JSON.stringify(body ?? null), req.userId, scope, requestKey);
        }
      }
      return originalJson(body);
    };

    const releasePending = () => {
      if (settled) return;
      db.prepare(`
        DELETE FROM idempotency_requests
        WHERE user_id=? AND scope=? AND request_key=? AND state='pending'
      `).run(req.userId, scope, requestKey);
    };
    res.on('finish', releasePending);
    res.on('close', releasePending);
    next();
  };
}

module.exports = { idempotent, pruneIdempotencyRequests };
