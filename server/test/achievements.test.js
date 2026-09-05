const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { triggerAchievement, incrementMilestone } = require('../src/lib/achievements');

function achievementDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE achievement_definitions (
      key TEXT PRIMARY KEY,name TEXT,hint TEXT,condition_text TEXT,is_hidden INTEGER DEFAULT 0
    );
    CREATE TABLE user_achievements (
      user_id TEXT,achievement_key TEXT,unlocked_at TEXT DEFAULT CURRENT_TIMESTAMP,
      trigger_count INTEGER DEFAULT 1,last_triggered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,achievement_key)
    );
    CREATE TABLE achievement_counters (
      user_id TEXT,counter_key TEXT,value INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,counter_key)
    );
    CREATE TABLE achievement_events (
      id TEXT PRIMARY KEY,user_id TEXT,achievement_key TEXT,name_snapshot TEXT,hint_snapshot TEXT,
      displayed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE achievement_trigger_refs (
      user_id TEXT,achievement_key TEXT,trigger_ref TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,achievement_key,trigger_ref)
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,user_id TEXT,category TEXT,type TEXT,title TEXT,content TEXT,related_id TEXT
    );
    INSERT INTO users(id) VALUES ('user-1');
    INSERT INTO achievement_definitions(key,name,hint,condition_text)
      VALUES ('r600a','R600a','提示语','第一次使用制冷剂'),
             ('absolute_zero','绝对零度','提示语','累计使用10次制冷剂');
  `);
  return db;
}

test('achievements unlock only once and enqueue one matching notification', () => {
  const db = achievementDb();
  triggerAchievement(db, 'user-1', 'r600a');
  triggerAchievement(db, 'user-1', 'r600a');
  assert.equal(db.prepare("SELECT trigger_count FROM user_achievements WHERE achievement_key='r600a'").get().trigger_count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM achievement_events").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE type='achievement'").get().count, 1);
  const notification = db.prepare("SELECT title,content FROM notifications WHERE type='achievement' ORDER BY rowid DESC LIMIT 1").get();
  assert.deepEqual(notification, { title: '航行日志解锁：R600a', content: '提示语' });
  db.close();
});

test('cumulative achievements keep counting but unlock only once', () => {
  const db = achievementDb();
  for (let i = 0; i < 19; i += 1) {
    incrementMilestone(db, 'user-1', 'refrigerant_uses', 'absolute_zero', 10);
  }
  assert.equal(db.prepare("SELECT value FROM achievement_counters WHERE counter_key='refrigerant_uses'").get().value, 19);
  assert.equal(db.prepare("SELECT trigger_count FROM user_achievements WHERE achievement_key='absolute_zero'").get().trigger_count, 1);
  incrementMilestone(db, 'user-1', 'refrigerant_uses', 'absolute_zero', 10);
  assert.equal(db.prepare("SELECT trigger_count FROM user_achievements WHERE achievement_key='absolute_zero'").get().trigger_count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM achievement_events WHERE achievement_key='absolute_zero'").get().count, 1);
  db.close();
});
