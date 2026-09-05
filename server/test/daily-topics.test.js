const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { reconcileDailyTopics } = require('../src/lib/daily-topics');

test('daily topics publish on their Beijing date and expire afterwards', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE daily_themes (id TEXT PRIMARY KEY, theme_date TEXT, status TEXT);
    INSERT INTO daily_themes VALUES ('past', date('now','+8 hours','-1 day'), 'active');
    INSERT INTO daily_themes VALUES ('today', date('now','+8 hours'), 'scheduled');
    INSERT INTO daily_themes VALUES ('future', date('now','+8 hours','+1 day'), 'active');
    INSERT INTO daily_themes VALUES ('disabled', date('now','+8 hours'), 'disabled');
  `);

  reconcileDailyTopics(db);
  const states = Object.fromEntries(db.prepare('SELECT id,status FROM daily_themes').all().map(row => [row.id, row.status]));
  assert.deepEqual(states, { past: 'expired', today: 'active', future: 'pending', disabled: 'disabled' });
  db.close();
});
