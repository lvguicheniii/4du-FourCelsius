const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../../db');
const { nowCst, addCst } = require('../../lib/time');
const { sendPushToUser } = require('../../lib/push');
const { settleReport } = require('../../lib/entropy');
const { JWT_SECRET } = require('../../lib/security-config');
const { checkLoginThrottle, recordLoginFailure, clearLoginFailures } = require('../../lib/login-throttle');
const { hashPassword, comparePassword } = require('../../lib/password-work');
const { asyncRoute } = require('../../lib/async-route');
const { isValidPenaltyReason, normalizePenaltyReason } = require('../../lib/penalty-reasons');
const { buildAppealRejectionNote } = require('../../lib/appeal-reasons');

const router = Router();
const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || JWT_SECRET;
const ADMIN_IP_POLICY = { maxFailures: 20, windowMs: 15 * 60 * 1000, blockMs: 15 * 60 * 1000 };
const ADMIN_ACCOUNT_POLICY = { maxFailures: 5, windowMs: 15 * 60 * 1000, blockMs: 15 * 60 * 1000 };

function adminLoginSubjects(req, username) {
  return [
    { scope: 'admin_ip', subject: req.ip || 'unknown', policy: ADMIN_IP_POLICY },
    { scope: 'admin_account', subject: String(username || '').trim(), policy: ADMIN_ACCOUNT_POLICY },
  ];
}

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_JWT_SECRET) {
  throw new Error('ADMIN_JWT_SECRET is required in production');
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  next();
});

function createSystemNotification(userId, type, title, content, relatedId = '') {
  db.prepare(`
    INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at)
    VALUES (?, ?, 'system', ?, ?, ?, ?, datetime('now','+8 hours'))
  `).run(uuid(), userId, type, title, content, relatedId);
  sendPushToUser(userId, {
    title,
    body: content,
    data: { type, relatedId, route: 'notifications' },
  }).catch((error) => console.error('System notification push failed:', error.message));
}

function settlePenaltyReport(req, reportId, type, note, action) {
  if (!reportId || !['post', 'comment', 'message', 'reef_message', 'reef'].includes(type)) return null;
  const isComment = type === 'comment';
  const isMessage = type === 'message';
  const isReefMessage = type === 'reef_message';
  const isReef = type === 'reef';
  const table = isReef ? 'reef_reports' : (isReefMessage ? 'reef_message_reports' : (isMessage ? 'message_reports' : (isComment ? 'comment_reports' : 'post_reports')));
  const targetColumn = isReef ? 'room_id' : (isReefMessage || isMessage ? 'message_id' : (isComment ? 'comment_id' : 'post_id'));
  const report = db.prepare(`SELECT id, status FROM ${table} WHERE id = ?`).get(reportId);
  if (!report || report.status !== 'pending') return null;
  db.prepare(`
    UPDATE ${table}
    SET status='accepted', handled_by=?, handle_note=?, handle_action=?, handled_at=datetime(?)
    WHERE id=?
  `).run(req.adminId, note, action || '', nowCst(), report.id);
  return settleReport(db, { table, targetColumn, reportId: report.id, status: 'accepted' });
}

function dispatchEntropyNotifications(req, settlement) {
  for (const notification of settlement?.notifications || []) {
    req.app.get('ws')?.send(notification.userId, {
      type: 'notification',
      category: 'system',
      title: notification.title,
      content: notification.content,
      relatedId: notification.relatedId,
    });
    sendPushToUser(notification.userId, {
      title: notification.title,
      body: notification.content,
      data: { type: notification.type, route: 'notifications' },
    }).catch((error) => console.error('Entropy notification push failed:', error.message));
  }
}

