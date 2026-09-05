const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { sendPushToUser } = require('../lib/push');
const { idempotent } = require('../middleware/idempotency');

const router = Router();

router.get('/blocks', auth, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.avatar, b.created_at
    FROM blocks b JOIN users u ON u.id = b.blocked_user_id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC
  `).all(req.userId);
  res.json({ users });
});

router.put('/blocks/:userId', auth, (req, res) => {
  const targetId = req.params.userId;
  const blocked = req.body.blocked !== false;
  if (targetId === req.userId) return res.status(400).json({ error: '不能拉黑自己' });
  const target = db.prepare("SELECT id FROM users WHERE id = ? AND status != 'deleted'").get(targetId);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const [userA, userB] = [req.userId, targetId].sort();
  let relationshipBlocked = blocked;
  db.transaction(() => {
    if (blocked) {
      db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_user_id) VALUES (?, ?)').run(req.userId, targetId);
      db.prepare('INSERT OR IGNORE INTO mutual_hides (user_a, user_b) VALUES (?, ?)').run(userA, userB);
      db.prepare(`
        DELETE FROM follows
        WHERE (follower_id = ? AND following_id = ?)
           OR (follower_id = ? AND following_id = ?)
      `).run(req.userId, targetId, targetId, req.userId);
    } else {
      db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_user_id = ?').run(req.userId, targetId);
      const reverse = db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_user_id = ?').get(targetId, req.userId);
      relationshipBlocked = !!reverse;
      if (!reverse) db.prepare('DELETE FROM mutual_hides WHERE user_a = ? AND user_b = ?').run(userA, userB);
    }
  })();
  const ws = req.app.get('ws');
  ws?.updateBlockPair?.(req.userId, targetId, relationshipBlocked);
  ws?.send(req.userId, { type: 'reef_block_changed', otherUserId: targetId });
  ws?.send(targetId, { type: 'reef_block_changed', otherUserId: req.userId });
  res.json({ blocked });
});

// 关注用户
router.post('/:userId', auth, idempotent('follows.set'), (req, res) => {
  if (req.userId === req.params.userId) return res.status(400).json({ error: '不能关注自己' });
  const target = db.prepare("SELECT id FROM users WHERE id = ? AND status != 'deleted'").get(req.params.userId);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const blocked = db.prepare(`
    SELECT 1 FROM blocks
    WHERE (user_id=? AND blocked_user_id=?)
       OR (user_id=? AND blocked_user_id=?)
  `).get(req.userId, req.params.userId, req.params.userId, req.userId);
  if (blocked) return res.status(403).json({ error: '当前无法关注该用户' });
  const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.userId, req.params.userId);
  const following = typeof req.body?.following === 'boolean' ? req.body.following : !existing;
  const changed = following !== !!existing;
  if (!following) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.userId, req.params.userId);
  } else {
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?,?)').run(req.userId, req.params.userId);
  }
  if (changed && following) {
    const fNick = req.user?.nickname || req.user?.username || '用户';
    db.prepare(`INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at) VALUES (?,?,?,?,?,?,?,datetime('now','+8 hours'))`)
      .run(uuid(), req.params.userId, 'interaction', 'follow', '关注通知', fNick + ' 关注了你', req.userId);
    // WebSocket 实时推送
    const ws = req.app.get('ws');
    if (ws) {
      ws.send(req.params.userId, {
        type: 'notification',
        category: 'interaction',
        title: '关注通知',
        content: fNick + ' 关注了你',
        relatedId: req.userId,
      });
    }
    sendPushToUser(req.params.userId, {
      title: '关注通知',
      body: `${fNick} 关注了你`,
      data: { type: 'follow', userId: req.userId },
    });
  }
  const followedBy = !!db.prepare(
    'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
  ).get(req.params.userId, req.userId);
  res.json({ following, followedBy, mutuallyFollowing: following && followedBy });
});

router.get('/status/:userId', auth, (req, res) => {
  const following = !!db.prepare(
    'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
  ).get(req.userId, req.params.userId);
  const followedBy = !!db.prepare(
    'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
  ).get(req.params.userId, req.userId);
  res.json({ following, followedBy, mutuallyFollowing: following && followedBy });
});

router.get('/following/:userId', auth, (req, res) => {
  const target = db.prepare("SELECT 1 FROM users WHERE id = ? AND status != 'deleted'").get(req.params.userId);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const users = db.prepare(`SELECT u.id, u.username, u.nickname, u.avatar FROM follows f JOIN users u ON f.following_id = u.id WHERE f.follower_id = ? AND u.status != 'deleted' ORDER BY f.created_at DESC`).all(req.params.userId);
  res.json(users.map(u => ({ id: u.id, username: u.username, nickname: u.nickname, avatar: u.avatar })));
});

router.get('/followers/:userId', auth, (req, res) => {
  const target = db.prepare("SELECT 1 FROM users WHERE id = ? AND status != 'deleted'").get(req.params.userId);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const users = db.prepare(`SELECT u.id, u.username, u.nickname, u.avatar FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ? AND u.status != 'deleted' ORDER BY f.created_at DESC`).all(req.params.userId);
  res.json(users.map(u => ({ id: u.id, username: u.username, nickname: u.nickname, avatar: u.avatar })));
});

module.exports = router;
