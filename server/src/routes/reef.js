const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth, optionalAuth, requireNotMuted } = require('../middleware/auth');
const { replaceSensitiveWords } = require('../lib/content-filter');
const { nowCst } = require('../lib/time');
const { recordRetentionVote, retentionStatus } = require('../lib/reef-lifecycle');
const { preferenceMap, updatePreference } = require('../lib/conversation-preferences');
const { assertCanReport } = require('../lib/entropy');
const { idempotent } = require('../middleware/idempotency');
const { rateLimit } = require('../middleware/rate-limit');
const { isFeatureEnabled } = require('../lib/feature-flags');
const { isApprovedMediaUrl, isOwnedMediaUrl, sameMediaUrl } = require('../lib/media-ownership');
const { sendPushToUser } = require('../lib/push');

const router = Router();
const ROOM_COLORS = ['#33A9DC', '#6C7EE1', '#36A78C', '#E18472', '#B277D1', '#D49A45', '#4B91C9', '#718A5A'];
const publicReefApplicationLimit = rateLimit({ scope: 'reef.public-application', limit: 3, windowMs: 24 * 60 * 60 * 1000 });

function roomDto(room, ws, viewerId, lastReadMessageId = null) {
  const blockFilter = viewerId ? `
    AND NOT EXISTS (
      SELECT 1 FROM blocks b
      WHERE (b.user_id=? AND b.blocked_user_id=m.user_id)
         OR (b.user_id=m.user_id AND b.blocked_user_id=?)
    )
  ` : '';
  const latest = db.prepare(`
    SELECT m.id,m.user_id,m.content,m.kind,m.created_at,u.nickname,u.username
    FROM reef_messages m JOIN users u ON u.id=m.user_id
    WHERE m.room_id=? ${blockFilter} ORDER BY m.created_at DESC,m.id DESC LIMIT 1
  `).get(...(viewerId ? [room.id, viewerId, viewerId] : [room.id]));
  const members = ws?.getRoomPresence?.(room.id) || [];
  return {
    id: room.id,
    zone: room.zone,
    number: room.official_number,
    name: room.name,
    color: room.color,
    capacity: room.capacity,
    durationHours: room.duration_hours,
    expiresAt: room.expires_at,
    createdAt: room.created_at,
    ownerId: room.owner_id,
    status: room.status,
    currentCount: members.length,
    members,
    latestMessage: latest ? {
      id: latest.id,
      sender: latest.nickname || latest.username,
      content: latest.kind === 'text' ? latest.content : latest.kind === 'image' ? '[图片]' : latest.kind === 'video' ? '[视频]' : latest.kind === 'live_photo' ? '[动态照片]' : '[表情包]',
      time: latest.created_at,
    } : null,
    unread: latest && viewerId && latest.user_id !== viewerId && latest.id !== lastReadMessageId ? 1 : 0,
  };
}

router.get('/rooms', optionalAuth, (req, res) => {
  const participatingOnly = req.query.participating === '1' || req.query.participating === 'true';
  const mineOnly = req.query.mine === '1' || req.query.mine === 'true';
  const messagesOnly = req.query.messages === '1' || req.query.messages === 'true';
  const favoritesOnly = req.query.favorites === '1' || req.query.favorites === 'true';
  const involvementOnly = participatingOnly || mineOnly || messagesOnly || favoritesOnly;
  const participationFilter = involvementOnly
    ? 'AND (reef_rooms.owner_id=? OR EXISTS (SELECT 1 FROM reef_messages rm WHERE rm.room_id=reef_rooms.id AND rm.user_id=?))'
    : '';
  const filterParams = involvementOnly ? [req.userId, req.userId] : [];
  const rooms = db.prepare(`
    SELECT * FROM reef_rooms WHERE status='active' ${participationFilter}
    ORDER BY CASE zone WHEN 'public' THEN 0 ELSE 1 END,
             official_number IS NULL, official_number, created_at DESC
  `).all(...filterParams);
  const ws = req.app.get('ws');
  const preferences = req.userId ? preferenceMap(db, req.userId, 'reef') : new Map();
  const result = rooms.map(room => {
    const preference = preferences.get(room.id) || {
      hidden: false, important: false, importantAt: null, lastReadAt: null, lastReadMessageId: null,
    };
    return {
      ...roomDto(room, ws, req.userId, preference.lastReadMessageId),
      ...preference,
    };
  }).filter(room => favoritesOnly ? room.important : messagesOnly ? !room.hidden : true);
  result.sort((a, b) => {
    if (a.important !== b.important) return a.important ? -1 : 1;
    const aLatest = a.latestMessage?.time || a.createdAt || '';
    const bLatest = b.latestMessage?.time || b.createdAt || '';
    const aTime = a.important && a.importantAt && a.importantAt > aLatest ? a.importantAt : aLatest;
    const bTime = b.important && b.importantAt && b.importantAt > bLatest ? b.importantAt : bLatest;
    return String(bTime).localeCompare(String(aTime));
  });
  res.json({ rooms: result });
});

