const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db');

const USER_VISIBLE_NOTIFICATION_SQL = " AND n.title NOT IN ('系统运维告警','系统运维恢复')";

function parseMetadata(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ====== 查询 ======

// 获取通知列表（可按分类筛选）
router.get('/', (req, res) => {
  const category = req.query.category;
  let query = `
    SELECT n.*,u.nickname AS actor_nickname,u.username AS actor_username,u.avatar AS actor_avatar
    FROM notifications n
    LEFT JOIN users u ON n.type='follow' AND u.id=n.related_id
    WHERE n.user_id = ?
  `;
  query += USER_VISIBLE_NOTIFICATION_SQL;
  const params = [req.userId];

  if (category && (category === 'system' || category === 'interaction')) {
    if (category === 'system') {
      query += " AND (n.category = 'system' OR n.type = 'system')";
    } else {
      query += " AND n.category = 'interaction' AND n.type != 'system'";
    }
  }

  query += ' ORDER BY n.created_at DESC LIMIT 100';

  const notifs = db.prepare(query).all(...params);
  const appealByNotification = new Map(
    db.prepare(`
      SELECT id, notification_id, status, decision, handle_note, created_at, handled_at
      FROM appeals WHERE user_id = ?
    `).all(req.userId).map(a => [a.notification_id, a]),
  );
  res.json(notifs.map(n => {
    const metadata = parseMetadata(n.metadata_json);
    return {
      id: n.id,
      category: n.type === 'system' ? 'system' : (n.category || 'interaction'),
      type: n.type,
      title: n.title,
      content: n.type === 'follow' && (n.actor_nickname || n.actor_username)
        ? `${n.actor_nickname || n.actor_username} 关注了你`
        : n.content,
      relatedId: n.related_id,
      metadata,
      actorId: n.type === 'follow' ? n.related_id : (metadata.actorId || null),
      actorName: n.type === 'follow' ? (n.actor_nickname || n.actor_username || null) : (metadata.actorName || null),
      actorAvatar: n.type === 'follow' ? (n.actor_avatar || null) : null,
      isRead: !!n.is_read,
      createdAt: n.created_at,
      appeal: appealByNotification.get(n.id) || null,
    };
  }));
});

// 对处罚通知发起申诉
router.post('/:id/appeal', (req, res) => {
  const notification = db.prepare(`
    SELECT id, user_id, type, related_id, title, content
    FROM notifications WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);
  if (!notification) return res.status(404).json({ error: '通知不存在' });
  const eligibleTypes = new Set(['post_deleted', 'comment_deleted', 'muted', 'banned']);
  if (!eligibleTypes.has(notification.type)) {
    return res.status(400).json({ error: '该通知不支持申诉' });
  }
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 10) return res.status(400).json({ error: '申诉理由至少填写 10 个字' });
  if (reason.length > 1000) return res.status(400).json({ error: '申诉理由不能超过 1000 字' });
  const existing = db.prepare('SELECT id, status FROM appeals WHERE notification_id = ?').get(notification.id);
  if (existing) return res.status(409).json({ error: '这项处罚已经提交过申诉', appeal: existing });

  const id = uuid();
  db.prepare(`
    INSERT INTO appeals (id, user_id, notification_id, appeal_type, target_id, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.userId, notification.id, notification.type, notification.related_id || '', reason);
  res.status(201).json({ ok: true, appeal: { id, status: 'pending' } });
});

// 标记已读
router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  const category = req.query.category;
  if (category === 'system') {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND (category = 'system' OR type = 'system')").run(req.userId);
  } else if (category === 'interaction') {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND category = 'interaction' AND type != 'system'").run(req.userId);
  } else {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.userId);
  }
  res.json({ ok: true });
});

// 未读数（支持分类）
router.get('/unread-count', (req, res) => {
  const category = req.query.category;
  let query = "SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0 AND title NOT IN ('系统运维告警','系统运维恢复')";
  const params = [req.userId];
  if (category && (category === 'system' || category === 'interaction')) {
    if (category === 'system') {
      query += " AND (category = 'system' OR type = 'system')";
    } else {
      query += " AND category = 'interaction' AND type != 'system'";
    }
  }
  const total = db.prepare(query).get(...params);

  // 同时返回两个分类的未读数
  const sys = db.prepare("SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0 AND title NOT IN ('系统运维告警','系统运维恢复') AND (category = 'system' OR type = 'system')").get(req.userId);
  const inter = db.prepare("SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0 AND title NOT IN ('系统运维告警','系统运维恢复') AND category = 'interaction' AND type != 'system'").get(req.userId);

  res.json({
    total: total.cnt,
    system: sys.cnt,
    interaction: inter.cnt,
  });
});

// ====== 系统通知发送 ======

function sendSystemNotification(userId, type, title, content, relatedId = '') {
  db.prepare("INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at) VALUES (?,?,?,?,?,?,?,datetime('now','+8 hours'))")
    .run(uuid(), userId, 'system', type, title, content, relatedId);
}

// 欢迎通知（注册后调用）
function sendWelcome(userId) {
  sendSystemNotification(userId, 'welcome', '欢迎来到肆度', '这里是收纳情绪的空间。记住，4°C 是一切开始的地方。');
}

// 帖子被删除通知
function postDeleted(userId, postContent) {
  const preview = (postContent || '你的帖子').slice(0, 20);
  sendSystemNotification(userId, 'post_deleted', '帖子已被删除', `你的帖子「${preview}」因违反社区规定已被删除。`);
}

// 账号禁言通知
function accountMuted(userId, reason) {
  sendSystemNotification(userId, 'muted', '账号已被禁言', reason || '你的账号因违规行为已被禁言，请联系管理员。');
}

// 账号解封通知
function accountUnmuted(userId) {
  sendSystemNotification(userId, 'unmuted', '账号已解封', '你的账号已恢复正常使用，请遵守社区规定。');
}

module.exports = {
  router,
  sendWelcome,
  postDeleted,
  accountMuted,
  accountUnmuted,
};
