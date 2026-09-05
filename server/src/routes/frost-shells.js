const { Router } = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotency');
const { sendPushToUser } = require('../lib/push');
const { triggerAchievement } = require('../lib/achievements');
const { transferFrostShellGift, getFrostShellState } = require('../lib/frost-shell');

const router = Router();

router.get('/', auth, (req, res) => {
  const state = getFrostShellState(db, req.userId);
  res.json({
    fragileCount: state.fragileCount,
    eternalCount: state.eternalCount,
    onlineSeconds: state.onlineSeconds,
    claimedDate: state.claimedDate,
    progressDate: state.progressDate,
    granted: false,
  });
});

function handleGift(req, res) {
  const recipientId = String(req.body.recipientId || '').trim();
  const source = ['chat', 'comment', 'profile'].includes(req.body.source) ? req.body.source : 'profile';
  const relatedId = String(req.body.relatedId || '').trim();
  if (!recipientId) return res.status(400).json({ error: '请选择接收用户' });
  if (recipientId === req.userId) return res.status(400).json({ error: '不能赠予自己' });

  const sender = db.prepare('SELECT id, nickname, username FROM users WHERE id = ?').get(req.userId);
  const recipient = db.prepare("SELECT id, nickname, username, eternal_frost_shell_count FROM users WHERE id = ? AND status != 'deleted'").get(recipientId);
  if (!recipient) return res.status(404).json({ error: '接收用户不存在' });

  const blocked = db.prepare(`
    SELECT 1 FROM blocks
    WHERE (user_id=? AND blocked_user_id=?)
       OR (user_id=? AND blocked_user_id=?)
  `).get(req.userId, recipientId, recipientId, req.userId);
  if (blocked) return res.status(403).json({ error: '当前无法向该用户赠予浮霜贝' });

  const transfer = transferFrostShellGift(db, {
    senderId: req.userId,
    recipientId,
    source,
    relatedId,
    senderName: sender?.nickname || sender?.username || '用户',
    recipientName: recipient?.nickname || recipient?.username || '用户',
  });

  const senderName = transfer.senderName || sender?.nickname || sender?.username || '用户';
  const recipientName = transfer.recipientName || recipient?.nickname || recipient?.username || '用户';
  const shellText = `${senderName} 向 ${recipientName}\n赠予了 1 枚脆弱浮霜贝`;
  const notificationTitle = '浮霜贝赠礼';
  const notificationContent = `${senderName} 赠予了你 1 枚永恒浮霜贝`;
  const achievementOptions = { ws: req.app.get('ws') };

  if (transfer.messageId) {
    db.prepare(`
      INSERT INTO messages (id, from_user_id, to_user_id, kind, content, created_at)
      VALUES (?, ?, ?, 'system', ?, ?)
    `).run(transfer.messageId, req.userId, recipientId, shellText, transfer.time);
  }

  db.prepare(`
    INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at)
    VALUES (?, ?, 'interaction', 'frost_shell', ?, ?, ?, ?)
  `).run(require('uuid').v4(), recipientId, notificationTitle, notificationContent, transfer.notificationRelatedId, transfer.time);

  const ws = req.app.get('ws');
  if (ws) {
    ws.send(recipientId, {
      type: 'notification',
      category: 'interaction',
      notificationType: 'frost_shell',
      title: notificationTitle,
      content: notificationContent,
      relatedId: transfer.notificationRelatedId,
    });
    if (transfer.messageId) {
      const chatEvent = {
        type: 'chat',
        id: transfer.messageId,
        from: req.userId,
        fromName: senderName,
        peerName: recipientName,
        kind: 'system',
        content: shellText,
        time: transfer.time,
      };
      ws.send(recipientId, { ...chatEvent, peerId: req.userId });
      ws.send(req.userId, { ...chatEvent, peerId: recipientId, from: 'me' });
    }
  }
  sendPushToUser(recipientId, {
    title: notificationTitle,
    body: notificationContent,
    data: { type: 'frost_shell', postId: transfer.notificationRelatedId },
  });

  triggerAchievement(db, req.userId, 'hand_fragrance', achievementOptions);
  const state = getFrostShellState(db, req.userId);
  res.json({
    ok: true,
    remainingFragile: state.fragileCount,
    recipientEternalCount: transfer.commentFrostShellCount == null
      ? (Number(recipient.eternal_frost_shell_count) || 0) + 1
      : transfer.commentFrostShellCount,
    commentFrostShellCount: transfer.commentFrostShellCount,
    message: transfer.messageId ? { id: transfer.messageId, from: 'me', kind: 'system', content: shellText, time: transfer.time } : null,
  });
}

router.post('/gift', auth, idempotent('frost-shell.gift'), handleGift);

module.exports = router;
module.exports.handleGift = handleGift;
