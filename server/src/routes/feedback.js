const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { isOwnedMediaUrl } = require('../lib/media-ownership');

const router = Router();
router.use(auth);

router.get('/', (req, res) => {
  const feedback = db.prepare(`SELECT id,content,image_url AS imageUrl,status,reviewed_at AS reviewedAt,
    reply_content AS replyContent,replied_at AS repliedAt,created_at AS createdAt
    FROM user_feedback WHERE user_id=? ORDER BY created_at DESC`).all(req.userId);
  const submittedToday = !!db.prepare("SELECT 1 FROM user_feedback WHERE user_id=? AND date(created_at)=date('now','+8 hours') LIMIT 1").get(req.userId);
  res.json({ feedback, canSubmitToday: !submittedToday });
});

router.post('/', (req, res) => {
  const content = String(req.body?.content || '').trim();
  const imageUrl = String(req.body?.image_url || '').trim();
  const deviceModel = String(req.body?.device_model || '').trim().slice(0, 120);
  const osVersion = String(req.body?.os_version || '').trim().slice(0, 80);
  const appVersion = String(req.body?.app_version || '').trim().slice(0, 80);
  if (!content) return res.status(400).json({ error: '反馈内容不能为空' });
  if (content.length > 2000) return res.status(400).json({ error: '反馈内容不能超过 2000 字' });
  if (imageUrl && !isOwnedMediaUrl(imageUrl, req.userId, req)) {
    return res.status(400).json({ error: '反馈图片尚未上传，请重新选择' });
  }
  const submittedToday = db.prepare("SELECT 1 FROM user_feedback WHERE user_id=? AND date(created_at)=date('now','+8 hours') LIMIT 1").get(req.userId);
  if (submittedToday) return res.status(429).json({ error: '每天只能提交一次反馈，请明天再来' });
  const id = uuid();
  db.prepare(`INSERT INTO user_feedback (id,user_id,content,image_url,device_model,os_version,app_version,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now','+8 hours'),datetime('now','+8 hours'))`)
    .run(id, req.userId, content, imageUrl || null, deviceModel, osVersion, appVersion, 'new');
  res.status(201).json({ ok: true, id });
});

module.exports = router;