function postPreview(post) {
  const text = String(post?.content || '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 42 ? `${text.slice(0, 42)}…` : text;
  try {
    if (JSON.parse(post?.images || '[]').length) return '[图片切片]';
  } catch {}
  return '[无文字切片]';
}

function deletePostByAdmin(postId, reason, adminId, ip, req = null) {
  return db.transaction(() => {
  const post = db.prepare('SELECT id, user_id, content, images, status FROM posts WHERE id = ?').get(postId);
  if (!post) return false;
  const now = nowCst();
  db.prepare(`
    UPDATE posts
    SET status = 'deleted', delete_reason = ?, deleted_at = datetime(?), updated_at = datetime(?)
    WHERE id = ?
  `).run(reason || '违反社区规范', now, now, postId);
  createSystemNotification(
    post.user_id,
    'post_deleted',
    '切片删除通知',
    `你的切片「${postPreview(post)}」已被管理员删除。原因：${reason || '违反社区规范'}`,
    post.id,
  );
  logAdmin(adminId, 'delete_post', 'post', postId, `删除原因: ${reason || '违反社区规范'}`, ip);
  if (req) {
    const pendingReports = db.prepare("SELECT id FROM post_reports WHERE post_id = ? AND status = 'pending'").all(postId);
    for (const pending of pendingReports) {
      db.prepare(`
        UPDATE post_reports
        SET status='accepted', handled_by=?, handle_note=?, handle_action='delete_post', handled_at=datetime(?)
        WHERE id=?
      `).run(adminId, reason || '切片已删除', now, pending.id);
      dispatchEntropyNotifications(req, settleReport(db, {
        table: 'post_reports', targetColumn: 'post_id', reportId: pending.id, status: 'accepted',
      }));
    }
  }
  return true;
  })();
}

function loadAppealCaseHistory(userId) {
  const recentReports = db.prepare(`
    SELECT * FROM (
      SELECT pr.id, 'post' AS case_type, pr.status, pr.reason, pr.detail, pr.handle_note,
             pr.created_at, pr.handled_at, p.id AS target_id,
             substr(COALESCE(NULLIF(trim(p.content), ''), '[仅媒体切片]'), 1, 160) AS preview,
             p.images AS media, 'images' AS media_kind
      FROM post_reports pr JOIN posts p ON p.id = pr.post_id WHERE p.user_id = ?
      UNION ALL
      SELECT cr.id, 'comment', cr.status, cr.reason, cr.detail, cr.handle_note,
             cr.created_at, cr.handled_at, c.id,
             substr(COALESCE(NULLIF(trim(c.content), ''), '[表情评论]'), 1, 160),
             c.media_url, c.kind
      FROM comment_reports cr JOIN comments c ON c.id = cr.comment_id WHERE c.user_id = ?
      UNION ALL
      SELECT mr.id, 'message', mr.status, mr.reason, mr.detail, mr.handle_note,
             mr.created_at, mr.handled_at, m.id,
             substr(COALESCE(NULLIF(trim(m.content), ''), '[' || COALESCE(m.kind, '私信') || ']'), 1, 160),
             CASE WHEN m.kind IN ('image','sticker','live_photo') THEN m.content ELSE '' END, m.kind
      FROM message_reports mr JOIN messages m ON m.id = mr.message_id WHERE m.from_user_id = ?
      UNION ALL
      SELECT rr.id, 'reef_message', rr.status, rr.reason, rr.detail, rr.handle_note,
             rr.created_at, rr.handled_at, rm.id,
             substr(COALESCE(NULLIF(trim(rm.content), ''), '[' || COALESCE(rm.kind, '礁石消息') || ']'), 1, 160),
             CASE WHEN rm.kind IN ('image','sticker','live_photo') THEN rm.content ELSE '' END, rm.kind
      FROM reef_message_reports rr JOIN reef_messages rm ON rm.id = rr.message_id WHERE rm.user_id = ?
      UNION ALL
      SELECT rpr.id, 'reef', rpr.status, rpr.reason, rpr.detail, rpr.handle_note,
             rpr.created_at, rpr.handled_at, room.id,
             substr('礁石【' || COALESCE(room.name, '未命名') || '】', 1, 160),
             '', 'none'
      FROM reef_reports rpr JOIN reef_rooms room ON room.id = rpr.room_id WHERE room.owner_id = ?
    ) cases
    ORDER BY created_at DESC, id DESC
    LIMIT 8
  `).all(userId, userId, userId, userId, userId);

  const violations = db.prepare(`
    SELECT * FROM (
      SELECT pr.id, 'post' AS case_type, 'accepted' AS status, pr.reason, pr.detail, pr.handle_note,
             pr.created_at, pr.handled_at, p.id AS target_id,
             substr(COALESCE(NULLIF(trim(p.content), ''), '[仅媒体切片]'), 1, 160) AS preview,
             p.images AS media, 'images' AS media_kind
      FROM post_reports pr JOIN posts p ON p.id = pr.post_id
      WHERE p.user_id = ? AND pr.status = 'accepted'
      UNION ALL
      SELECT cr.id, 'comment', 'accepted', cr.reason, cr.detail, cr.handle_note,
             cr.created_at, cr.handled_at, c.id,
             substr(COALESCE(NULLIF(trim(c.content), ''), '[表情评论]'), 1, 160),
             c.media_url, c.kind
      FROM comment_reports cr JOIN comments c ON c.id = cr.comment_id
      WHERE c.user_id = ? AND cr.status = 'accepted'
      UNION ALL
      SELECT mr.id, 'message', 'accepted', mr.reason, mr.detail, mr.handle_note,
             mr.created_at, mr.handled_at, m.id,
             substr(COALESCE(NULLIF(trim(m.content), ''), '[' || COALESCE(m.kind, '私信') || ']'), 1, 160),
             CASE WHEN m.kind IN ('image','sticker','live_photo') THEN m.content ELSE '' END, m.kind
      FROM message_reports mr JOIN messages m ON m.id = mr.message_id
      WHERE m.from_user_id = ? AND mr.status = 'accepted'
      UNION ALL
      SELECT rr.id, 'reef_message', 'accepted', rr.reason, rr.detail, rr.handle_note,
             rr.created_at, rr.handled_at, rm.id,
             substr(COALESCE(NULLIF(trim(rm.content), ''), '[' || COALESCE(rm.kind, '礁石消息') || ']'), 1, 160),
             CASE WHEN rm.kind IN ('image','sticker','live_photo') THEN rm.content ELSE '' END, rm.kind
      FROM reef_message_reports rr JOIN reef_messages rm ON rm.id = rr.message_id
      WHERE rm.user_id = ? AND rr.status = 'accepted'
      UNION ALL
      SELECT rpr.id, 'reef', 'accepted', rpr.reason, rpr.detail, rpr.handle_note,
             rpr.created_at, rpr.handled_at, room.id,
             substr('礁石【' || COALESCE(room.name, '未命名') || '】', 1, 160),
             '', 'none'
      FROM reef_reports rpr JOIN reef_rooms room ON room.id = rpr.room_id
      WHERE room.owner_id = ? AND rpr.status = 'accepted'
      UNION ALL
      SELECT mt.id, 'tencent_' || mt.target_type, 'accepted',
             COALESCE(NULLIF(mt.risk_label, ''), '腾讯云二审'), mt.handle_action, mt.handle_note,
             mt.created_at, mt.handled_at, mt.target_id,
             substr(COALESCE(NULLIF(trim(mt.content_snapshot), ''), '[媒体内容]'), 1, 160),
             mt.media_snapshot, 'images'
      FROM moderation_tasks mt
      WHERE mt.author_id = ? AND mt.admin_status = 'violation'
    ) cases
    ORDER BY COALESCE(handled_at, created_at) DESC, id DESC
    LIMIT 8
  `).all(userId, userId, userId, userId, userId, userId);

  return { recent_reports: recentReports, violation_cases: violations };
}

function deleteCommentByAdmin(commentId, reason, adminId, ip, req = null) {
  return db.transaction(() => {
  const comment = db.prepare('SELECT id,user_id,post_id,content,status FROM comments WHERE id=?').get(commentId);
  if (!comment) return false;
  db.prepare("UPDATE comments SET status='deleted' WHERE id=?").run(comment.id);
  createSystemNotification(
    comment.user_id,
    'comment_deleted',
    '评论删除通知',
    `你的评论「${String(comment.content || '').slice(0, 42)}」已被管理员删除。原因：${reason}`,
    comment.id,
  );
  logAdmin(adminId, 'delete_comment', 'comment', comment.id, `删除原因: ${reason}`, ip);
  if (req) req.app.get('ws')?.broadcastCoalesced?.(`post-stats:${comment.post_id}`, { type: 'post_stats_changed', relatedId: comment.post_id });
  return true;
  })();
}

function applyAdminMute(req, userId, options = {}) {
  return db.transaction(() => {
  const hours = Math.min(Math.max(parseInt(options.hours) || 12, 1), 8760);
  const reason = normalizePenaltyReason(options.reason);
  if (!isValidPenaltyReason(reason)) return { error: '请选择标准违规原因；选择“其他”时必须填写补充说明' };
  const until = addCst({ hours });
  db.prepare('UPDATE users SET muted_until = ? WHERE id = ?').run(until, userId);
  createSystemNotification(userId, 'muted', '禁言通知', `你已被禁言 ${hours} 小时，期间无法发布切片、评论或回复。原因：${reason}`, userId);
  req.app.get('ws')?.send(userId, { type: 'account_restriction', restriction: 'muted' });
  logAdmin(req.adminId, 'mute_user', 'user', userId, `禁言 ${hours}h，原因：${reason}`, req.ip);
  const settlement = settlePenaltyReport(req, options.reportId, options.reportType, `举报核实后禁言 ${hours} 小时`, 'mute');
  dispatchEntropyNotifications(req, settlement);
  return { ok: true, muted_until: until, calibrationDelta: settlement?.delta || 0 };
  })();
}

function applyAdminBan(req, userId, options = {}) {
  return db.transaction(() => {
  const days = Math.min(Math.max(parseInt(options.days) || 1, 1), 3650);
  const reason = normalizePenaltyReason(options.reason);
  if (!isValidPenaltyReason(reason)) return { error: '请选择标准违规原因；选择“其他”时必须填写补充说明' };
  const until = addCst({ days });
  db.prepare("UPDATE users SET status='banned',ban_reason=?,ban_until=?,entropy_lv4_earned=0 WHERE id=?").run(reason, until, userId);
  createSystemNotification(userId, 'banned', '封禁通知', `你的账号已被封禁 ${days} 天。原因：${reason}`, userId);
  req.app.get('ws')?.send(userId, { type: 'account_restriction', restriction: 'banned' });
  logAdmin(req.adminId, 'ban_user', 'user', userId, `封禁 ${days}d，原因：${reason}`, req.ip);
  const settlement = settlePenaltyReport(req, options.reportId, options.reportType, `举报核实后封禁 ${days} 天`, 'ban');
  dispatchEntropyNotifications(req, settlement);
  return { ok: true, ban_until: until, calibrationDelta: settlement?.delta || 0 };
  })();
}

function adminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: '需要管理员权限' });
  try {
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    const payload = jwt.verify(token, ADMIN_SECRET, {
      algorithms: ['HS256'],
      issuer: 'sidu-api',
      audience: 'sidu-admin',
    });
    if (payload.purpose !== 'admin') return res.status(401).json({ error: '登录凭证类型无效' });
    const user = db.prepare('SELECT role, token_version FROM users WHERE id = ? AND status = ?').get(payload.userId, 'active');
    if (!user || !['admin', 'reviewer', 'superadmin'].includes(user.role)) {
      return res.status(403).json({ error: '无权访问' });
    }
    if (Number(payload.tokenVersion) !== Number(user.token_version || 0)) {
      return res.status(401).json({ error: '登录已失效，请重新登录' });
    }
    req.adminId = payload.userId;
    req.adminRole = user.role;
    if ((user.role === 'admin' || user.role === 'reviewer')) {
      const path = String(req.path || '');
      const allowed = /^\/(me|posts|comments|reports|moderation|appeals)(\/|$)/.test(path)
        || /^\/users\/[^/]+\/(mute|ban|history)$/.test(path);
      if (!allowed) return res.status(403).json({ error: '后台审核员只能访问内容审核功能' });
    }
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (req.adminRole !== 'superadmin') return res.status(403).json({ error: '需要超级管理员权限' });
  next();
}

