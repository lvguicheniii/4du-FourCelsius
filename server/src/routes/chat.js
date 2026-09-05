const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { replaceSensitiveWords } = require('../lib/content-filter');
const { sendPushToUser } = require('../lib/push');
const { assertCanReport } = require('../lib/entropy');
const { preferenceMap, restoreShortcut, updatePreference } = require('../lib/conversation-preferences');
const { triggerAchievement } = require('../lib/achievements');
const { idempotent } = require('../middleware/idempotency');
const { rateLimit } = require('../middleware/rate-limit');
const { isFeatureEnabled } = require('../lib/feature-flags');
const { enqueueModeration } = require('../lib/moderation');
const { isApprovedMediaUrl, isOwnedMediaUrl, sameMediaUrl } = require('../lib/media-ownership');

const router = Router();
const MESSAGE_KINDS = new Set(['text', 'image', 'sticker', 'video', 'live_photo', 'post_context', 'comment_context']);
const MESSAGE_LENGTH_LIMITS = {
  text: 4000,
  image: 2048,
  sticker: 2048,
  video: 2048,
  live_photo: 4096,
  post_context: 1024,
  comment_context: 1024,
};

function safeJsonForModeration(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function moderationConversationSnapshot(userId, peerId) {
  const rows = db.prepare(`
    SELECT m.id,m.from_user_id,m.to_user_id,m.kind,m.content,m.created_at,
      u.nickname,u.username,u.avatar
    FROM messages m
    JOIN users u ON u.id=m.from_user_id
    WHERE ((m.from_user_id=? AND m.to_user_id=?) OR (m.from_user_id=? AND m.to_user_id=?))
    ORDER BY m.created_at DESC,m.rowid DESC
    LIMIT 30
  `).all(userId, peerId, peerId, userId);
  return rows.reverse().map((row) => ({
    id: row.id,
    from_user_id: row.from_user_id,
    to_user_id: row.to_user_id,
    kind: row.kind,
    content: row.content,
    created_at: row.created_at,
    nickname: row.nickname,
    username: row.username,
    avatar: row.avatar,
  }));
}

const directMessageWriteLimit = rateLimit({ scope: 'chat.send', limit: 60, windowMs: 30 * 1000 });

router.post('/send', auth, idempotent('chat.send'), directMessageWriteLimit, (req, res) => {
  const { toUserId, toUsername, content, kind = 'text', mediaId } = req.body;
  if (!MESSAGE_KINDS.has(kind) || typeof content !== 'string') {
    return res.status(400).json({ error: '消息格式无效' });
  }
  if (Array.from(content).length > MESSAGE_LENGTH_LIMITS[kind]) {
    return res.status(400).json({ error: '消息内容过长' });
  }
  if (toUserId != null && (typeof toUserId !== 'string' || toUserId.length > 100)) {
    return res.status(400).json({ error: '接收用户无效' });
  }
  if (toUsername != null && (typeof toUsername !== 'string' || toUsername.length > 100)) {
    return res.status(400).json({ error: '接收用户无效' });
  }
  if (mediaId != null && (typeof mediaId !== 'string' || mediaId.length > 100)) {
    return res.status(400).json({ error: '媒体记录无效' });
  }
  if (!content) return res.status(400).json({ error: '消息内容不能为空' });
  if (kind === 'video' && !isFeatureEnabled('video_upload', req.userId)) {
    return res.status(403).json({ error: '普通视频功能暂未开放' });
  }

  let targetId = toUserId;
  if (!targetId && toUsername) {
    const u = db.prepare('SELECT id FROM users WHERE username = ? OR nickname = ?').get(toUsername, toUsername);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    targetId = u.id;
  }
  if (!targetId) return res.status(400).json({ error: '请指定接收者' });
  if (targetId === req.userId) return res.status(400).json({ error: '不能给自己发消息' });
  const blocked = db.prepare(`
    SELECT 1 FROM blocks
    WHERE (user_id=? AND blocked_user_id=?)
       OR (user_id=? AND blocked_user_id=?)
  `).get(req.userId, targetId, targetId, req.userId);
  if (blocked) return res.status(403).json({ error: '当前无法向该用户发送私信' });
  if (kind === 'sticker' && !isApprovedMediaUrl(content, req)) {
    return res.status(400).json({ error: '表情包地址无效' });
  }
  if (kind === 'image' || kind === 'video' || kind === 'live_photo') {
    const liveMedia = kind === 'live_photo' ? safeJsonForModeration(content) : null;
    const mediaValues = kind === 'live_photo'
      ? [liveMedia?.stillUrl || liveMedia?.imageUrl || '', liveMedia?.motionUrl || '']
      : [String(content)];
    if (mediaValues.some(value => !isOwnedMediaUrl(value, req.userId, req))) {
      return res.status(400).json({ error: '图片尚未上传，请重新选择后发送' });
    }
    const followsTarget = !!db.prepare(
      'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
    ).get(req.userId, targetId);
    const targetFollowsBack = !!db.prepare(
      'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
    ).get(targetId, req.userId);
    if (!followsTarget || !targetFollowsBack) {
      return res.status(403).json({ error: '需要互相关注后才能发送图片' });
    }
  }
  if (mediaId) {
    const media = db.prepare("SELECT id,media_type,playback_url,motion_url FROM media_assets WHERE id=? AND owner_id=? AND context_type='message' AND status='ready'").get(String(mediaId), req.userId);
    if (!media) return res.status(400).json({ error: 'Media record is invalid' });
    const submittedUrl = kind === 'live_photo' ? safeJsonForModeration(content)?.motionUrl : content;
    if ((kind === 'video' || kind === 'live_photo') && !sameMediaUrl(submittedUrl, media.motion_url || media.playback_url)) {
      return res.status(400).json({ error: 'Media record does not match the uploaded file' });
    }
  }

  let safeContent = kind === 'text' ? replaceSensitiveWords(content) : content;
  if (kind === 'post_context' || kind === 'comment_context') {
    const existingConversation = db.prepare(`
      SELECT 1 FROM messages
      WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)
      LIMIT 1
    `).get(req.userId, targetId, targetId, req.userId);
    if (existingConversation) {
      return res.json({ skipped: true, reason: 'existing_conversation' });
    }
    if (kind === 'post_context') {
      let requestedPostId = '';
      try { requestedPostId = String(JSON.parse(content)?.postId || ''); } catch {}
      const sourcePost = db.prepare(`
        SELECT p.id,p.user_id,p.content,p.images,u.nickname,u.username
        FROM posts p JOIN users u ON u.id=p.user_id
        WHERE p.id=? AND p.status='active'
      `).get(requestedPostId);
      if (!sourcePost) return res.status(404).json({ error: '来源切片不存在或已删除' });
      if (sourcePost.user_id !== targetId) return res.status(400).json({ error: '来源切片与私信用户不匹配' });
      let images = [];
      try { images = JSON.parse(sourcePost.images || '[]'); } catch {}
      safeContent = JSON.stringify({
        postId: sourcePost.id,
        author: sourcePost.nickname || sourcePost.username,
        content: String(sourcePost.content || '').slice(0, 160),
        image: images[0] || '',
      });
    } else {
      let requestedCommentId = '';
      try { requestedCommentId = String(JSON.parse(content)?.commentId || ''); } catch {}
      const sourceComment = db.prepare(`
        SELECT c.id,c.post_id,c.user_id,c.content,u.nickname,u.username
        FROM comments c
        JOIN users u ON u.id=c.user_id
        JOIN posts p ON p.id=c.post_id
        WHERE c.id=? AND c.status='active' AND p.status='active'
      `).get(requestedCommentId);
      if (!sourceComment) return res.status(404).json({ error: '来源评论不存在或已删除' });
      if (sourceComment.user_id !== targetId) return res.status(400).json({ error: '来源评论与私信用户不匹配' });
      safeContent = JSON.stringify({
        commentId: sourceComment.id,
        postId: sourceComment.post_id,
        author: sourceComment.nickname || sourceComment.username,
        content: String(sourceComment.content || '').slice(0, 300),
      });
    }
  }
  const id = 'msg_' + uuid();
  const now = db.prepare("SELECT datetime('now','+8 hours') as t").get().t;
  db.prepare('INSERT INTO messages (id, from_user_id, to_user_id, kind, content, media_id, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.userId, targetId, kind, safeContent, mediaId || null, now);
  try {
    let moderationContent = kind === 'text' ? safeContent : '';
    let moderationMedia = [];
    if (kind === 'image' || kind === 'sticker' || kind === 'video') moderationMedia = [safeContent];
    if (kind === 'live_photo') {
      const live = safeJsonForModeration(safeContent);
      moderationMedia = [live?.stillUrl || live?.imageUrl].filter(Boolean);
    }
    enqueueModeration(db, {
      targetType: 'message',
      targetId: id,
      authorId: req.userId,
      relatedUserId: targetId,
      contentSnapshot: moderationContent,
      mediaSnapshot: moderationMedia,
      contextSnapshot: moderationConversationSnapshot(req.userId, targetId),
    });
  } catch (error) {
    console.error('Moderation task enqueue failed for message:', error.message);
  }

  const myName = req.user?.nickname || req.user?.username || '用户';
  const myAvatar = req.user?.avatar || null;

  // WebSocket 实时推送给双方
  const ws = req.app.get('ws');
  if (ws) {
    const pushMsg = {
      type: 'chat',
      id,
      from: req.userId,
      fromName: myName,
      fromAvatar: myAvatar,
      kind,
      content: safeContent,
      time: now,
      peerName: toUsername || '',
    };
    ws.send(targetId, { ...pushMsg, peerId: req.userId, from: req.userId });
    ws.send(req.userId, { ...pushMsg, peerId: targetId, from: 'me' });
  }

  const pushPreview = kind === 'image' ? '[图片]'
    : kind === 'sticker' ? '[表情包]'
      : kind === 'post_context' ? `[从切片开始对话]`
        : kind === 'comment_context' ? `[从评论开始对话]`
        : String(safeContent).slice(0, 100);
  sendPushToUser(targetId, {
    title: myName,
    body: pushPreview,
    data: { type: 'chat', chatName: myName, fromUserId: req.userId },
  });
  if (kind !== 'system') {
    triggerAchievement(db, req.userId, 'lay_cable', { ws });
  }

  res.json({ id, time: now, content: safeContent });
});

router.post('/report', auth, (req, res) => {
  const reportAccess = assertCanReport(db, req.userId);
  if (!reportAccess.ok) return res.status(reportAccess.status).json(reportAccess);
  const { messageId, peerUserId, peerUsername, reason = 'other', detail = '' } = req.body;
  let message;
  if (messageId) {
    message = db.prepare('SELECT * FROM messages WHERE id=? AND to_user_id=?').get(messageId, req.userId);
  } else if (peerUserId || peerUsername) {
    const peer = peerUserId
      ? db.prepare('SELECT id FROM users WHERE id=?').get(String(peerUserId))
      : db.prepare('SELECT id FROM users WHERE username=? OR nickname=?').get(peerUsername, peerUsername);
    if (peer) {
      message = db.prepare(`
        SELECT * FROM messages
        WHERE from_user_id=? AND to_user_id=?
        ORDER BY created_at DESC LIMIT 1
      `).get(peer.id, req.userId);
    }
  }

  if (!message) return res.status(404).json({ error: '没有可举报的对方私信' });
  const duplicate = db.prepare(`
    SELECT id FROM message_reports
    WHERE message_id=? AND reporter_id=?
  `).get(message.id, req.userId);
  if (duplicate) return res.status(409).json({ error: '这条私信已经举报过了' });
  const context = db.prepare(`
    SELECT m.id,m.from_user_id,m.to_user_id,m.kind,m.content,m.created_at,
           u.nickname,u.username
    FROM messages m JOIN users u ON u.id=m.from_user_id
    WHERE (m.from_user_id=? AND m.to_user_id=?) OR (m.from_user_id=? AND m.to_user_id=?)
    ORDER BY m.created_at DESC LIMIT 20
  `).all(message.from_user_id, message.to_user_id, message.to_user_id, message.from_user_id).reverse();
  const id = uuid();
  db.prepare(`
    INSERT INTO message_reports (id,message_id,reporter_id,reason,detail,context_json)
    VALUES (?,?,?,?,?,?)
  `).run(id, message.id, req.userId, reason, detail, JSON.stringify(context));
  res.status(201).json({ ok: true, id });
});

router.delete('/messages/:messageId/self', auth, (req, res) => {
  const message = db.prepare(`
    SELECT id FROM messages
    WHERE id=? AND (from_user_id=? OR to_user_id=?)
  `).get(req.params.messageId, req.userId, req.userId);
  if (!message) return res.status(404).json({ error: '消息不存在' });
  db.prepare('INSERT OR IGNORE INTO message_user_hides(message_id,user_id) VALUES (?,?)')
    .run(message.id, req.userId);
  res.json({ ok: true, messageId: message.id });
});

router.post('/messages/:messageId/recall', auth, (req, res) => {
  const message = db.prepare(`
    SELECT *, (julianday('now','+8 hours') - julianday(created_at)) * 86400 AS age_seconds
    FROM messages WHERE id=? AND from_user_id=?
  `).get(req.params.messageId, req.userId);
  if (!message) return res.status(404).json({ error: '消息不存在或无权撤回' });
  if (message.recalled_at) return res.json({ ok: true, messageId: message.id, content: '消息已撤回' });
  if (Number(message.age_seconds) > 120) return res.status(409).json({ error: '消息已发出超过两分钟' });
  const now = db.prepare("SELECT datetime('now','+8 hours') AS t").get().t;
  db.prepare("UPDATE messages SET kind='system',content='消息已撤回',media_id=NULL,recalled_at=? WHERE id=?")
    .run(now, message.id);
  const sender = db.prepare('SELECT nickname,username FROM users WHERE id=?').get(message.from_user_id);
  const event = { type: 'chat_message_recalled', messageId: message.id, content: '消息已撤回', senderName: sender?.nickname || sender?.username || '用户', time: now };
  req.app.get('ws')?.send(message.from_user_id, event);
  req.app.get('ws')?.send(message.to_user_id, event);
  res.json({ ok: true, messageId: message.id, content: '消息已撤回', time: now });
});

router.get('/with-name/:username', auth, (req, res) => {
  const requestedPeerId = String(req.query.userId || '').trim();
  if (requestedPeerId.length > 100) return res.status(400).json({ error: '私信用户无效' });
  const peer = requestedPeerId
    ? db.prepare('SELECT id FROM users WHERE id = ?').get(requestedPeerId)
    : db.prepare('SELECT id FROM users WHERE username = ? OR nickname = ?').get(req.params.username, req.params.username);
  if (!peer) return res.json([]);
  restoreShortcut(db, req.userId, 'chat', peer.id);
  const limit = Math.min(100, Math.max(10, parseInt(req.query.limit, 10) || 50));
  const beforeId = String(req.query.before || '').trim();

  // 标记对方发给我的消息为已读
  db.prepare('UPDATE messages SET is_read = 1 WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0')
    .run(peer.id, req.userId);

  let before = null;
  if (beforeId) {
    before = db.prepare(`
      SELECT id, created_at FROM messages
      WHERE id = ? AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
    `).get(beforeId, req.userId, peer.id, peer.id, req.userId);
  }
  const beforeSql = before ? 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))' : '';
  const params = [req.userId, peer.id, peer.id, req.userId];
  if (before) params.push(before.created_at, before.created_at, before.id);
  params.push(limit);
  const msgs = db.prepare(`
    SELECT m.*, u.nickname, u.avatar
    FROM messages m
    LEFT JOIN users u ON u.id = m.from_user_id
    WHERE ((m.from_user_id = ? AND m.to_user_id = ?)
       OR (m.from_user_id = ? AND m.to_user_id = ?))
    AND NOT EXISTS (SELECT 1 FROM message_user_hides h WHERE h.message_id=m.id AND h.user_id=?)
    ${beforeSql}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?
  `).all(...params.slice(0, 4), req.userId, ...params.slice(4)).reverse();

  res.json(msgs.map(m => ({
    id: m.id,
    from: m.from_user_id === req.userId ? 'me' : (m.nickname || req.params.username),
    kind: m.kind || 'text',
    content: m.content,
    time: m.created_at,
    fromAvatar: m.from_user_id !== req.userId ? m.avatar : null,
  })));
});

