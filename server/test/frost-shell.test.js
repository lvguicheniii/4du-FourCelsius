const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  FRAGILE_SHELL_STORAGE_LIMIT,
  beijingDate,
  claimOnlineFrostShell,
  transferFrostShellGift,
} = require('../src/lib/frost-shell');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      fragile_frost_shell_count INTEGER NOT NULL DEFAULT 0,
      eternal_frost_shell_count INTEGER NOT NULL DEFAULT 0,
      frost_shell_online_seconds INTEGER NOT NULL DEFAULT 0,
      frost_shell_online_progress_date TEXT,
      frost_shell_daily_claim_date TEXT
    );
    CREATE TABLE frost_shell_transfers (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      related_id TEXT DEFAULT '',
      amount INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      user_id TEXT,
      status TEXT DEFAULT 'active',
      frost_shell_count INTEGER DEFAULT 0,
      refrigerant_count INTEGER DEFAULT 0
    );
    INSERT INTO users (id, fragile_frost_shell_count) VALUES ('sender', 3);
    INSERT INTO users (id) VALUES ('recipient-a'), ('recipient-b');
  `);
  return db;
}

test('a frost shell becomes permanent for the recipient and can only be sent once per recipient each day', () => {
  const db = createDb();

  transferFrostShellGift(db, { senderId: 'sender', recipientId: 'recipient-a', source: 'profile' });
  assert.deepEqual(
    db.prepare('SELECT fragile_frost_shell_count, eternal_frost_shell_count FROM users WHERE id = ?').get('sender'),
    { fragile_frost_shell_count: 2, eternal_frost_shell_count: 0 },
  );
  assert.equal(
    db.prepare('SELECT eternal_frost_shell_count FROM users WHERE id = ?').get('recipient-a').eternal_frost_shell_count,
    1,
  );

  assert.throws(
    () => transferFrostShellGift(db, { senderId: 'sender', recipientId: 'recipient-a', source: 'chat' }),
    /面对同一用户，每天仅可赠送 1 枚脆弱浮霜贝/,
  );

  transferFrostShellGift(db, { senderId: 'sender', recipientId: 'recipient-b', source: 'chat' });
  assert.equal(
    db.prepare('SELECT fragile_frost_shell_count FROM users WHERE id = ?').get('sender').fragile_frost_shell_count,
    1,
  );
  db.close();
});

test('fragile frost shell inventory never exceeds four and completed progress is retained at the cap', () => {
  const db = createDb();
  const today = beijingDate();
  db.prepare(`
    INSERT INTO users (
      id, fragile_frost_shell_count, frost_shell_online_seconds,
      frost_shell_online_progress_date, frost_shell_daily_claim_date
    ) VALUES ('at-cap', ?, 239, ?, '')
  `).run(FRAGILE_SHELL_STORAGE_LIMIT, today);

  const held = claimOnlineFrostShell(db)('at-cap', 1);
  assert.equal(held.granted, false);
  assert.equal(held.fragileCount, FRAGILE_SHELL_STORAGE_LIMIT);
  assert.equal(held.onlineSeconds, 240);
  assert.equal(db.prepare("SELECT fragile_frost_shell_count FROM users WHERE id='at-cap'").get().fragile_frost_shell_count, 4);

  db.prepare("UPDATE users SET fragile_frost_shell_count=3 WHERE id='at-cap'").run();
  const granted = claimOnlineFrostShell(db)('at-cap', 1);
  assert.equal(granted.granted, true);
  assert.equal(granted.fragileCount, FRAGILE_SHELL_STORAGE_LIMIT);
  assert.equal(granted.claimedDate, today);
  db.close();
});
