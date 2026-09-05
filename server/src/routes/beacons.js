const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth, optionalAuth } = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const { triggerAchievement } = require('../lib/achievements');
const { idempotent } = require('../middleware/idempotency');
const { isOwnedMediaUrl } = require('../lib/media-ownership');

// 投放/更新深海信标（每人仅一枚，upsert）
router.post('/', auth, idempotent('beacons.upsert'), (req, res) => {
  const { content, image } = req.body;
  if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: '请输入信标内容' });
  if (Array.from(content.trim()).length > 200) return res.status(400).json({ error: '信标内容不能超过 200 字' });
  if (image != null && image !== '' && (typeof image !== 'string' || !isOwnedMediaUrl(image, req.userId, req))) {
    return res.status(400).json({ error: '信标图片尚未上传，请重新选择' });
  }

  const existing = db.prepare('SELECT id FROM beacons WHERE user_id = ?').get(req.userId);
  if (existing) {
    db.prepare('UPDATE beacons SET content = ?, image = ?, created_at = datetime(\'now\',\'+8 hours\') WHERE id = ?')
      .run(content.trim(), image || null, existing.id);
    res.json({ ok: true, id: existing.id });
  } else {
    const id = 'beacon_' + uuid();
    db.prepare('INSERT INTO beacons (id, user_id, content, image) VALUES (?,?,?,?)')
      .run(id, req.userId, content.trim(), image || null);
    triggerAchievement(db, req.userId, 'hz52_broadcast', { ws: req.app.get('ws') });
    res.json({ ok: true, id });
  }
});

// 获取当前用户的深海信标
router.get('/mine', auth, (req, res) => {
  const b = db.prepare(`
    SELECT b.*, u.nickname, u.username, u.avatar
    FROM beacons b LEFT JOIN users u ON b.user_id = u.id
    WHERE b.user_id = ?
  `).get(req.userId);
  if (!b) return res.json({ beacon: null });
  res.json({ beacon: {
    id: b.id, content: b.content, image: b.image, createdAt: b.created_at,
    nickname: b.nickname || b.username, username: b.username, avatar: b.avatar,
  }});
});

// 获取所有深海信标（供声呐模式，不含当前用户）
router.get('/', optionalAuth, (req, res) => {
  const gender = ['male', 'female'].includes(req.query.gender) ? req.query.gender : '';
  const beacons = req.userId ? db.prepare(`
    SELECT b.*, u.nickname, u.username, u.avatar, u.gender
    FROM beacons b LEFT JOIN users u ON b.user_id = u.id
    WHERE b.user_id != ? AND (? = '' OR u.gender = ?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks x
        WHERE (x.user_id=? AND x.blocked_user_id=b.user_id)
           OR (x.user_id=b.user_id AND x.blocked_user_id=?)
      )
    ORDER BY b.created_at DESC LIMIT 200
  `).all(req.userId, gender, gender, req.userId, req.userId) : db.prepare(`
    SELECT b.*, u.nickname, u.username, u.avatar, u.gender
    FROM beacons b LEFT JOIN users u ON b.user_id = u.id
    WHERE (? = '' OR u.gender = ?)
    ORDER BY b.created_at DESC LIMIT 200
  `).all(gender, gender);
  res.json({ beacons: beacons.map(b => ({
    id: b.id, content: b.content, image: b.image, createdAt: b.created_at,
    nickname: b.nickname || b.username, username: b.username, avatar: b.avatar,
  })) });
});

// 统计：失温切片数 + 信标数
router.get('/counts', optionalAuth, (req, res) => {
  // 展示的是全站潜流规模，所有用户、游客和性别模式下必须一致。
  // 实际打捞/共振接口仍会排除当前用户，并按选择的性别筛选匹配对象。
  const beacons = db.prepare('SELECT COUNT(*) as c FROM beacons').get();
  const allPosts = db.prepare(
    `SELECT p.likes_count, p.refrigerant_count, p.created_at, p.updated_at, p.board_id
     FROM posts p
     WHERE p.status = 'active'
     ORDER BY p.updated_at DESC LIMIT 500`
  ).all();
  const { calculateTemperature } = require('../utils/temperature');
  const undercurrentCount = allPosts.filter(
    p => calculateTemperature(p.likes_count, p.created_at, p.updated_at, p.board_id, p.refrigerant_count) > 16
  ).length;
  res.json({ undercurrent: undercurrentCount, beacons: beacons.c });
});

module.exports = router;