// 管理员登录
router.post('/login', asyncRoute(async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || username.length > 100 || !password || password.length > 128) {
    return res.status(400).json({ error: '登录信息格式无效' });
  }
  const throttleSubjects = adminLoginSubjects(req, username);
  const blocked = throttleSubjects
    .map((item) => checkLoginThrottle(db, item.scope, item.subject, item.policy))
    .find((result) => !result.allowed);
  if (blocked) {
    res.set('Retry-After', String(blocked.retryAfterSeconds));
    return res.status(429).json({ error: '登录尝试过多，请稍后再试', retryAfterSeconds: blocked.retryAfterSeconds });
  }
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND role IN ('admin','reviewer','superadmin')").get(username);
  if (!user || !await comparePassword(password, user.password_hash)) {
    throttleSubjects.forEach((item) => recordLoginFailure(db, item.scope, item.subject, item.policy));
    return res.status(401).json({ error: '用户名或密码错误，或不是管理员' });
  }
  throttleSubjects.forEach((item) => clearLoginFailures(db, item.scope, item.subject));
  const token = jwt.sign({
    userId: user.id,
    role: user.role,
    tokenVersion: Number(user.token_version || 0),
    purpose: 'admin',
  }, ADMIN_SECRET, {
    algorithm: 'HS256',
    expiresIn: '4h',
    issuer: 'sidu-api',
    audience: 'sidu-admin',
  });
  res.json({ token, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } });
}));

// ====== 仪表盘统计 ======
router.get('/stats', adminAuth, (req, res) => {
  const now = nowCst();
  const reportsPendingByType = {
    post: db.prepare("SELECT COUNT(*) as c FROM post_reports WHERE status = 'pending'").get().c,
    comment: db.prepare("SELECT COUNT(*) as c FROM comment_reports WHERE status = 'pending'").get().c,
    message: db.prepare("SELECT COUNT(*) as c FROM message_reports WHERE status = 'pending'").get().c,
    reef_message: db.prepare("SELECT COUNT(*) as c FROM reef_message_reports WHERE status = 'pending'").get().c,
    reef: db.prepare("SELECT COUNT(*) as c FROM reef_reports WHERE status = 'pending'").get().c,
  };
  res.json({
    users: db.prepare("SELECT COUNT(*) as c FROM users WHERE role NOT IN ('admin','reviewer','superadmin') AND status != 'deleted'").get().c,
    usersToday: db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at) = date('now','+8 hours')").get().c,
    active7d: db.prepare("SELECT COUNT(*) as c FROM users WHERE last_login_at >= datetime('now','+8 hours','-7 days') AND role NOT IN ('admin','reviewer','superadmin')").get().c,
    mutedNow: db.prepare("SELECT COUNT(*) as c FROM users WHERE muted_until IS NOT NULL AND muted_until > ?").get(now).c,
    bannedNow: db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'banned' AND (ban_until IS NULL OR ban_until > ?)").get(now).c,
    online: req.app.get('ws')?.getOnlineCount?.() || 0,
    posts: db.prepare('SELECT COUNT(*) as c FROM posts WHERE status = ?').get('active').c,
    postsToday: db.prepare("SELECT COUNT(*) as c FROM posts WHERE date(created_at) = date('now','+8 hours')").get().c,
    comments: db.prepare('SELECT COUNT(*) as c FROM comments WHERE status = ?').get('active').c,
    reportsPending: Object.values(reportsPendingByType).reduce((sum, count) => sum + count, 0),
    reportsPendingByType,
    moderationPending: db.prepare("SELECT COUNT(*) as c FROM moderation_tasks WHERE admin_status='pending' AND status='needs_review'").get().c,
    appealsPending: db.prepare("SELECT COUNT(*) as c FROM appeals WHERE status = 'pending'").get().c,
    likes: db.prepare('SELECT COUNT(*) as c FROM post_cools').get().c,
    follows: db.prepare('SELECT COUNT(*) as c FROM follows').get().c,
  });
});

