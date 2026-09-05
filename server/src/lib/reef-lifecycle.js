const { v4: uuid } = require('uuid');
const { nowCst } = require('./time');

const REQUIRED_YES_VOTES = 5;

function reefError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function retentionStatus(db, roomId, userId, now = nowCst()) {
  const room = db.prepare(`
    SELECT id,name,zone,owner_id,status,expires_at,retention_notice_sent_at,retention_extended_at
    FROM reef_rooms WHERE id=?
  `).get(roomId);
  if (!room) throw reefError('礁石不存在', 404);
  const vote = db.prepare('SELECT vote FROM reef_retention_votes WHERE room_id=? AND user_id=?').get(roomId, userId);
  const yesCount = db.prepare("SELECT COUNT(*) AS count FROM reef_retention_votes WHERE room_id=? AND vote='yes'").get(roomId).count;
  const canParticipate = room.owner_id === userId || !!db.prepare(`
    SELECT 1 FROM reef_messages WHERE room_id=? AND user_id=? LIMIT 1
  `).get(roomId, userId);
  return {
    roomId: room.id,
    roomName: room.name,
    status: room.status,
    expiresAt: room.expires_at,
    noticeSent: !!room.retention_notice_sent_at,
    extended: !!room.retention_extended_at,
    myVote: vote?.vote || null,
    yesCount,
    requiredYesVotes: REQUIRED_YES_VOTES,
    canVote: room.zone === 'private'
      && room.status === 'active'
      && canParticipate
      && !vote
      && !!room.retention_notice_sent_at
      && (!room.expires_at || room.expires_at > now),
  };
}

function recordRetentionVote(db, roomId, userId, vote, now = nowCst()) {
  if (!['yes', 'no'].includes(vote)) throw reefError('请选择是否保留礁石');
  const room = db.prepare(`
    SELECT id,zone,owner_id,status,expires_at,retention_notice_sent_at,retention_extended_at
    FROM reef_rooms WHERE id=?
  `).get(roomId);
  if (!room) throw reefError('礁石不存在', 404);
  if (room.zone !== 'private') throw reefError('公海礁石无需存续投票');
  if (room.status !== 'active' || (room.expires_at && room.expires_at <= now)) {
    throw reefError('这座礁石已经摧毁，无法继续投票', 410);
  }
  if (!room.retention_notice_sent_at) throw reefError('存续投票尚未开始', 409);
  const canParticipate = room.owner_id === userId || !!db.prepare(`
    SELECT 1 FROM reef_messages WHERE room_id=? AND user_id=? LIMIT 1
  `).get(roomId, userId);
  if (!canParticipate) throw reefError('只有礁石创建者或发言过的用户可以参与投票', 403);

  return db.transaction(() => {
    const existingVote = db.prepare('SELECT vote FROM reef_retention_votes WHERE room_id=? AND user_id=?').get(roomId, userId);
    if (existingVote) throw reefError(`你已选择了${existingVote.vote === 'yes' ? '是' : '否'}，无法重复投票`, 409);
    db.prepare(`
      INSERT INTO reef_retention_votes(room_id,user_id,vote,created_at,updated_at)
      VALUES (?,?,?,?,?)
    `).run(roomId, userId, vote, now, now);
    const yesCount = db.prepare("SELECT COUNT(*) AS count FROM reef_retention_votes WHERE room_id=? AND vote='yes'").get(roomId).count;
    let extended = !!room.retention_extended_at;
    if (!extended && yesCount >= REQUIRED_YES_VOTES) {
      const expiresAt = db.prepare("SELECT datetime(?,'+30 days') AS value").get(now).value;
      db.prepare('UPDATE reef_rooms SET expires_at=?,retention_extended_at=? WHERE id=?')
        .run(expiresAt, now, roomId);
      extended = true;
    }
    return {
      ok: true,
      myVote: vote,
      yesCount,
      requiredYesVotes: REQUIRED_YES_VOTES,
      extended,
      expiresAt: db.prepare('SELECT expires_at FROM reef_rooms WHERE id=?').get(roomId).expires_at,
    };
  })();
}

