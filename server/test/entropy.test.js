const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { getEntropyState, settleReport } = require('../src/lib/entropy');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      calibration_value INTEGER NOT NULL DEFAULT 0,
      invalid_report_count INTEGER NOT NULL DEFAULT 0,
      report_cooldown_until TEXT,
      entropy_lv4_earned INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      category TEXT,
      type TEXT,
      title TEXT,
      content TEXT,
      related_id TEXT,
      created_at TEXT
    );
    CREATE TABLE post_reports (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      reporter_id TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT,
      calibration_processed INTEGER NOT NULL DEFAULT 0,
      calibration_delta INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

test('first three accepted reporters receive the early warning bonus once', () => {
  const db = createDb();
  db.prepare('INSERT INTO users(id) VALUES (?)').run('u1');
  db.prepare('INSERT INTO post_reports(id,post_id,reporter_id,created_at) VALUES (?,?,?,?)')
    .run('r1', 'p1', 'u1', '2026-08-04 10:00:00');

  const first = settleReport(db, {
    table: 'post_reports', targetColumn: 'post_id', reportId: 'r1', status: 'accepted',
  });
  const repeated = settleReport(db, {
    table: 'post_reports', targetColumn: 'post_id', reportId: 'r1', status: 'accepted',
  });

  assert.equal(first.delta, 10);
  assert.equal(repeated.processed, false);
  assert.equal(db.prepare('SELECT calibration_value FROM users WHERE id=?').get('u1').calibration_value, 10);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM notifications').get().count, 1);
});

test('five rejected reports overload the detector and start a seven-day repair cooldown below zero', () => {
  const db = createDb();
  db.prepare('INSERT INTO users(id) VALUES (?)').run('u1');
  const insert = db.prepare('INSERT INTO post_reports(id,post_id,reporter_id,created_at) VALUES (?,?,?,?)');
  for (let index = 1; index <= 5; index += 1) {
    insert.run(`r${index}`, `p${index}`, 'u1', `2026-08-04 10:0${index}:00`);
    settleReport(db, {
      table: 'post_reports', targetColumn: 'post_id', reportId: `r${index}`, status: 'rejected',
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE id=?').get('u1');
  assert.equal(user.calibration_value, -25);
  assert.equal(user.invalid_report_count, 0);
  assert.ok(user.report_cooldown_until);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE type='entropy_penalty'").get().count, 1);
  const state = getEntropyState(user);
  assert.equal(state.damaged, true);
  assert.equal(state.reportCooldownActive, true);
});

test('level four remains permanent after it has been earned', () => {
  const state = getEntropyState({ calibration_value: 100, entropy_lv4_earned: 1 });
  assert.equal(state.level, 4);
  assert.equal(state.title, '肆度守望者');
  assert.equal(state.progress, 1);
});