router.get('/conversations', auth, (req, res) => {
  const favoritesOnly = req.query.favorites === '1' || req.query.favorites === 'true';
  // 聚合每个对话的最新消息 + 未读数
  const convs = db.prepare(`
    SELECT
      peer_id, nickname, username, avatar, gender, age,
      kind, content, created_at,
      (SELECT COUNT(*) FROM messages
       WHERE from_user_id = peer_id AND to_user_id = ? AND is_read = 0
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides unread_hide
           WHERE unread_hide.message_id = messages.id AND unread_hide.user_id = ?
         )
      ) as unread
    FROM (
      SELECT
        CASE WHEN m.from_user_id = ? THEN m.to_user_id ELSE m.from_user_id END as peer_id,
        u.nickname, u.username, u.avatar, u.gender, u.age,
        m.kind, m.content, m.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN m.from_user_id = ? THEN m.to_user_id ELSE m.from_user_id END
          ORDER BY m.created_at DESC
        ) as rn
      FROM messages m
      JOIN users u ON u.id = CASE WHEN m.from_user_id = ? THEN m.to_user_id ELSE m.from_user_id END
      WHERE (m.from_user_id = ? OR m.to_user_id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM message_user_hides h
          WHERE h.message_id = m.id AND h.user_id = ?
        )
    ) sub
    WHERE sub.rn = 1
    ORDER BY sub.created_at DESC
  `).all(
    req.userId, req.userId,
    req.userId, req.userId, req.userId,
    req.userId, req.userId, req.userId,
  );

  const preferences = preferenceMap(db, req.userId, 'chat');
  const result = convs.map(c => {
    const preference = preferences.get(c.peer_id) || { hidden: false, important: false, importantAt: null };
    return {
    id: 'conv-' + c.peer_id,
    userId: c.peer_id,
    name: c.nickname || c.username,
    avatarColor: '#33A9DC',
    avatar: c.avatar,
    gender: c.gender || null,
    age: c.age,
    lastMessage: c.kind === 'text' || c.kind === 'system' ? c.content : c.kind === 'image' ? '[图片]' : c.kind === 'video' ? '[视频]' : c.kind === 'live_photo' ? '[动态照片]' : c.kind === 'post_context' ? '[从切片开始对话]' : c.kind === 'comment_context' ? '[从评论开始对话]' : '[贴纸]',
    time: c.created_at,
    unread: c.unread || 0,
    ...preference,
    };
  }).filter(item => favoritesOnly ? item.important : !item.hidden);
  result.sort((a, b) => {
    if (a.important !== b.important) return a.important ? -1 : 1;
    const aTime = a.important && a.importantAt && a.importantAt > a.time ? a.importantAt : a.time;
    const bTime = b.important && b.importantAt && b.importantAt > b.time ? b.importantAt : b.time;
    return String(bTime || '').localeCompare(String(aTime || ''));
  });
  res.json(result);
});

router.get('/conversations/:peerId/preference', auth, (req, res) => {
  const peer = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.peerId);
  if (!peer || peer.id === req.userId) return res.status(404).json({ error: '私信用户不存在' });
  const preference = preferenceMap(db, req.userId, 'chat').get(peer.id) || {
    hidden: false,
    important: false,
    importantAt: null,
  };
  res.json(preference);
});

router.put('/conversations/:peerId/preference', auth, (req, res) => {
  const peer = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.peerId);
  if (!peer || peer.id === req.userId) return res.status(404).json({ error: '私信用户不存在' });
  const values = {};
  if (typeof req.body.hidden === 'boolean') values.hidden = req.body.hidden;
  if (typeof req.body.important === 'boolean') values.important = req.body.important;
  if (!Object.keys(values).length) return res.status(400).json({ error: '没有可更新的设置' });
  if (values.important === true) values.hidden = false;
  res.json(updatePreference(db, req.userId, 'chat', peer.id, values));
});

module.exports = router;