// ====== 用户管理 ======
router.get('/users', adminAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  const status = req.query.status || '';

  let where = "WHERE role NOT IN ('admin','reviewer','superadmin')";
  const params = [];
  if (search) {
    where += ' AND (username LIKE ? OR nickname LIKE ? OR phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { where += ' AND status = ?'; params.push(status); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM users ${where}`).get(...params).c;
  const users = db.prepare(`
    SELECT id, username, nickname, phone, email, avatar, bio, role, status, ban_reason, ban_until, muted_until,
           CASE WHEN username LIKE 'user_%' AND phone != '' THEN 'user_' || phone ELSE username END AS account_code,
           last_login_ip, last_login_at, last_online_at, login_count, register_ip, created_at
    FROM users ${where}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const ws = req.app.get('ws');
  users.forEach(user => { user.is_online = ws?.isOnline?.(user.id) || false; });

  res.json({ users, total, page, totalPages: Math.ceil(total / limit) });
});

router.get('/me', adminAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, nickname, role FROM users WHERE id = ?').get(req.adminId);
  res.json({ user });
});

// ====== 人群画像 ======
router.get('/demographics', adminAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT gender, age
    FROM users
    WHERE role NOT IN ('admin','reviewer','superadmin') AND status != 'deleted'
  `).all();
  const gender = [
    { key: 'male', label: '男性', count: 0 },
    { key: 'female', label: '女性', count: 0 },
    { key: 'unknown', label: '未设置', count: 0 },
  ];
  const ageGroups = [
    { label: '0–12岁', min: 0, max: 12, count: 0 },
    { label: '13–17岁', min: 13, max: 17, count: 0 },
    { label: '18–22岁', min: 18, max: 22, count: 0 },
    { label: '23–30岁', min: 23, max: 30, count: 0 },
    { label: '31–45岁', min: 31, max: 45, count: 0 },
    { label: '46–60岁', min: 46, max: 60, count: 0 },
    { label: '61–99岁', min: 61, max: 99, count: 0 },
    { label: '100–199岁', min: 100, max: 199, count: 0 },
    { label: '200–299岁', min: 200, max: 299, count: 0 },
    { label: '300–399岁', min: 300, max: 399, count: 0 },
    { label: '400–444岁', min: 400, max: 444, count: 0 },
    { label: '未设置', min: null, max: null, count: 0 },
  ];
  const knownAges = [];
  rows.forEach((row) => {
    const g = gender.find((item) => item.key === row.gender) || gender[2];
    g.count += 1;
    if (Number.isInteger(row.age) && row.age >= 0 && row.age <= 444) {
      knownAges.push(row.age);
      const group = ageGroups.find((item) => item.min !== null && row.age >= item.min && row.age <= item.max);
      if (group) group.count += 1;
    } else {
      ageGroups[ageGroups.length - 1].count += 1;
    }
  });
  knownAges.sort((a, b) => a - b);
  const averageAge = knownAges.length
    ? Math.round((knownAges.reduce((sum, age) => sum + age, 0) / knownAges.length) * 10) / 10
    : null;
  const medianAge = knownAges.length
    ? knownAges.length % 2
      ? knownAges[(knownAges.length - 1) / 2]
      : (knownAges[knownAges.length / 2 - 1] + knownAges[knownAges.length / 2]) / 2
    : null;
  const now = nowCst();
  res.json({
    gender,
    age: ageGroups.map(({ label, count }) => ({ label, count })),
    summary: {
      total: rows.length,
      ageKnown: knownAges.length,
      ageCoverage: rows.length ? Math.round((knownAges.length / rows.length) * 1000) / 10 : 0,
      averageAge,
      medianAge,
      mutedNow: db.prepare("SELECT COUNT(*) as c FROM users WHERE muted_until IS NOT NULL AND muted_until > ? AND status != 'deleted'").get(now).c,
      bannedNow: db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'banned' AND (ban_until IS NULL OR ban_until > ?)").get(now).c,
    },
  });
});

// 修改用户状态
router.put('/users/:id/status', adminAuth, (req, res) => {
  const { status, ban_reason, ban_until } = req.body;
  if (!['active', 'banned', 'deleted'].includes(status)) {
    return res.status(400).json({ error: '无效的用户状态' });
  }
  const target = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET status = ?, ban_reason = ?, ban_until = ?, updated_at = datetime(?) WHERE id = ?')
    .run(status, ban_reason || '', ban_until || null, nowCst(), req.params.id);

  // 记录日志
  logAdmin(req.adminId, status === 'banned' ? 'ban_user' : 'unban_user', 'user', req.params.id,
    `状态变更: ${status}, 原因: ${ban_reason || '无'}`, req.ip);

  res.json({ ok: true });
});

// ====== 帖子管理 ======
router.get('/posts', adminAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  const status = req.query.status || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (search) { where += ' AND p.content LIKE ?'; params.push(`%${search}%`); }
  if (status === 'non_deleted') {
    where += " AND p.status != 'deleted'";
  } else if (status) {
    where += ' AND p.status = ?'; params.push(status);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM posts p ${where}`).get(...params).c;
  const posts = db.prepare(`
    SELECT p.*, u.username, u.nickname, u.avatar
    FROM posts p JOIN users u ON p.user_id = u.id
    ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ posts, total, page, totalPages: Math.ceil(total / limit) });
});

// 修改帖子状态
router.put('/posts/:id/status', adminAuth, (req, res) => {
  const { status, reason } = req.body;
  if (status === 'deleted') {
    if (!isValidPenaltyReason(reason)) return res.status(400).json({ error: '请选择标准违规原因；选择“其他”时必须填写补充说明' });
    if (!deletePostByAdmin(req.params.id, reason, req.adminId, req.ip, req)) {
      return res.status(404).json({ error: '切片不存在' });
    }
    return res.json({ ok: true });
  }
  db.prepare('UPDATE posts SET status = ?, delete_reason = ?, deleted_at = CASE WHEN ? = ? THEN datetime(?) ELSE deleted_at END, updated_at = datetime(?) WHERE id = ?')
    .run(status, reason || '', status, 'deleted', nowCst(), nowCst(), req.params.id);

  logAdmin(req.adminId, status === 'deleted' ? 'delete_post' : 'restore_post', 'post', req.params.id,
    `状态变更: ${status}, 原因: ${reason || '无'}`, req.ip);

  res.json({ ok: true });
});

router.delete('/posts/:id', adminAuth, (req, res) => {
  const reason = String(req.body?.reason || req.query.reason || '');
  if (!isValidPenaltyReason(reason)) return res.status(400).json({ error: '请选择标准违规原因；选择“其他”时必须填写补充说明' });
  if (!deletePostByAdmin(req.params.id, reason, req.adminId, req.ip, req)) {
    return res.status(404).json({ error: '切片不存在' });
  }
  res.json({ ok: true });
});

