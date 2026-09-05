const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('post publishing is checked before upload and enforced again on creation', () => {
  const posts = source('src/routes/posts.js');
  const client = source('../community-app/src/api/client.ts');
  const publish = source('../community-app/src/app/publish.tsx');

  assert.match(posts, /POST_PUBLISH_COOLDOWN_SECONDS = 44/);
  assert.match(posts, /router\.get\('\/publish-status', auth/);
  assert.match(posts, /status\(429\)[\s\S]*code: 'POST_PUBLISH_COOLDOWN'/);
  assert.match(client, /getPostPublishStatus/);
  assert.match(publish, /await getPostPublishStatus\(\)/);
  assert.match(publish, /44秒内只能发布一份切片！/);
  assert.match(publish, /setTimeout\(\(\) => \{[\s\S]*setPublishLimitMessage\(''\)[\s\S]*\}, 2000\)/);
});

test('historical daily topics use the coded editor and server update route', () => {
  const adminRoute = source('src/routes/admin/append2.js');
  const adminPage = source('src/public/admin/index.html');

  assert.match(adminRoute, /router\.put\('\/daily-themes\/:id', adminAuth/);
  assert.match(adminRoute, /UPDATE daily_themes SET title=\?,created_by=\? WHERE id=\?/);
  assert.match(adminPage, /openDailyThemeEditor/);
  assert.match(adminPage, /saveEditedDailyTheme/);
  assert.doesNotMatch(adminPage, /prompt\([^)]*每日话题/);
});