function reconcileReefLifecycle(db, options = {}) {
  const now = options.now || nowCst();
  const ws = options.ws;
  const notifications = [];
  const destroyedRoomIds = [];
  const destroyedAchievementOwners = [];

  db.transaction(() => {
    const expired = db.prepare(`
      SELECT id,name,owner_id,retention_notice_sent_at,retention_extended_at FROM reef_rooms
      WHERE zone='private' AND status='active' AND expires_at IS NOT NULL AND expires_at<=?
    `).all(now);
    const reefMessageTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reef_messages'").get();
    const reefMessageColumns = reefMessageTable ? db.prepare('PRAGMA table_info(reef_messages)').all().map(column => column.name) : [];
    const destroyedRecipients = reefMessageColumns.includes('user_id') ? db.prepare(`
      SELECT DISTINCT m.user_id FROM reef_messages m
      JOIN users u ON u.id=m.user_id
      WHERE m.room_id=? AND u.status!='deleted'
    `) : { all: () => [] };
    const insertDestroyedNotification = db.prepare(`
      INSERT INTO notifications(id,user_id,category,type,title,content,related_id,created_at)
      VALUES (?,?,'system','reef_destroyed',?,?,?,?)
    `);
    for (const room of expired) {
      db.prepare("UPDATE reef_rooms SET status='destroyed',destroyed_at=? WHERE id=? AND status='active'")
        .run(now, room.id);
      destroyedRoomIds.push(room.id);
      if (room.owner_id && !room.retention_extended_at) {
        destroyedAchievementOwners.push({ userId: room.owner_id, roomId: room.id });
      }
      const title = `礁石【${room.name}】已被摧毁`;
      const content = '原因：存续时间到期。';
      for (const recipient of destroyedRecipients.all(room.id)) {
        const id = uuid();
        insertDestroyedNotification.run(id, recipient.user_id, title, content, room.id, now);
        notifications.push({ id, userId: recipient.user_id, type: 'reef_destroyed', title, content, relatedId: room.id });
      }
    }

    const eligible = db.prepare(`
      SELECT id,name,owner_id FROM reef_rooms
      WHERE zone='private' AND status='active'
        AND retention_notice_sent_at IS NULL
        AND created_at<=datetime(?,'-4 hours')
        AND (expires_at IS NULL OR expires_at>?)
    `).all(now, now);
    const recipientsForRoom = db.prepare(`
      SELECT DISTINCT m.user_id
      FROM reef_messages m
      JOIN users u ON u.id=m.user_id
      WHERE m.room_id=? AND u.status!='deleted'
      UNION
      SELECT rr.owner_id
      FROM reef_rooms rr
      JOIN users u ON u.id=rr.owner_id
      WHERE rr.id=? AND rr.owner_id IS NOT NULL AND u.status!='deleted'
    `);
    const insertNotification = db.prepare(`
      INSERT INTO notifications(id,user_id,category,type,title,content,related_id,created_at)
      VALUES (?,?,'system','reef_retention_vote','礁石存续许可',?,?,?)
    `);
    for (const room of eligible) {
      db.prepare('UPDATE reef_rooms SET retention_notice_sent_at=? WHERE id=? AND retention_notice_sent_at IS NULL')
        .run(now, room.id);
      const content = `【${room.name}】礁石已创建超过4个小时，是否同意继续保存礁石30天？`;
      for (const recipient of recipientsForRoom.all(room.id, room.id)) {
        const id = uuid();
        insertNotification.run(id, recipient.user_id, content, room.id, now);
        notifications.push({
          id,
          userId: recipient.user_id,
          type: 'reef_retention_vote',
          title: '礁石存续许可',
          content,
          relatedId: room.id,
        });
      }
    }
  })();

  for (const roomId of destroyedRoomIds) {
    ws?.broadcast?.({ type: 'reef_room_updated', roomId, action: 'destroyed' });
  }
  for (const item of destroyedAchievementOwners) {
    require('./achievements').triggerAchievement(db, item.userId, 'brief_current', {
      ws,
      triggerRef: `reef:${item.roomId}`,
    });
  }
  for (const notification of notifications) {
    ws?.send?.(notification.userId, {
      type: 'notification',
      category: 'system',
      notificationType: notification.type,
      title: notification.title,
      content: notification.content,
      relatedId: notification.relatedId,
    });
    const sendPush = options.sendPush || (() => {
      try { return require('./push').sendPushToUser; } catch { return null; }
    })();
    sendPush?.(notification.userId, {
      title: notification.title,
      body: notification.content,
      data: { type: notification.type, relatedId: notification.relatedId, route: 'notifications' },
    })?.catch?.((error) => console.error('Reef retention push failed:', error.message));
  }

  return { now, destroyedRoomIds, notifications };
}

module.exports = {
  REQUIRED_YES_VOTES,
  reconcileReefLifecycle,
  recordRetentionVote,
  retentionStatus,
};