// ====== 举报管理 ======
router.get('/reports', adminAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = (page - 1) * limit;
  const status = req.query.status || 'pending';
  const type = ['comment', 'message', 'reef_message', 'reef'].includes(req.query.type) ? req.query.type : 'post';
  if (type === 'reef') {
    const total = db.prepare('SELECT COUNT(*) as c FROM reef_reports WHERE status=?').get(status).c;
    const reports = db.prepare(`
      SELECT r.*,room.name AS room_name,room.color AS room_color,room.status AS room_status,
             room.created_at AS room_created_at,room.owner_id,
             owner.username AS author_name,COALESCE(owner.nickname,owner.username,'已注销用户') AS author_nickname,room.owner_id AS author_id,
             COALESCE(ru.username,'已注销用户') AS reporter_name,COALESCE(ru.nickname,ru.username,'已注销用户') AS reporter_nickname,r.reporter_id AS reporter_id,
             (20 + MIN(30,MAX(0,CAST((julianday('now','+8 hours')-julianday(r.created_at))*4 AS INTEGER)))
               + (SELECT COUNT(*) FROM reef_reports rr WHERE rr.room_id=r.room_id AND rr.status='pending')*12) AS priority_score
      FROM reef_reports r JOIN reef_rooms room ON room.id=r.room_id
      LEFT JOIN users owner ON owner.id=room.owner_id LEFT JOIN users ru ON ru.id=r.reporter_id
      WHERE r.status=? ORDER BY r.created_at DESC,priority_score DESC,r.id DESC LIMIT ? OFFSET ?
    `).all(status,limit,offset);
    for (const report of reports) {
      try { report.context=JSON.parse(report.context_json||'[]'); } catch { report.context=[]; }
      if (!Array.isArray(report.context)) report.context=[];
    }
    return res.json({ type,reports,total,page,totalPages:Math.ceil(total/limit) });
  }
  if (type === 'reef_message') {
    const total = db.prepare('SELECT COUNT(*) as c FROM reef_message_reports WHERE status = ?').get(status).c;
    const reports = db.prepare(`
      SELECT r.*, m.id as message_id, m.kind as message_kind, m.content as message_content,
             m.created_at as message_created_at,m.room_id,
             (CASE r.reason WHEN '违法违规' THEN 90 WHEN '人身攻击' THEN 70 WHEN '色情低俗' THEN 65 WHEN '垃圾广告' THEN 35 ELSE 20 END
               + MIN(30, MAX(0, CAST((julianday('now','+8 hours') - julianday(r.created_at)) * 4 AS INTEGER)))
               + (SELECT COUNT(*) FROM reef_message_reports rr WHERE rr.message_id=r.message_id AND rr.status='pending') * 12
             ) AS priority_score,
             room.name as room_name,room.official_number as room_number,
             m.user_id as author_id,au.username as author_name,COALESCE(au.nickname,au.username,'已注销用户') as author_nickname,
             r.reporter_id as reporter_id,COALESCE(ru.username,'已注销用户') as reporter_name,COALESCE(ru.nickname,ru.username,'已注销用户') as reporter_nickname
      FROM reef_message_reports r
      JOIN reef_messages m ON r.message_id=m.id
      JOIN reef_rooms room ON m.room_id=room.id
      LEFT JOIN users au ON m.user_id=au.id
      LEFT JOIN users ru ON r.reporter_id=ru.id
      WHERE r.status=?
      ORDER BY r.created_at DESC,priority_score DESC,r.id DESC LIMIT ? OFFSET ?
    `).all(status, limit, offset);
    for (const report of reports) {
      try { report.context = JSON.parse(report.context_json || '[]'); }
      catch { report.context = []; }
      if (!Array.isArray(report.context)) report.context = [];
    }
    return res.json({ type, reports, total, page, totalPages: Math.ceil(total / limit) });
  }
  if (type === 'message') {
    const total = db.prepare('SELECT COUNT(*) as c FROM message_reports WHERE status = ?').get(status).c;
    const reports = db.prepare(`
      SELECT r.*, m.id as message_id, m.kind as message_kind, m.content as message_content,
             m.created_at as message_created_at,
             (CASE r.reason WHEN 'violence' THEN 90 WHEN 'harass' THEN 70 WHEN 'spam' THEN 35 ELSE 20 END
               + MIN(30, MAX(0, CAST((julianday('now','+8 hours') - julianday(r.created_at)) * 4 AS INTEGER)))
               + (SELECT COUNT(*) FROM message_reports rr WHERE rr.message_id=r.message_id AND rr.status='pending') * 12
             ) AS priority_score,
             m.from_user_id as author_id, au.username as author_name, COALESCE(au.nickname,au.username,'已注销用户') as author_nickname,
             m.to_user_id as receiver_id, tu.username as receiver_name, COALESCE(tu.nickname,tu.username,'已注销用户') as receiver_nickname,
             r.reporter_id as reporter_id, COALESCE(ru.username,'已注销用户') as reporter_name, COALESCE(ru.nickname,ru.username,'已注销用户') as reporter_nickname
      FROM message_reports r
      JOIN messages m ON r.message_id=m.id
      LEFT JOIN users au ON m.from_user_id=au.id
      LEFT JOIN users tu ON m.to_user_id=tu.id
      LEFT JOIN users ru ON r.reporter_id=ru.id
      WHERE r.status=?
      ORDER BY r.created_at DESC,priority_score DESC,r.id DESC LIMIT ? OFFSET ?
    `).all(status, limit, offset);
    for (const report of reports) {
      try {
        report.context = JSON.parse(report.context_json || '[]');
      } catch {
        report.context = [];
      }
      if (!Array.isArray(report.context)) report.context = [];
    }
    return res.json({ type, reports, total, page, totalPages: Math.ceil(total / limit) });
  }
  if (type === 'comment') {
    const total = db.prepare('SELECT COUNT(*) as c FROM comment_reports WHERE status = ?').get(status).c;
    const reports = db.prepare(`
      SELECT r.*, c.id as comment_id, c.content as comment_content, c.status as comment_status,
             (CASE r.reason WHEN 'violence' THEN 90 WHEN 'harass' THEN 70 WHEN 'spam' THEN 35 ELSE 20 END
               + MIN(30, MAX(0, CAST((julianday('now','+8 hours') - julianday(r.created_at)) * 4 AS INTEGER)))
               + (SELECT COUNT(*) FROM comment_reports rr WHERE rr.comment_id=r.comment_id AND rr.status='pending') * 12
             ) AS priority_score,
             c.user_id as author_id, ca.username as author_name, COALESCE(ca.nickname,ca.username,'已注销用户') as author_nickname,
             p.id as post_id, p.content as post_content, p.images as post_images,
             p.live_photos as post_live_photos,p.video_url as post_video_url,
             p.video_poster as post_video_poster,p.video_media_type as post_video_media_type,
             p.status as post_status,
             p.likes_count, p.comments_count, p.created_at as post_created_at,
             p.user_id as post_author_id, pa.username as post_author_name, COALESCE(pa.nickname,pa.username,'已注销用户') as post_author_nickname,
             r.reporter_id as reporter_id, COALESCE(ru.username,'已注销用户') as reporter_name, COALESCE(ru.nickname,ru.username,'已注销用户') as reporter_nickname
      FROM comment_reports r
      JOIN comments c ON r.comment_id = c.id
      LEFT JOIN users ca ON c.user_id = ca.id
      JOIN posts p ON c.post_id = p.id
      LEFT JOIN users pa ON p.user_id = pa.id
      LEFT JOIN users ru ON r.reporter_id = ru.id
      WHERE r.status = ?
      ORDER BY r.created_at DESC,priority_score DESC,r.id DESC LIMIT ? OFFSET ?
    `).all(status, limit, offset);
    return res.json({ type, reports, total, page, totalPages: Math.ceil(total / limit) });
  }

  const total = db.prepare('SELECT COUNT(*) as c FROM post_reports WHERE status = ?').get(status).c;
  const reports = db.prepare(`
    SELECT r.*, p.id as post_id, p.content as post_content, p.images as post_images,
           p.live_photos as post_live_photos,p.video_url as post_video_url,
           p.video_poster as post_video_poster,p.video_media_type as post_video_media_type,
           p.status as post_status,
           p.likes_count, p.comments_count, p.created_at as post_created_at,
           (CASE r.reason WHEN 'violence' THEN 90 WHEN 'harass' THEN 70 WHEN 'spam' THEN 35 ELSE 20 END
             + MIN(30, MAX(0, CAST((julianday('now','+8 hours') - julianday(r.created_at)) * 4 AS INTEGER)))
             + (SELECT COUNT(*) FROM post_reports rr WHERE rr.post_id=r.post_id AND rr.status='pending') * 12
           ) AS priority_score,
           COALESCE(ru.username,'已注销用户') as reporter_name, COALESCE(ru.nickname,ru.username,'已注销用户') as reporter_nickname, r.reporter_id as reporter_id,
           au.username as author_name, COALESCE(au.nickname,au.username,'已注销用户') as author_nickname, p.user_id as author_id
    FROM post_reports r
    JOIN posts p ON r.post_id = p.id
    LEFT JOIN users ru ON r.reporter_id = ru.id
    LEFT JOIN users au ON p.user_id = au.id
    WHERE r.status = ?
    ORDER BY r.created_at DESC,priority_score DESC,r.id DESC LIMIT ? OFFSET ?
  `).all(status, limit, offset);
  res.json({ type, reports, total, page, totalPages: Math.ceil(total / limit) });
});

