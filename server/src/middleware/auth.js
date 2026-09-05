const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { parseCst } = require('../lib/time');
const { JWT_SECRET } = require('../lib/security-config');

function verifyUserToken(token) {
  const payload = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'sidu-api',
    audience: 'sidu-app',
  });
  if (payload.purpose !== 'user') throw new Error('Invalid token purpose');
  return payload;
}

function webSessionHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function verifyAuthToken(token) {
  if (!String(token || '').startsWith('sidu_web_')) return verifyUserToken(token);
  const tokenHash = webSessionHash(token);
  const session = db.prepare(`
    SELECT user_id, expires_at
    FROM web_sessions
    WHERE token_hash = ? AND datetime(expires_at) > datetime('now','+8 hours')
  `).get(tokenHash);
  if (!session) throw new Error('Invalid web session');
  db.prepare("UPDATE web_sessions SET last_seen_at = datetime('now','+8 hours') WHERE token_hash = ?").run(tokenHash);
  return { userId: session.user_id, purpose: 'web-user', webSessionHash: tokenHash };
}

function restrictionPayload(user) {
  const now = Date.now();
  const banUntil = user.ban_until ? parseCst(user.ban_until)?.getTime() : null;
  const muteUntil = user.muted_until ? parseCst(user.muted_until)?.getTime() : null;
  const banned = user.status === 'banned' && (!banUntil || banUntil > now);
  const muted = !!muteUntil && muteUntil > now;
  return {
    banned,
    muted,
    banUntil: banned ? user.ban_until : null,
    mutedUntil: muted ? user.muted_until : null,
    banRemainingMs: banned && banUntil ? Math.max(0, banUntil - now) : null,
    muteRemainingMs: muted ? Math.max(0, muteUntil - now) : null,
  };
}

function normalizeExpiredRestrictions(user) {
  const restriction = restrictionPayload(user);
  if (user.status === 'banned' && !restriction.banned && user.ban_until) {
    db.prepare("UPDATE users SET status = 'active', ban_reason = '', ban_until = NULL WHERE id = ?").run(user.id);
    user.status = 'active';
    user.ban_until = null;
  }
  if (user.muted_until && !restriction.muted) {
    db.prepare('UPDATE users SET muted_until = NULL WHERE id = ?').run(user.id);
    user.muted_until = null;
  }
  return restrictionPayload(user);
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }
  try {
    const token = header.slice(7);
    const payload = verifyAuthToken(token);
    req.userId = payload.userId;
    req.webSessionHash = payload.webSessionHash || null;

    // 检查用户是否存在 + 单设备登录（token_version 不匹配则拒绝）
    const user = db.prepare('SELECT id, username, nickname, role, status, ban_until, muted_until, token_version FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!payload.webSessionHash && payload.tokenVersion !== user.token_version) {
      return res.status(401).json({ error: '账号已在其他设备登录，请重新登录', relogin: true });
    }
    const restriction = normalizeExpiredRestrictions(user);
    req.user = {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      status: user.status,
      ...restriction,
    };
    // 封禁用户只允许获取自身状态和进入系统通知申诉。
    const isAllowedWhileBanned =
      (req.baseUrl === '/api/auth' && req.path === '/me') ||
      req.baseUrl === '/api/notifications';
    if (restriction.banned && !isAllowedWhileBanned) {
      return res.status(403).json({
        error: '账号已被封禁',
        banned: true,
        banUntil: restriction.banUntil,
        remainingMs: restriction.banRemainingMs,
      });
    }
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// 可选认证：不强制，但如果有 token 就解析
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const token = header.slice(7);
      const payload = verifyAuthToken(token);
      req.userId = payload.userId;
      req.webSessionHash = payload.webSessionHash || null;
      const user = db.prepare('SELECT id, username, nickname, role, status, ban_until, muted_until, token_version FROM users WHERE id = ?').get(req.userId);
      if (!user || (!payload.webSessionHash && payload.tokenVersion !== user.token_version)) {
        return res.status(401).json({ error: '登录已失效', relogin: true });
      }
      const restriction = normalizeExpiredRestrictions(user);
      req.user = { id: user.id, username: user.username, nickname: user.nickname, role: user.role, status: user.status, ...restriction };
      if (restriction.banned) {
        return res.status(403).json({
          error: '账号已被封禁',
          banned: true,
          banUntil: restriction.banUntil,
          remainingMs: restriction.banRemainingMs,
        });
      }
    } catch { /* token 无效也继续 */ }
  }
  next();
}

function requireNotMuted(req, res, next) {
  if (req.user?.muted) {
    return res.status(403).json({
      error: '您已被禁言，暂时无法发布、评论或回复',
      muted: true,
      mutedUntil: req.user.mutedUntil,
      remainingMs: req.user.muteRemainingMs,
    });
  }
  next();
}

module.exports = { auth, optionalAuth, requireNotMuted, verifyUserToken, verifyAuthToken, webSessionHash };
