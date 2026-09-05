const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth, optionalAuth } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotency');

const router = Router();

function normalizeName(value) {
  return String(value || '').trim();
}

router.get('/', auth, (req, res) => {
  const boxes = db.prepare(`
    SELECT sb.id, sb.name, sb.created_at,
           COUNT(CASE WHEN p.status='active' THEN 1 END) AS post_count
    FROM slice_boxes sb
    LEFT JOIN posts p ON p.slice_box_id=sb.id AND p.user_id=sb.user_id
    WHERE sb.user_id=?
    GROUP BY sb.id
    ORDER BY sb.created_at DESC
  `).all(req.userId);
  res.json({ boxes: boxes.map(box => ({
    id: box.id,
    name: box.name,
    postCount: Number(box.post_count) || 0,
    createdAt: box.created_at,
  })) });
});

router.post('/', auth, idempotent('slice-boxes.create'), (req, res) => {
  const name = normalizeName(req.body.name);
  const length = Array.from(name).length;
  if (!length) return res.status(400).json({ error: '请输入切片盒名称' });
  if (length > 8) return res.status(400).json({ error: '切片盒名称最多 8 个字' });
  const id = `box_${uuid()}`;
  db.prepare('INSERT INTO slice_boxes(id,user_id,name) VALUES (?,?,?)')
    .run(id, req.userId, name);
  res.status(201).json({ id, name, postCount: 0 });
});

router.put('/:id', auth, (req, res) => {
  const name = normalizeName(req.body?.name);
  const length = Array.from(name).length;
  if (!length) return res.status(400).json({ error: '请输入切片盒名称' });
  if (length > 8) return res.status(400).json({ error: '切片盒名称最多8个字' });
  const box = db.prepare('SELECT id FROM slice_boxes WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!box) return res.status(404).json({ error: '切片盒不存在或无权操作' });
  db.prepare('UPDATE slice_boxes SET name=? WHERE id=? AND user_id=?').run(name, req.params.id, req.userId);
  res.json({ id: req.params.id, name });
});

router.get('/:id', optionalAuth, (req, res) => {
  const box = db.prepare(`
    SELECT sb.id,sb.name,sb.user_id,sb.created_at,u.nickname,u.username
    FROM slice_boxes sb
    LEFT JOIN users u ON u.id=sb.user_id
    WHERE sb.id=?
  `).get(req.params.id);
  if (!box) return res.status(404).json({ error: '切片盒不存在' });
  const isOwner = !!req.userId && box.user_id === req.userId;
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM posts
    WHERE slice_box_id=? AND user_id=? AND status='active'
      AND (?=1 OR COALESCE(visibility,'public')='public')
  `).get(box.id, box.user_id, isOwner ? 1 : 0);
  res.json({
    id: box.id,
    name: box.name,
    ownerId: box.user_id,
    ownerName: box.nickname || box.username || '未知用户',
    postCount: Number(count.count) || 0,
    createdAt: box.created_at,
  });
});

module.exports = router;