// 处理举报
router.put('/reports/:id/handle', adminAuth, (req, res) => {
  const { status, note, action, type } = req.body;
  const isComment = type === 'comment';
  const isMessage = type === 'message';
  const isReefMessage = type === 'reef_message';
  const isReef = type === 'reef';
  const table = isReef ? 'reef_reports' : (isReefMessage ? 'reef_message_reports' : (isMessage ? 'message_reports' : (isComment ? 'comment_reports' : 'post_reports')));
  const report = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
  if (!report) return res.status(404).json({ error: '举报不存在' });
  if (report.status !== 'pending') return res.status(409).json({ error: '这条举报已经处理过了' });
  if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: '无效的审核状态' });
  if (status === 'accepted' && ['delete_post', 'delete_comment'].includes(action) && !isValidPenaltyReason(note)) {
    return res.status(400).json({ error: '请选择标准违规原因；选择“其他”时必须填写补充说明' });
  }

  db.prepare(`UPDATE ${table} SET status = ?, handled_by = ?, handle_note = ?, handle_action = ?, handled_at = datetime(?) WHERE id = ?`)
    .run(status, req.adminId, note || '', action || (status === 'rejected' ? 'reject' : ''), nowCst(), req.params.id);

  if (status === 'accepted') {
    if (isReef && action === 'destroy_reef') {
      const room = db.prepare('SELECT id,name,owner_id FROM reef_rooms WHERE id=?').get(report.room_id);
      db.prepare("UPDATE reef_rooms SET status='destroyed',destroyed_at=datetime('now','+8 hours') WHERE id=?").run(report.room_id);
      if (room) {
        const recipients = new Set(db.prepare('SELECT DISTINCT user_id FROM reef_messages WHERE room_id=?').all(room.id).map(row => row.user_id));
        if (room.owner_id) recipients.add(room.owner_id);
        const content = `【${room.name || '未命名'}】礁石已被系统摧毁，原因：${note || '违反社区规范'}`;
        for (const userId of recipients) createSystemNotification(userId, 'system', '礁石摧毁通知', content, room.id);
      }
      req.app.get('ws')?.broadcast?.({ type: 'reef_room_updated', roomId: report.room_id, action: 'destroyed' });
    }
    if (!isComment && !isMessage && action === 'delete_post') {
      deletePostByAdmin(report.post_id, note, req.adminId, req.ip, req);
    }
    if (isComment && action === 'delete_comment') {
      deleteCommentByAdmin(report.comment_id, note, req.adminId, req.ip, req);
    }
  }

  const targetColumn = isReef ? 'room_id' : (isReefMessage || isMessage ? 'message_id' : (isComment ? 'comment_id' : 'post_id'));
  const settlement = settleReport(db, {
    table,
    targetColumn,
    reportId: report.id,
    status,
  });
  dispatchEntropyNotifications(req, settlement);

  logAdmin(
    req.adminId,
    `handle_${type || 'post'}_report`,
    'report',
    report.id,
    `处理结果：${status}；操作：${action || 'none'}；说明：${note || '无'}`,
    req.ip,
  );

  res.json({ ok: true, calibrationDelta: settlement.delta || 0 });
});

