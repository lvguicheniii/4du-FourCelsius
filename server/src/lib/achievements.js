const { v4: uuid } = require('uuid');
const { sendPushToUser } = require('./push');

function achievementPayload(definition, eventId) {
  return {
    type: 'achievement',
    eventId,
    achievement: {
      key: definition.key,
      name: definition.name,
      hint: definition.hint,
    },
  };
}

function achievementNotificationTitle(name) {
  return `航行日志解锁：${name}`;
}

function triggerAchievement(db, userId, achievementKey, options = {}) {
  if (!userId) return null;
  const tableReady = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='achievement_definitions'
  `).get();
  if (!tableReady) return null;
  const definition = db.prepare(`
    SELECT key,name,hint,condition_text,is_hidden
    FROM achievement_definitions WHERE key=?
  `).get(achievementKey);
  if (!definition) return null;

  const eventId = uuid();
  const notificationId = uuid();
  const write = db.transaction(() => {
    const claimed = db.prepare(`
      INSERT OR IGNORE INTO user_achievements(user_id,achievement_key,trigger_count)
      VALUES (?,?,1)
    `).run(userId, achievementKey);
    if (!claimed.changes) return false;
    if (options.triggerRef) {
      db.prepare(`
        INSERT OR IGNORE INTO achievement_trigger_refs(user_id,achievement_key,trigger_ref)
        VALUES (?,?,?)
      `).run(userId, achievementKey, String(options.triggerRef));
    }
    db.prepare(`
      INSERT INTO achievement_events(id,user_id,achievement_key,name_snapshot,hint_snapshot)
      VALUES (?,?,?,?,?)
    `).run(eventId, userId, achievementKey, definition.name, definition.hint);
    db.prepare(`
      INSERT INTO notifications(id,user_id,category,type,title,content,related_id)
      VALUES (?,?,'system','achievement',?,?,?)
    `).run(notificationId, userId, achievementNotificationTitle(definition.name), definition.hint, achievementKey);
    return true;
  });
  if (!write()) return null;

  options.ws?.send?.(userId, achievementPayload(definition, eventId));
  sendPushToUser(userId, {
    title: achievementNotificationTitle(definition.name),
    body: definition.hint,
    data: { type: 'achievement', achievementKey },
    color: '#33A9DC',
    richContent: {
      image: 'https://your-api.example/api/notification-assets/achievement-award.png',
    },
  });
  return { eventId, notificationId, definition };
}

function incrementCounter(db, userId, counterKey, amount = 1) {
  db.prepare(`
    INSERT INTO achievement_counters(user_id,counter_key,value)
    VALUES (?,?,?)
    ON CONFLICT(user_id,counter_key) DO UPDATE SET
      value=MAX(0,value+excluded.value),
      updated_at=datetime('now','+8 hours')
  `).run(userId, counterKey, amount);
  return db.prepare(`
    SELECT value FROM achievement_counters WHERE user_id=? AND counter_key=?
  `).get(userId, counterKey)?.value || 0;
}

function incrementMilestone(db, userId, counterKey, achievementKey, threshold, options = {}) {
  const before = db.prepare(`
    SELECT value FROM achievement_counters WHERE user_id=? AND counter_key=?
  `).get(userId, counterKey)?.value || 0;
  const value = incrementCounter(db, userId, counterKey, options.amount || 1);
  if (Math.floor(value / threshold) > Math.floor(before / threshold)) {
    return triggerAchievement(db, userId, achievementKey, options);
  }
  return null;
}

module.exports = {
  triggerAchievement,
  incrementCounter,
  incrementMilestone,
};
