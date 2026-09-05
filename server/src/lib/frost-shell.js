const { v4: uuid } = require('uuid');
const { nowCst } = require('./time');

const ONLINE_SECONDS_PER_SHELL = 240;
const FRAGILE_SHELL_STORAGE_LIMIT = 4;

function beijingDate(value = new Date()) {
  return nowCst(value).slice(0, 10);
}

function getFrostShellState(db, userId) {
  if (!userId) {
    return {
      fragileCount: 0,
      eternalCount: 0,
      onlineSeconds: 0,
      progressDate: '',
      claimedDate: '',
    };
  }
  const user = db.prepare(`
    SELECT fragile_frost_shell_count, eternal_frost_shell_count,
           frost_shell_online_seconds, frost_shell_online_progress_date,
           frost_shell_daily_claim_date, gifted_refrigerant_count
    FROM users WHERE id = ?
  `).get(userId);
  return {
    fragileCount: Math.min(FRAGILE_SHELL_STORAGE_LIMIT, Math.max(0, Number(user?.fragile_frost_shell_count) || 0)),
    eternalCount: Math.max(0, Number(user?.eternal_frost_shell_count ?? user?.gifted_refrigerant_count) || 0),
    onlineSeconds: Math.max(0, Number(user?.frost_shell_online_seconds) || 0),
    progressDate: String(user?.frost_shell_online_progress_date || ''),
    claimedDate: String(user?.frost_shell_daily_claim_date || ''),
  };
}

const claimOnlineFrostShell = db => db.transaction((userId, seconds = 0) => {
  const user = db.prepare(`
    SELECT fragile_frost_shell_count, eternal_frost_shell_count,
           frost_shell_online_seconds, frost_shell_online_progress_date,
           frost_shell_daily_claim_date
    FROM users WHERE id = ?
  `).get(userId);
  if (!user) {
    return {
      granted: false,
      fragileCount: 0,
      eternalCount: 0,
      onlineSeconds: 0,
      progressDate: '',
      claimedDate: '',
    };
  }

  const storedFragileCount = Math.max(0, Number(user.fragile_frost_shell_count) || 0);
  const fragileCount = Math.min(FRAGILE_SHELL_STORAGE_LIMIT, storedFragileCount);
  if (storedFragileCount !== fragileCount) {
    db.prepare('UPDATE users SET fragile_frost_shell_count = ? WHERE id = ?').run(fragileCount, userId);
  }

  const today = beijingDate();
  const currentProgress = user.frost_shell_online_progress_date === today
    ? Math.max(0, Number(user.frost_shell_online_seconds) || 0)
    : 0;
  if (user.frost_shell_daily_claim_date === today) {
    if (user.frost_shell_online_progress_date !== today || Number(user.frost_shell_online_seconds) !== 0) {
      db.prepare(`
        UPDATE users
        SET frost_shell_online_seconds = 0,
            frost_shell_online_progress_date = ?
        WHERE id = ?
      `).run(today, userId);
    }
    return {
      granted: false,
      fragileCount,
      eternalCount: Math.max(0, Number(user.eternal_frost_shell_count) || 0),
      onlineSeconds: 0,
      progressDate: today,
      claimedDate: today,
    };
  }

  const nextProgress = currentProgress + Math.max(0, Math.floor(Number(seconds) || 0));
  if (nextProgress >= ONLINE_SECONDS_PER_SHELL) {
    if (fragileCount >= FRAGILE_SHELL_STORAGE_LIMIT) {
      db.prepare(`
        UPDATE users
        SET frost_shell_online_seconds = ?,
            frost_shell_online_progress_date = ?
        WHERE id = ?
      `).run(ONLINE_SECONDS_PER_SHELL, today, userId);
      return {
        granted: false,
        fragileCount: FRAGILE_SHELL_STORAGE_LIMIT,
        eternalCount: Math.max(0, Number(user.eternal_frost_shell_count) || 0),
        onlineSeconds: ONLINE_SECONDS_PER_SHELL,
        progressDate: today,
        claimedDate: String(user.frost_shell_daily_claim_date || ''),
      };
    }
    db.prepare(`
      UPDATE users
      SET fragile_frost_shell_count = COALESCE(fragile_frost_shell_count, 0) + 1,
          frost_shell_online_seconds = 0,
          frost_shell_online_progress_date = ?,
          frost_shell_daily_claim_date = ?
      WHERE id = ?
    `).run(today, today, userId);
    return {
      granted: true,
      fragileCount: fragileCount + 1,
      eternalCount: Math.max(0, Number(user.eternal_frost_shell_count) || 0),
      onlineSeconds: 0,
      progressDate: today,
      claimedDate: today,
    };
  }

  db.prepare(`
    UPDATE users
    SET frost_shell_online_seconds = ?,
        frost_shell_online_progress_date = ?
    WHERE id = ?
  `).run(nextProgress, today, userId);
  return {
    granted: false,
    fragileCount,
    eternalCount: Math.max(0, Number(user.eternal_frost_shell_count) || 0),
    onlineSeconds: nextProgress,
    progressDate: today,
    claimedDate: String(user.frost_shell_daily_claim_date || ''),
  };
});

