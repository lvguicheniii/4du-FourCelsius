const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('hot list queries have matching filter and sort indexes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations.js'), 'utf8');

  assert.match(source, /idx_posts_status_created ON posts\(status, created_at DESC\)/);
  assert.match(source, /idx_comments_post_status_created ON comments\(post_id, status, created_at ASC, id ASC\)/);
  assert.match(source, /idx_notifications_user_read_created ON notifications\(user_id, is_read, created_at DESC\)/);
  assert.match(source, /idx_messages_pair_created ON messages\(from_user_id, to_user_id, created_at DESC, id DESC\)/);
});
