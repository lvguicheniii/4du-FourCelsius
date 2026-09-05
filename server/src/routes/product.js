const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { nowCst } = require('../lib/time');

const router = Router();

router.put('/push-token', auth, (req, res) => {
  const token = String(req.body.token || '').trim();
  const platform = ['android', 'ios'].includes(req.body.platform) ? req.body.platform : 'unknown';
  if (!/^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/.test(token)) {
    return res.status(400).json({ error: '无效的推送设备令牌' });
  }
  db.prepare(`
    INSERT INTO device_push_tokens(id,user_id,token,platform,enabled,last_seen_at)
    VALUES (?,?,?,?,1,?)
    ON CONFLICT(token) DO UPDATE SET
      user_id=excluded.user_id, platform=excluded.platform, enabled=1, last_seen_at=excluded.last_seen_at
  `).run(uuid(), req.userId, token, platform, nowCst());
  res.json({ ok: true });
});

router.delete('/push-token', auth, (req, res) => {
  const token = String(req.body.token || '').trim();
  if (token) db.prepare('DELETE FROM device_push_tokens WHERE token = ? AND user_id = ?').run(token, req.userId);
  res.json({ ok: true });
});

module.exports = router;