router.get('/rooms/:id/card', optionalAuth, (req, res) => {
  const room = db.prepare('SELECT * FROM reef_rooms WHERE id=?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '礁石不存在' });
  res.json({ room: roomDto(room, req.app.get('ws'), req.userId) });
});

router.put('/rooms/:id/preference', auth, (req, res) => {
  const room = db.prepare('SELECT id FROM reef_rooms WHERE id=?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '礁石不存在' });
  const values = {};
  if (typeof req.body.hidden === 'boolean') values.hidden = req.body.hidden;
  if (typeof req.body.important === 'boolean') values.important = req.body.important;
  if (!Object.keys(values).length) return res.status(400).json({ error: '没有可更新的设置' });
  if (values.important === true) values.hidden = false;
  res.json(updatePreference(db, req.userId, 'reef', room.id, values));
});

router.get('/rooms/:id/overview', auth, (req, res) => {
  const room = db.prepare("SELECT * FROM reef_rooms WHERE id=?").get(req.params.id);
  if (!room) return res.status(404).json({ error: '礁石不存在' });
  if (room.status === 'destroyed') return res.status(410).json({ error: '该礁石已被摧毁' });
  const member = true;
  if (!member && room.owner_id !== req.userId) return res.status(403).json({ error: '你还没有参与这座礁石' });
  const speakers = db.prepare(`
    SELECT u.id,u.nickname,u.username,u.avatar,u.gender,
           COUNT(m.id) AS message_count, MAX(m.created_at) AS last_spoke_at
    FROM reef_messages m JOIN users u ON u.id=m.user_id
    WHERE m.room_id=?
    GROUP BY u.id
    ORDER BY last_spoke_at DESC
  `).all(room.id);
  const members = req.app.get('ws')?.getRoomPresence?.(room.id) || [];
  res.json({
    id: room.id,
    name: room.name,
    zone: room.zone,
    capacity: room.capacity,
    expiresAt: room.expires_at,
    status: room.status,
    currentCount: members.length,
    speakers: speakers.map(item => ({
      id: item.id,
      nickname: item.nickname || item.username,
      username: item.username,
      avatar: item.avatar,
      gender: item.gender,
      messageCount: item.message_count,
      lastSpokeAt: item.last_spoke_at,
    })),
  });
});

router.post('/rooms/:id/report', auth, (req, res) => {
  const reportAccess = assertCanReport(db, req.userId);
  if (!reportAccess.ok) return res.status(reportAccess.status).json(reportAccess);
  const room = db.prepare('SELECT * FROM reef_rooms WHERE id=?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '礁石不存在' });
  const duplicate = db.prepare("SELECT id FROM reef_reports WHERE room_id=? AND reporter_id=? AND status='pending'")
    .get(room.id, req.userId);
  if (duplicate) return res.status(409).json({ error: '你已经举报过这座礁石，正在等待审核' });
  const context = db.prepare(`
    SELECT m.id,m.room_id,m.user_id,m.kind,m.content,m.created_at,u.nickname,u.username,u.avatar
    FROM reef_messages m JOIN users u ON u.id=m.user_id
    WHERE m.room_id=? ORDER BY m.created_at ASC,m.id ASC
  `).all(room.id);
  const id = `reef_room_report_${uuid()}`;
  db.prepare(`
    INSERT INTO reef_reports(id,room_id,reporter_id,reason,detail,context_json)
    VALUES (?,?,?,?,?,?)
  `).run(id, room.id, req.userId, String(req.body.reason || 'other').slice(0, 30), String(req.body.detail || '').trim().slice(0, 500), JSON.stringify(context));
  res.status(201).json({ ok: true, id });
});

router.post('/rooms', auth, idempotent('reef.create'), (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 18);
  const capacity = Math.min(44, Math.max(2, Math.round(Number(req.body.capacity) || 30)));
  const durationHours = Math.min(44, Math.max(1, Math.round(Number(req.body.durationHours) || 24)));
  if (name.length < 2) return res.status(400).json({ error: '礁石名称至少需要两个字' });
  const owned = db.prepare("SELECT id FROM reef_rooms WHERE owner_id=? AND status='active'").get(req.userId);
  if (owned) return res.status(409).json({ error: '每位用户暂时只能创建一座私人礁石' });
  const id = `reef_${uuid()}`;
  const color = ROOM_COLORS[Math.floor(Math.random() * ROOM_COLORS.length)];
  const now = nowCst();
  const expiresAt = db.prepare("SELECT datetime(?,'+' || ? || ' hours') AS value").get(now, durationHours).value;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO reef_rooms(id,zone,name,color,capacity,duration_hours,expires_at,owner_id,created_at)
      VALUES (?,'private',?,?,?,?,?,?,?)
    `).run(id, name, color, capacity, durationHours, expiresAt, req.userId, now);
    db.prepare(`
      INSERT INTO reef_members(room_id,user_id,first_joined_at,last_joined_at)
      VALUES (?,?,?,?)
    `).run(id, req.userId, now, now);
  })();
  req.app.get('ws')?.broadcast({ type: 'reef_room_updated', roomId: id, action: 'created' });
  res.status(201).json(roomDto(db.prepare('SELECT * FROM reef_rooms WHERE id=?').get(id), req.app.get('ws'), req.userId));
});

router.post('/public-applications', auth, idempotent('reef.public-application'), publicReefApplicationLimit, (req, res) => {
  const reefName = String(req.body.reefName || '').trim();
  const reason = String(req.body.reason || '').trim();
  if (reefName.length < 2 || reefName.length > 18) return res.status(400).json({ error: '公海礁石名称需要 2 至 18 个字符' });
  if (!reason) return res.status(400).json({ error: '请填写申请理由' });
  if (reason.length > 200) return res.status(400).json({ error: '申请理由不能超过 200 字' });
  const duplicate = db.prepare(`
    SELECT id FROM public_reef_applications
    WHERE user_id=? AND status='pending' AND lower(reef_name)=lower(?)
  `).get(req.userId, reefName);
  if (duplicate) return res.status(409).json({ error: '你已经提交过同名申请，请等待处理' });
  const id = `public_reef_application_${uuid()}`;
  db.prepare(`
    INSERT INTO public_reef_applications(id,user_id,reef_name,reason,created_at)
    VALUES (?,?,?,?,?)
  `).run(id, req.userId, reefName, reason, nowCst());
  res.status(201).json({ ok: true, id });
});

router.get('/rooms/:id/retention', auth, (req, res) => {
  try {
    res.json(retentionStatus(db, req.params.id, req.userId));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/rooms/:id/retention-vote', auth, (req, res) => {
  try {
    const result = recordRetentionVote(db, req.params.id, req.userId, String(req.body.vote || ''));
    if (result.extended) {
      req.app.get('ws')?.broadcast({ type: 'reef_room_updated', roomId: req.params.id, action: 'extended' });
    }
    res.json(result);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.get('/rooms/:id/messages', auth, (req, res) => {
  const room = db.prepare("SELECT id FROM reef_rooms WHERE id=? AND status='active'").get(req.params.id);
  if (!room) return res.status(404).json({ error: '礁石不存在' });
  const limit = Math.min(100, Math.max(20, Number(req.query.limit) || 50));
  const messageSql = `
    SELECT m.id,m.room_id,m.user_id,m.content,m.kind,m.created_at,
           u.nickname,u.username,u.avatar,u.gender
    FROM reef_messages m JOIN users u ON u.id=m.user_id
    WHERE m.room_id=?
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=m.user_id)
           OR (b.user_id=m.user_id AND b.blocked_user_id=?)
      )
  `;
  let rows = db.prepare(`${messageSql} ORDER BY m.created_at DESC,m.id DESC LIMIT ?`)
    .all(req.params.id, req.userId, req.userId, limit).reverse();
  const anchorId = String(req.query.messageId || '').trim();
  if (anchorId && !rows.some(row => row.id === anchorId)) {
    const anchor = db.prepare('SELECT id,created_at FROM reef_messages WHERE id=? AND room_id=?').get(anchorId, room.id);
    if (anchor) {
      const before = db.prepare(`${messageSql}
        AND (m.created_at < ? OR (m.created_at = ? AND m.id <= ?))
        ORDER BY m.created_at DESC,m.id DESC LIMIT ?
      `).all(room.id, req.userId, req.userId, anchor.created_at, anchor.created_at, anchor.id, Math.ceil(limit / 2)).reverse();
      const after = db.prepare(`${messageSql}
        AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
        ORDER BY m.created_at ASC,m.id ASC LIMIT ?
      `).all(room.id, req.userId, req.userId, anchor.created_at, anchor.created_at, anchor.id, Math.floor(limit / 2));
      rows = [...before, ...after];
    }
  }
  updatePreference(db, req.userId, 'reef', room.id, {
    hidden: false,
    lastReadAt: nowCst(),
    lastReadMessageId: rows.at(-1)?.id || null,
  });
  res.json({ messages: rows.map(row => ({
    id: row.id, roomId: row.room_id, userId: row.user_id,
    nickname: row.nickname || row.username, avatar: row.avatar, gender: row.gender,
    content: row.content, kind: row.kind, time: row.created_at,
  })) });
});

const reefMessageWriteLimit = rateLimit({ scope: 'reef.send-message', limit: 45, windowMs: 15 * 1000 });

router.post('/rooms/:id/messages', auth, requireNotMuted, idempotent('reef.send-message'), reefMessageWriteLimit, (req, res) => {
  const room = db.prepare("SELECT * FROM reef_rooms WHERE id=? AND status='active'").get(req.params.id);
  if (!room) return res.status(404).json({ error: '礁石不存在' });
  const kind = ['text', 'image', 'sticker', 'video', 'live_photo'].includes(req.body.kind) ? req.body.kind : 'text';
  if (kind === 'video' && !isFeatureEnabled('video_upload', req.userId)) {
    return res.status(403).json({ error: '普通视频功能暂未开放' });
  }
  const mediaId = req.body.mediaId ? String(req.body.mediaId) : null;
  let content = String(req.body.content || '').trim();
  if (kind === 'text') content = replaceSensitiveWords(content).slice(0, 500);
  else if (kind === 'live_photo') {
    let liveMedia = null;
    try { liveMedia = JSON.parse(content); } catch {}
    if (!isOwnedMediaUrl(liveMedia?.stillUrl || liveMedia?.imageUrl, req.userId, req) || !isOwnedMediaUrl(liveMedia?.motionUrl, req.userId, req)) return res.status(400).json({ error: 'Media upload is incomplete' });
    content = content.slice(0, 4096);
  } else {
    if (kind === 'sticker' && !isApprovedMediaUrl(content, req)) return res.status(400).json({ error: '表情包地址无效' });
    if (kind !== 'sticker' && !isOwnedMediaUrl(content, req.userId, req)) return res.status(400).json({ error: '媒体文件尚未上传，请重新选择后发送' });
    content = content.slice(0, 2048);
  }
  if (!content) return res.status(400).json({ error: '消息不能为空' });
  const requestedMentionIds = kind === 'text' && Array.isArray(req.body.mentionUserIds)
    ? [...new Set(req.body.mentionUserIds.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 8)
    : [];
  const mentionTargets = requestedMentionIds.map(targetId => db.prepare(`
    SELECT u.id,u.nickname,u.username
    FROM users u
    WHERE u.id=? AND u.id!=? AND u.status!='deleted'
      AND EXISTS (SELECT 1 FROM reef_messages rm WHERE rm.room_id=? AND rm.user_id=u.id)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=u.id)
           OR (b.user_id=u.id AND b.blocked_user_id=?)
      )
  `).get(targetId, req.userId, room.id, req.userId, req.userId)).filter(Boolean)
    .filter(target => content.includes(`@${target.nickname || target.username}`));
  if (mediaId) {
    const media = db.prepare("SELECT id,media_type,playback_url,motion_url FROM media_assets WHERE id=? AND owner_id=? AND context_type='reef' AND status='ready'").get(mediaId, req.userId);
    if (!media) return res.status(400).json({ error: 'Media record is invalid' });
    const submittedUrl = kind === 'live_photo' ? (() => { try { return JSON.parse(content)?.motionUrl; } catch { return ''; } })() : content;
    if ((kind === 'video' || kind === 'live_photo') && !sameMediaUrl(submittedUrl, media.motion_url || media.playback_url)) return res.status(400).json({ error: 'Media record does not match the uploaded file' });
  }
  const id = `reef_msg_${uuid()}`;
  const now = db.prepare("SELECT datetime('now','+8 hours') AS time").get().time;
  const sender = db.prepare('SELECT nickname,username,avatar,gender FROM users WHERE id=?').get(req.userId) || {};
  const senderName = sender.nickname || sender.username || '用户';
  const mentionNotifications = mentionTargets.map(target => ({
    id: uuid(),
    userId: target.id,
    title: '礁石@通知',
    content: `${senderName}在【${room.name}】礁石里@了你，快去看看吧！`,
    metadata: { roomId: room.id, messageId: id, roomName: room.name, roomColor: room.color, actorId: req.userId, actorName: senderName },
  }));
  db.transaction(() => {
    db.prepare('INSERT INTO reef_messages(id,room_id,user_id,content,kind,media_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, room.id, req.userId, content, kind, mediaId, now);
    db.prepare(`
      INSERT INTO reef_members(room_id,user_id,first_joined_at,last_joined_at)
      VALUES (?,?,?,?)
      ON CONFLICT(room_id,user_id) DO UPDATE SET last_joined_at=excluded.last_joined_at
    `).run(room.id, req.userId, now, now);
    const insertNotification = db.prepare(`
      INSERT INTO notifications(id,user_id,category,type,title,content,related_id,metadata_json,created_at)
      VALUES (?,?,'interaction','reef_mention',?,?,?,?,?)
    `);
    mentionNotifications.forEach(notification => insertNotification.run(
      notification.id,
      notification.userId,
      notification.title,
      notification.content,
      room.id,
      JSON.stringify(notification.metadata),
      now,
    ));
  })();
  const message = {
    id, roomId: room.id, userId: req.userId,
    nickname: sender.nickname || sender.username || '用户',
    avatar: sender.avatar || null, gender: sender.gender || '',
    content, kind, time: now,
  };
  const ws = req.app.get('ws');
  res.status(201).json(message);
  setImmediate(() => {
    if (ws?.broadcastRoomMessage) ws.broadcastRoomMessage(room.id, message);
    else ws?.broadcastRoom?.(room.id, { type: 'reef_message', roomId: room.id, message });
    ws?.broadcastCoalesced?.(`reef-room:${room.id}`, { type: 'reef_room_updated', roomId: room.id, action: 'message', latestMessage: message });
    mentionNotifications.forEach(notification => {
      ws?.send?.(notification.userId, {
        type: 'notification', category: 'interaction', notificationType: 'reef_mention',
        title: notification.title, content: notification.content, relatedId: room.id, metadata: notification.metadata,
      });
      void sendPushToUser(notification.userId, {
        title: notification.title,
        body: notification.content,
        data: { type: 'reef_mention', relatedId: room.id, ...notification.metadata },
      });
    });
  });
});

router.post('/rooms/:id/messages/:messageId/report', auth, (req, res) => {
  const reportAccess = assertCanReport(db, req.userId);
  if (!reportAccess.ok) return res.status(reportAccess.status).json(reportAccess);
  const message = db.prepare(`
    SELECT m.*,u.nickname,u.username FROM reef_messages m
    JOIN users u ON u.id=m.user_id
    WHERE m.id=? AND m.room_id=?
  `).get(req.params.messageId, req.params.id);
  if (!message) return res.status(404).json({ error: '礁石消息不存在' });
  if (message.user_id === req.userId) return res.status(400).json({ error: '不能举报自己的消息' });
  const duplicate = db.prepare('SELECT id FROM reef_message_reports WHERE message_id=? AND reporter_id=?')
    .get(message.id, req.userId);
  if (duplicate) return res.status(409).json({ error: '这条礁石消息已经举报过了' });
  const reason = String(req.body.reason || 'other').slice(0, 30);
  const detail = String(req.body.detail || '').trim().slice(0, 500);
  const context = db.prepare(`
    SELECT m.id,m.room_id,m.user_id,m.kind,m.content,m.created_at,u.nickname,u.username
    FROM reef_messages m JOIN users u ON u.id=m.user_id
    WHERE m.room_id=?
    ORDER BY m.created_at DESC,m.id DESC LIMIT 20
  `).all(message.room_id).reverse();
  const id = `reef_report_${uuid()}`;
  db.prepare(`
    INSERT INTO reef_message_reports(id,message_id,reporter_id,reason,detail,context_json)
    VALUES (?,?,?,?,?,?)
  `).run(id, message.id, req.userId, reason, detail, JSON.stringify(context));
  res.status(201).json({ ok: true, id });
});

module.exports = router;
