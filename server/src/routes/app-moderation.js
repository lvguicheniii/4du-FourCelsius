const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { addCst, nowCst } = require('../lib/time');
const { isValidPenaltyReason, normalizePenaltyReason } = require('../lib/penalty-reasons');
const { idempotent } = require('../middleware/idempotency');

const router = express.Router();

function notify(userId, type, title, content, relatedId) {
  db.prepare(`INSERT INTO notifications(id,user_id,category,type,title,content,related_id,created_at)
    VALUES (?,?,'system',?,?,?,?,datetime('now','+8 hours'))`)
    .run(uuid(), userId, type, title, content, relatedId || '');
}

router.post('/posts/:id/action', auth, idempotent('app-moderation.post-action'), (req, res) => {
  if (req.user?.role !== 'app_admin') return res.status(403).json({ error: '需要 APP 管理员权限' });
  const action = String(req.body?.action || '');
  const reason = normalizePenaltyReason(req.body?.reason);
  if (!['delete', 'mute', 'ban'].includes(action)) return res.status(400).json({ error: '无效的管理操作' });
  if (!isValidPenaltyReason(reason)) return res.status(400).json({ error: '请选择标准违规原因；选择“其他”时必须填写补充说明' });
  const post = db.prepare(`SELECT p.id,p.user_id,p.status,u.role FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`).get(req.params.id);
  if (!post) return res.status(404).json({ error: '切片不存在' });
  if (post.role !== 'user') return res.status(403).json({ error: '不能对管理人员执行该操作' });
  let detail = '';
  let restriction = null;
  try {
    db.transaction(() => {
  if (action === 'delete') {
    const changed = db.prepare("UPDATE posts SET status='deleted',delete_reason=?,deleted_at=?,updated_at=? WHERE id=? AND status='active'").run(reason, nowCst(), nowCst(), post.id);
    if (changed.changes !== 1) {
      const error = new Error('该切片已经被处理');
      error.status = 409;
      throw error;
    }
    notify(post.user_id, 'post_deleted', '切片删除通知', `你的切片已被管理员删除。原因：${reason}`, post.id);
    detail = `APP管理员删除切片；原因：${reason}`;
  } else if (action === 'mute') {
    const hours = Math.min(Math.max(parseInt(req.body?.hours, 10) || 12, 1), 8760);
    const until = addCst({ hours });
    db.prepare('UPDATE users SET muted_until=? WHERE id=?').run(until, post.user_id);
    notify(post.user_id, 'muted', '禁言通知', `你已被禁言 ${hours} 小时。原因：${reason}`, post.user_id);
    restriction = 'muted';
    detail = `APP管理员禁言 ${hours}h；原因：${reason}`;
  } else {
    const days = Math.min(Math.max(parseInt(req.body?.days, 10) || 1, 1), 3650);
    const until = addCst({ days });
    db.prepare("UPDATE users SET status='banned',ban_reason=?,ban_until=?,entropy_lv4_earned=0 WHERE id=?").run(reason, until, post.user_id);
    notify(post.user_id, 'banned', '封禁通知', `你的账号已被封禁 ${days} 天。原因：${reason}`, post.user_id);
    restriction = 'banned';
    detail = `APP管理员封禁 ${days}d；原因：${reason}`;
  }
  db.prepare(`INSERT INTO admin_logs(id,admin_id,action,target_type,target_id,detail,ip_address,created_at)
    VALUES (?,?,?,?,?,?,?,datetime('now','+8 hours'))`)
    .run(uuid(), req.user.id, `app_${action}`, action === 'delete' ? 'post' : 'user', action === 'delete' ? post.id : post.user_id, detail, req.ip || '');
    })();
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || '处置失败，请稍后重试' });
  }
  if (restriction) req.app.get('ws')?.send(post.user_id, { type: 'account_restriction', restriction });
  req.app.get('ws')?.broadcastCoalesced?.(`post-stats:${post.id}`, { type: 'post_stats_changed', relatedId: post.id });
  res.json({ ok: true, action });
});

module.exports = router;
