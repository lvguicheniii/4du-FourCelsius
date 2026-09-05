const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { isApprovedMediaUrl } = require('../lib/media-ownership');

const router = Router();

function canonicalStickerUrl(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    const parsed = new URL(input);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return input.split(/[?#]/, 1)[0];
  }
}

function findSticker(userId, requestedUrl) {
  const canonical = canonicalStickerUrl(requestedUrl);
  if (!canonical) return null;
  const stickers = db.prepare('SELECT id, url, created_at FROM user_stickers WHERE user_id = ? ORDER BY created_at ASC, id ASC').all(userId);
  return stickers.find((sticker) => canonicalStickerUrl(sticker.url) === canonical) || null;
}

// 获取我的表情包
router.get('/', auth, (req, res) => {
  const stickers = db.prepare('SELECT id, url FROM user_stickers WHERE user_id = ? ORDER BY created_at ASC, id ASC').all(req.userId);
  res.json(stickers.map(s => s.url));
});

// 添加表情包
router.post('/', auth, (req, res) => {
  const sourceUrl = String(req.body?.url || '').trim();
  if (!isApprovedMediaUrl(sourceUrl, req)) return res.status(400).json({ error: '表情包地址无效' });
  const url = canonicalStickerUrl(sourceUrl);
  if (!url) return res.status(400).json({ error: '缺少 URL' });
  const id = uuid();
  db.prepare("INSERT INTO user_stickers (id, user_id, url, created_at) VALUES (?,?,?,datetime('now','+8 hours'))").run(id, req.userId, url);
  res.json({ id, url });
});

// 将表情包移到面板最前
router.put('/front', auth, (req, res) => {
  const url = canonicalStickerUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: '缺少 URL' });

  const sticker = findSticker(req.userId, url);
  if (!sticker) return res.status(404).json({ error: '表情包不存在' });

  const first = db.prepare('SELECT id, created_at FROM user_stickers WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 1').get(req.userId);
  if (first && first.id !== sticker.id) {
    db.prepare("UPDATE user_stickers SET created_at = datetime(?, '-1 second') WHERE id = ? AND user_id = ?")
      .run(first.created_at, sticker.id, req.userId);
  }
  res.json({ ok: true, url });
});

// 按 URL 删除，客户端列表无需暴露数据库 ID
router.delete('/by-url', auth, (req, res) => {
  const url = canonicalStickerUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: '缺少 URL' });
  const sticker = findSticker(req.userId, url);
  if (!sticker) return res.status(404).json({ error: '表情包不存在' });
  db.prepare('DELETE FROM user_stickers WHERE id = ? AND user_id = ?').run(sticker.id, req.userId);
  res.json({ ok: true, url });
});

// 删除表情包
router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM user_stickers WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

module.exports = router;
