const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  reconcileReefLifecycle,
  recordRetentionVote,
  retentionStatus,
} = require('../src/lib/reef-lifecycle');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, status TEXT DEFAULT 'active');
    CREATE TABLE reef_rooms (
      id TEXT PRIMARY KEY, name TEXT, zone TEXT, owner_id TEXT, status TEXT DEFAULT 'active',
      created_at TEXT, expires_at TEXT, retention_notice_sent_at TEXT,
      retention_extended_at TEXT, destroyed_at TEXT
    );
    CREATE TABLE reef_members (
      room_id TEXT, user_id TEXT, first_joined_at TEXT, last_joined_at TEXT,
      PRIMARY KEY(room_id,user_id)
    );
    CREATE TABLE reef_retention_votes (
      room_id TEXT, user_id TEXT, vote TEXT, created_at TEXT, updated_at TEXT,
      PRIMARY KEY(room_id,user_id)
    );
    CREATE TABLE reef_messages (
      id TEXT PRIMARY KEY, room_id TEXT, user_id TEXT, content TEXT, created_at TEXT
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT, category TEXT, type TEXT, title TEXT,
      content TEXT, related_id TEXT, created_at TEXT
    );
  `);
  db.prepare("INSERT INTO users(id) VALUES ('owner')").run();
  for (let index = 1; index <= 5; index += 1) {
    db.prepare('INSERT INTO users(id) VALUES (?)').run(`u${index}`);
    db.prepare('INSERT INTO reef_members(room_id,user_id,first_joined_at,last_joined_at) VALUES (?,?,?,?)')
      .run('reef_1', `u${index}`, '2026-08-04 05:30:00', '2026-08-04 05:30:00');
  }
  db.prepare(`
    INSERT INTO reef_rooms(id,name,zone,owner_id,created_at,expires_at)
    VALUES ('reef_1','测试','private','owner','2026-08-04 05:00:00','2026-08-05 05:00:00')
  `).run();
  for (let index = 1; index <= 4; index += 1) {
    db.prepare('INSERT INTO reef_messages(id,room_id,user_id,content,created_at) VALUES (?,?,?,?,?)')
      .run(`m${index}`, 'reef_1', `u${index}`, '测试消息', '2026-08-04 06:00:00');
  }
  return db;
}

test('four-hour reef notice is sent once to every speaker and the owner', () => {
  const db = createDb();
  const first = reconcileReefLifecycle(db, { now: '2026-08-04 10:00:00', sendPush: () => Promise.resolve() });
  const second = reconcileReefLifecycle(db, { now: '2026-08-04 10:01:00', sendPush: () => Promise.resolve() });
  assert.equal(first.notifications.length, 5);
  assert.equal(second.notifications.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notifications').get().count, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id='u5'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id='owner'").get().count, 1);
  assert.match(db.prepare('SELECT content FROM notifications LIMIT 1').get().content, /^【测试】礁石已创建超过4个小时/);
  db.close();
});

test('five yes votes including the owner reset destruction countdown to thirty days', () => {
  const db = createDb();
  reconcileReefLifecycle(db, { now: '2026-08-04 10:00:00', sendPush: () => Promise.resolve() });
  recordRetentionVote(db, 'reef_1', 'owner', 'yes', '2026-08-04 10:10:00');
  for (let index = 1; index <= 3; index += 1) {
    recordRetentionVote(db, 'reef_1', `u${index}`, 'yes', '2026-08-04 10:10:00');
  }
  assert.equal(db.prepare("SELECT retention_extended_at FROM reef_rooms WHERE id='reef_1'").get().retention_extended_at, null);
  recordRetentionVote(db, 'reef_1', 'u4', 'yes', '2026-08-04 10:10:00');
  const room = db.prepare('SELECT expires_at,retention_extended_at FROM reef_rooms WHERE id=?').get('reef_1');
  assert.equal(room.expires_at, '2026-09-03 10:10:00');
  assert.equal(room.retention_extended_at, '2026-08-04 10:10:00');
  db.close();
});

test('a member who never spoke cannot vote', () => {
  const db = createDb();
  reconcileReefLifecycle(db, { now: '2026-08-04 10:00:00', sendPush: () => Promise.resolve() });
  assert.throws(
    () => recordRetentionVote(db, 'reef_1', 'u5', 'yes', '2026-08-04 10:10:00'),
    /只有礁石创建者或发言过的用户可以参与投票/,
  );
  db.close();
});

test('a reef retention choice is final and shown on later visits', () => {
  const db = createDb();
  reconcileReefLifecycle(db, { now: '2026-08-04 10:00:00', sendPush: () => Promise.resolve() });
  recordRetentionVote(db, 'reef_1', 'u1', 'no', '2026-08-04 10:10:00');

  const status = retentionStatus(db, 'reef_1', 'u1', '2026-08-04 10:11:00');
  assert.equal(status.myVote, 'no');
  assert.equal(status.canVote, false);
  assert.throws(
    () => recordRetentionVote(db, 'reef_1', 'u1', 'yes', '2026-08-04 10:12:00'),
    /你已选择了否，无法重复投票/,
  );
  assert.equal(db.prepare("SELECT vote FROM reef_retention_votes WHERE room_id='reef_1' AND user_id='u1'").get().vote, 'no');
  db.close();
});

test('expired reef is marked destroyed without deleting messages or room data', () => {
  const db = createDb();
  db.prepare("INSERT INTO reef_messages VALUES ('expired-message','reef_1','owner','永久保留','2026-08-04 06:00:00')").run();
  reconcileReefLifecycle(db, { now: '2026-08-06 10:00:00', sendPush: () => Promise.resolve() });
  assert.equal(db.prepare("SELECT status FROM reef_rooms WHERE id='reef_1'").get().status, 'destroyed');
  assert.equal(db.prepare("SELECT content FROM reef_messages WHERE id='expired-message'").get().content, '永久保留');
  db.close();
});
