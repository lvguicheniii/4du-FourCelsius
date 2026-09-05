const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('new reefs use their creation time until the first message arrives', () => {
  const reefRoute = read('src/routes/reef.js');
  const messages = read('../community-app/src/app/(tabs)/messages.tsx');
  assert.match(reefRoute, /createdAt: room\.created_at/);
  assert.match(reefRoute, /latestMessage\?\.time \|\| a\.createdAt/);
  assert.match(messages, /data\.latestMessage\?\.time \|\| data\.createdAt/);
});

test('destroying a reported reef notifies its owner and speaking participants', () => {
  const admin = read('src/routes/admin/api.js');
  assert.match(admin, /SELECT DISTINCT user_id FROM reef_messages WHERE room_id=\?/);
  assert.match(admin, /recipients\.add\(room\.owner_id\)/);
  assert.match(admin, /礁石已被系统摧毁，原因：/);
});

test('moderation and report cards are ordered newest first in every status', () => {
  const reports = read('src/routes/admin/api.js');
  const moderation = read('src/routes/admin/append4.js');
  assert.equal((reports.match(/ORDER BY r\.created_at DESC/g) || []).length, 5);
  assert.match(moderation, /ORDER BY m\.created_at DESC/);
});