function transferFrostShellGift(db, {
  senderId,
  recipientId,
  source = 'profile',
  relatedId = '',
  senderName = '',
  recipientName = '',
}) {
  const normalizedSource = ['chat', 'comment', 'profile'].includes(source) ? source : 'profile';
  const time = nowCst();
  const giftDate = time.slice(0, 10);
  const transferId = `shell_${uuid()}`;
  let messageId = null;
  let commentFrostShellCount = null;
  let notificationRelatedId = relatedId || senderId;

  db.transaction(() => {
    const currentSender = db.prepare('SELECT fragile_frost_shell_count FROM users WHERE id = ?').get(senderId);
    if ((Number(currentSender?.fragile_frost_shell_count) || 0) < 1) {
      const error = new Error('浮霜贝不足');
      error.status = 409;
      throw error;
    }

    const giftedRecipientToday = db.prepare(`
      SELECT 1 FROM frost_shell_transfers
      WHERE from_user_id = ? AND to_user_id = ? AND substr(created_at, 1, 10) = ?
      LIMIT 1
    `).get(senderId, recipientId, giftDate);
    if (giftedRecipientToday) {
      const error = new Error('面对同一用户，每天仅可赠送 1 枚脆弱浮霜贝');
      error.status = 409;
      throw error;
    }

    if (normalizedSource === 'chat') {
      messageId = `msg_${uuid()}`;
    }

    if (normalizedSource === 'comment') {
      const comment = db.prepare(`
        SELECT id, post_id, user_id, COALESCE(frost_shell_count, refrigerant_count, 0) AS shell_count
        FROM comments
        WHERE id = ? AND user_id = ? AND status = 'active'
      `).get(relatedId, recipientId);
      if (!comment) {
        const error = new Error('评论不存在或已被删除');
        error.status = 404;
        throw error;
      }
      commentFrostShellCount = (Number(comment.shell_count) || 0) + 1;
      notificationRelatedId = comment.post_id;
      db.prepare('UPDATE comments SET frost_shell_count = ?, refrigerant_count = ? WHERE id = ?')
        .run(commentFrostShellCount, commentFrostShellCount, relatedId);
    }

    db.prepare(`
      UPDATE users
      SET fragile_frost_shell_count = fragile_frost_shell_count - 1
      WHERE id = ?
    `).run(senderId);
    db.prepare(`
      UPDATE users
      SET eternal_frost_shell_count = eternal_frost_shell_count + 1
      WHERE id = ?
    `).run(recipientId);
    db.prepare(`
      INSERT INTO frost_shell_transfers (id, from_user_id, to_user_id, source, related_id, amount, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(transferId, senderId, recipientId, normalizedSource, relatedId, time);
  })();

  return {
    transferId,
    time,
    messageId,
    commentFrostShellCount,
    notificationRelatedId,
    senderName,
    recipientName,
    source: normalizedSource,
  };
}

module.exports = {
  ONLINE_SECONDS_PER_SHELL,
  FRAGILE_SHELL_STORAGE_LIMIT,
  beijingDate,
  getFrostShellState,
  claimOnlineFrostShell,
  transferFrostShellGift,
};
