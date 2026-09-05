const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const postsSource = fs.readFileSync(path.join(__dirname, '..', 'src/routes/posts.js'), 'utf8');
const profileSource = fs.readFileSync(path.join(__dirname, '..', '..', 'community-app/src/app/user/[name].tsx'), 'utf8');

test('cooled-post history excludes deleted or moderated posts', () => {
  const cooledRoute = postsSource.slice(postsSource.indexOf("router.get(['/cooled'"), postsSource.indexOf("router.get('/recommend'"));
  assert.match(cooledRoute, /p\.status = 'active'/);
});

test('board feeds use exact JSON membership instead of substring matching', () => {
  assert.match(postsSource, /json_each\(p\.board_id\)/);
  assert.doesNotMatch(postsSource, /p\.board_id LIKE \?/);
});

test('user profiles request that user directly instead of filtering a global page', () => {
  assert.match(profileSource, /getPosts\(1, 50, undefined, data\.id\)/);
  assert.doesNotMatch(profileSource, /pd\.posts\.filter/);
});