// 禁言用户
router.put('/users/:id/mute', adminAuth, (req, res) => {
  const result = applyAdminMute(req, req.params.id, req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.put('/users/:id/unmute', adminAuth, (req, res) => {
  const user = db.prepare('SELECT id, muted_until FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET muted_until = NULL WHERE id = ?').run(req.params.id);
  createSystemNotification(req.params.id, 'unmuted', '禁言已解除', '管理员已解除你的禁言限制，你现在可以正常发布切片、评论和回复。', req.params.id);
  req.app.get('ws')?.send(req.params.id, { type: 'account_restriction', restriction: 'unmuted' });
  logAdmin(req.adminId, 'unmute_user', 'user', req.params.id, '管理员主动解除禁言', req.ip);
  res.json({ ok: true });
});

// 封禁用户
router.put('/users/:id/ban', adminAuth, (req, res) => {
  const result = applyAdminBan(req, req.params.id, req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.put('/users/:id/unban', adminAuth, (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  db.prepare("UPDATE users SET status = 'active', ban_reason = '', ban_until = NULL WHERE id = ?").run(req.params.id);
  createSystemNotification(req.params.id, 'unbanned', '封禁已解除', '管理员已解除你的账号封禁，你现在可以重新使用肆度。', req.params.id);
  req.app.get('ws')?.send(req.params.id, { type: 'account_restriction', restriction: 'unbanned' });
  logAdmin(req.adminId, 'unban_user', 'user', req.params.id, '管理员主动解除封禁', req.ip);
  res.json({ ok: true });
});

// ====== 申诉处理 ======
router.get('/appeals', adminAuth, (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = (page - 1) * limit;
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const total = db.prepare('SELECT COUNT(*) as c FROM appeals WHERE status = ?').get(status).c;
  const appeals = db.prepare(`
    SELECT a.*, u.username, u.nickname, u.avatar, u.status as user_status, u.muted_until, u.ban_until,
           n.title as notification_title, n.content as notification_content, n.created_at as punishment_at,
           p.content as post_content, p.images as post_images, p.status as post_status, p.created_at as post_created_at,
           c.content as comment_content, c.status as comment_status, c.created_at as comment_created_at,
           cp.id as original_post_id, cp.content as original_post_content, cp.images as original_post_images,
           cp.status as original_post_status, cp.created_at as original_post_created_at
    FROM appeals a
    JOIN users u ON a.user_id = u.id
    JOIN notifications n ON a.notification_id = n.id
    LEFT JOIN posts p ON a.appeal_type = 'post_deleted' AND p.id = a.target_id
    LEFT JOIN comments c ON a.appeal_type = 'comment_deleted' AND c.id = a.target_id
    LEFT JOIN posts cp ON c.post_id = cp.id
    WHERE a.status = ?
    ORDER BY a.created_at DESC LIMIT ? OFFSET ?
  `).all(status, limit, offset);
  const histories = Object.create(null);
  for (const appeal of appeals) {
    if (!histories[appeal.user_id]) histories[appeal.user_id] = loadAppealCaseHistory(appeal.user_id);
    Object.assign(appeal, histories[appeal.user_id]);
  }
  res.json({ appeals, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

router.put('/appeals/:id/handle', adminAuth, (req, res) => {
  const decision = req.body.decision === 'approved' ? 'approved' : req.body.decision === 'rejected' ? 'rejected' : '';
  if (!decision) return res.status(400).json({ error: '无效的审核决定' });
  const appeal = db.prepare('SELECT * FROM appeals WHERE id = ?').get(req.params.id);
  if (!appeal) return res.status(404).json({ error: '申诉不存在' });
  if (appeal.status !== 'pending') return res.status(409).json({ error: '该申诉已经处理' });
  const note = decision === 'rejected'
    ? buildAppealRejectionNote(req.body.reason, req.body.detail)
    : String(req.body.note || '').trim().slice(0, 1000);
  if (decision === 'rejected' && !note) {
    return res.status(400).json({ error: '请选择驳回原因；选择“其他”时必须填写补充说明' });
  }

  const handle = db.transaction(() => {
    if (decision === 'approved') {
      if (appeal.appeal_type === 'post_deleted') {
        db.prepare("UPDATE posts SET status = 'active', delete_reason = '', deleted_at = NULL, updated_at = datetime('now','+8 hours') WHERE id = ?").run(appeal.target_id);
      } else if (appeal.appeal_type === 'comment_deleted') {
        db.prepare("UPDATE comments SET status = 'active' WHERE id = ?").run(appeal.target_id);
      } else if (appeal.appeal_type === 'muted') {
        db.prepare('UPDATE users SET muted_until = NULL WHERE id = ?').run(appeal.user_id);
      } else if (appeal.appeal_type === 'banned') {
        db.prepare("UPDATE users SET status = 'active', ban_reason = '', ban_until = NULL WHERE id = ?").run(appeal.user_id);
      }
    }
    db.prepare(`
      UPDATE appeals SET status = ?, decision = ?, handle_note = ?, handled_by = ?,
             handled_at = datetime('now','+8 hours') WHERE id = ?
    `).run(decision, decision, note, req.adminId, appeal.id);
    createSystemNotification(
      appeal.user_id,
      'appeal_result',
      decision === 'approved' ? '申诉已通过' : '申诉已驳回',
      decision === 'approved'
        ? `你的申诉已通过，相关处罚已解除。${note ? `管理员说明：${note}` : ''}`
        : `你的申诉未通过。${note ? `管理员说明：${note}` : '原处罚继续生效。'}`,
      appeal.id,
    );
    logAdmin(req.adminId, 'handle_appeal', 'appeal', appeal.id, `${decision}: ${note}`, req.ip);
  });
  handle();
  req.app.get('ws')?.send(appeal.user_id, {
    type: 'account_restriction',
    restriction: decision === 'approved' ? 'appeal_approved' : 'appeal_rejected',
  });
  res.json({ ok: true, decision });
});

router.get('/users/:id/history', adminAuth, (req, res) => {
  const user = db.prepare(`
    SELECT id, username, nickname, avatar, status, muted_until, ban_until, created_at
    FROM users WHERE id = ?
  `).get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const type = req.query.type === 'comments' ? 'comments' : 'posts';
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  if (type === 'comments') {
    const total = db.prepare('SELECT COUNT(*) as c FROM comments WHERE user_id = ?').get(user.id).c;
    const items = db.prepare(`
      SELECT c.*, p.content as post_content, p.images as post_images, p.status as post_status
      FROM comments c LEFT JOIN posts p ON c.post_id = p.id
      WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?
    `).all(user.id, limit, offset);
    return res.json({ user, type, items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  }
  const total = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(user.id).c;
  const items = db.prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(user.id, limit, offset);
  res.json({ user, type, items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

// 评论审核
router.get('/comments', adminAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1, limit = 20, offset = (page - 1) * limit;
  const total = db.prepare('SELECT COUNT(*) as c FROM comments').get().c;
  const comments = db.prepare(`SELECT c.*,u.username,u.nickname,p.content as post_content FROM comments c JOIN users u ON c.user_id=u.id JOIN posts p ON c.post_id=p.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
  res.json({ comments, total, page, totalPages: Math.ceil(total / limit) });
});

// ====== 管理员列表 ======
router.get('/admins', adminAuth, requireSuperAdmin, (req, res) => {
  const admins = db.prepare("SELECT id, username, nickname, role, status, created_at FROM users WHERE role IN ('admin','reviewer','superadmin','app_admin') ORDER BY created_at DESC").all();
  res.json(admins);
});

// ====== 操作日志 ======
router.get('/logs', adminAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(10, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const action = String(req.query.action || '').trim();
  const targetType = String(req.query.target_type || '').trim();
  const adminId = String(req.query.admin_id || '').trim();
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date_from || '')) ? `${req.query.date_from} 00:00:00` : '';
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date_to || '')) ? `${req.query.date_to} 23:59:59` : '';
  const conditions = [];
  const params = [];
  if (search) {
    conditions.push('(l.detail LIKE ? OR l.target_id LIKE ? OR l.ip_address LIKE ? OR l.action LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?)');
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword, keyword, keyword, keyword);
  }
  if (action) { conditions.push('l.action = ?'); params.push(action); }
  if (targetType) { conditions.push('l.target_type = ?'); params.push(targetType); }
  if (adminId) { conditions.push('l.admin_id = ?'); params.push(adminId); }
  if (dateFrom) { conditions.push('l.created_at >= ?'); params.push(dateFrom); }
  if (dateTo) { conditions.push('l.created_at <= ?'); params.push(dateTo); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = db.prepare(`
    SELECT COUNT(*) AS c
    FROM admin_logs l LEFT JOIN users u ON l.admin_id = u.id
    ${where}
  `).get(...params).c;
  const logs = db.prepare(`
    SELECT l.*, u.username AS admin_name, u.nickname AS admin_nickname
    FROM admin_logs l LEFT JOIN users u ON l.admin_id = u.id
    ${where}
    ORDER BY l.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const todayStart = `${nowCst().slice(0, 10)} 00:00:00`;
  const sevenDaysStart = addCst({ days: -6 }).slice(0, 10) + ' 00:00:00';
  const summary = {
    total: db.prepare('SELECT COUNT(*) AS c FROM admin_logs').get().c,
    today: db.prepare('SELECT COUNT(*) AS c FROM admin_logs WHERE created_at >= ?').get(todayStart).c,
    last7d: db.prepare('SELECT COUNT(*) AS c FROM admin_logs WHERE created_at >= ?').get(sevenDaysStart).c,
    activeAdmins: db.prepare('SELECT COUNT(DISTINCT admin_id) AS c FROM admin_logs WHERE created_at >= ?').get(sevenDaysStart).c,
  };
  const admins = db.prepare(`
    SELECT DISTINCT l.admin_id AS id, COALESCE(u.nickname, u.username, l.admin_id) AS name
    FROM admin_logs l LEFT JOIN users u ON l.admin_id = u.id
    ORDER BY name
  `).all();
  const actions = db.prepare('SELECT DISTINCT action FROM admin_logs ORDER BY action').all().map((row) => row.action);
  const targetTypes = db.prepare('SELECT DISTINCT target_type FROM admin_logs ORDER BY target_type').all().map((row) => row.target_type);
  res.json({ logs, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), summary, admins, actions, targetTypes });
});

// ====== 管理员修改自身密码 ======
router.put('/change-password', adminAuth, asyncRoute(async (req, res) => {
  const old_password = typeof req.body?.old_password === 'string' ? req.body.old_password : '';
  const new_password = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
  if (!old_password || !new_password || old_password.length > 128 || new_password.length > 128) return res.status(400).json({ error: '请填写有效的密码' });
  if (new_password.length < 12) return res.status(400).json({ error: '新密码至少12位' });
  const user = db.prepare("SELECT password_hash FROM users WHERE id=? AND role IN ('admin','reviewer','superadmin')").get(req.adminId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (!await comparePassword(old_password, user.password_hash)) {
    return res.status(400).json({ error: '当前密码错误' });
  }
  const hash = await hashPassword(new_password, 10);
  db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?').run(hash, req.adminId);
  logAdmin(req.adminId, 'change_admin_password', 'user', req.adminId, 'password_changed', req.ip);
  res.json({ ok: true });
}));

// ====== 管理员修改自身登录ID ======
router.put('/change-username', adminAuth, (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  if (!username || !username.trim()) return res.status(400).json({ error: '登录ID不能为空' });
  if (username.trim().length < 3) return res.status(400).json({ error: '登录ID至少3位' });
  if (username.trim().length > 64) return res.status(400).json({ error: '登录ID不能超过64位' });
  const exist = db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(username.trim(), req.adminId);
  if (exist) return res.status(409).json({ error: '该登录ID已被占用' });
  db.prepare('UPDATE users SET username=? WHERE id=?').run(username.trim(), req.adminId);
  res.json({ ok: true, username: username.trim() });
});

// 辅助：记录管理员操作
function logAdmin(adminId, action, targetType, targetId, detail, ip) {
  const id = uuid();
  db.prepare('INSERT INTO admin_logs (id, admin_id, action, target_type, target_id, detail, ip_address, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, adminId, action, targetType, targetId, detail, ip || '', nowCst());
}

module.exports = router;


// 图表数据
router.get('/chart/users', adminAuth, (req, res) => {
  const days = db.prepare("SELECT date(created_at) as d, COUNT(*) as c FROM users GROUP BY d ORDER BY d DESC LIMIT 30").all();
  res.json(days.reverse());
});

router.get('/feedback', adminAuth, (req, res) => {
  const uid = String(req.query.uid || '').trim();
  const rows = db.prepare(`SELECT f.id,f.user_id,f.content,f.image_url,f.device_model,f.os_version,f.app_version,f.status,f.admin_note,f.reviewed_at,f.reply_content,f.replied_at,f.created_at,f.updated_at,
    u.nickname,u.avatar,u.username FROM user_feedback f JOIN users u ON u.id=f.user_id
    ${uid ? 'WHERE u.id LIKE ?' : ''} ORDER BY f.created_at DESC`).all(...(uid ? [`%${uid}%`] : []));
  res.json({ feedback: rows });
});

function feedbackDateText(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : '此前';
}

router.put('/feedback/:id/review', adminAuth, (req, res) => {
  const feedback = db.prepare('SELECT * FROM user_feedback WHERE id=?').get(req.params.id);
  if (!feedback) return res.status(404).json({ error: '反馈不存在' });
  if (!feedback.reviewed_at) {
    db.prepare("UPDATE user_feedback SET status='reviewed',reviewed_at=datetime('now','+8 hours'),updated_at=datetime('now','+8 hours') WHERE id=?").run(feedback.id);
    createSystemNotification(feedback.user_id, 'feedback_reviewed', '反馈已查看', `肆度官方已查看了您于${feedbackDateText(feedback.created_at)}提交的反馈，感谢您的建议！`, feedback.id);
    logAdmin(req.adminId, 'review_feedback', 'feedback', feedback.id, '标记反馈为已查看', req.ip);
  }
  res.json({ ok: true });
});

router.put('/feedback/:id/reply', adminAuth, (req, res) => {
  const reply = String(req.body?.reply || '').trim();
  if (!reply) return res.status(400).json({ error: '回复内容不能为空' });
  if (reply.length > 2000) return res.status(400).json({ error: '回复内容不能超过 2000 字' });
  const feedback = db.prepare('SELECT * FROM user_feedback WHERE id=?').get(req.params.id);
  if (!feedback) return res.status(404).json({ error: '反馈不存在' });
  db.prepare("UPDATE user_feedback SET status='reviewed',reviewed_at=COALESCE(reviewed_at,datetime('now','+8 hours')),reply_content=?,replied_at=datetime('now','+8 hours'),updated_at=datetime('now','+8 hours') WHERE id=?").run(reply, feedback.id);
  createSystemNotification(feedback.user_id, 'feedback_reply', '肆度官方回复了您的反馈', `您于${feedbackDateText(feedback.created_at)}提交的反馈收到回复，请点击进入【历史反馈】进行查看。`, feedback.id);
  logAdmin(req.adminId, 'reply_feedback', 'feedback', feedback.id, `回复反馈：${reply.slice(0, 120)}`, req.ip);
  res.json({ ok: true });
});

// 导出用户 CSV
function csvCell(value) {
  let text = String(value ?? '').replace(/\0/g, '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

router.get('/users/export', adminAuth, (req, res) => {
  const users = db.prepare('SELECT username,nickname,phone,email,role,status,login_count,last_login_at,created_at FROM users ORDER BY created_at DESC').all();
  var csv = '\uFEFF' + ['用户名','昵称','手机号','邮箱','角色','状态','登录次数','最后登录','注册时间'].map(csvCell).join(',') + '\n';
  users.forEach(function(u) {
    csv += [u.username,u.nickname||'',u.phone||'',u.email||'',u.role,u.status,u.login_count,u.last_login_at||'',u.created_at].map(csvCell).join(',') + '\n';
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
  res.send(csv);
});

// 历史拆分文件中的后台功能统一注册到同一个 Router。
require('./append')(router, { adminAuth, requireSuperAdmin, db, uuid, logAdmin });
require('./append2')(router, { adminAuth, requireSuperAdmin, db, uuid, logAdmin, deleteCommentByAdmin });
require('./append3')(router, { adminAuth, requireSuperAdmin, db, uuid, logAdmin });
require('./append4')(router, { adminAuth, db, uuid, logAdmin, deletePostByAdmin, deleteCommentByAdmin, applyAdminMute, applyAdminBan });
require('./append5')(router, { adminAuth, requireSuperAdmin, db, uuid, logAdmin });
