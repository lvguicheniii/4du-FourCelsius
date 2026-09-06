const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('direct content mutations enforce visibility and mutual blocks', () => {
  const posts = source('src/routes/posts.js');
  const comments = source('src/routes/comments.js');
  const frostShells = source('src/routes/frost-shells.js');
  assert.match(posts, /COALESCE\(p\.visibility,'public'\)='public'/);
  assert.match(posts, /不能举报自己的切片/);
  assert.match(comments, /COALESCE\(p\.visibility, 'public'\) = 'public'/);
  assert.match(frostShells, /当前无法向该用户赠予浮霜贝/);
  assert.match(frostShells, /router\.post\('\/gift', auth, idempotent\('frost-shell\.gift'\), handleGift\)/);
});

test('blocked users cannot resume follows, messages, or gifts through the API', () => {
  assert.match(source('src/routes/chat.js'), /当前无法向该用户发送私信/);
  assert.match(source('src/routes/follows.js'), /当前无法关注该用户/);
  assert.match(source('src/routes/frost-shells.js'), /当前无法向该用户赠予浮霜贝/);
});

test('authenticated users can browse another active users follow lists', () => {
  const follows = source('src/routes/follows.js');
  assert.match(follows, /router\.get\('\/following\/:userId', auth/);
  assert.match(follows, /router\.get\('\/followers\/:userId', auth/);
  assert.doesNotMatch(follows, /关注列表仅本人可见|粉丝列表仅本人可见/);
  assert.match(follows, /AND u\.status != 'deleted'/);
});

test('frost shell gifts and legacy refrigerant alias are server enforced', () => {
  const frostShells = source('src/routes/frost-shells.js');
  const refrigerant = source('src/routes/refrigerant.js');
  assert.match(frostShells, /triggerAchievement\(db, req\.userId, 'hand_fragrance'/);
  assert.doesNotMatch(frostShells, /deep_sea_lantern/);
  assert.match(refrigerant, /const \{ handleGift \} = require\('\.\/frost-shells'\);/);
  assert.match(refrigerant, /router\.post\('\/gift', auth, idempotent\('refrigerant\.gift'\), handleGift\)/);
  assert.doesNotMatch(refrigerant, /gifted_refrigerant_count = gifted_refrigerant_count \+ 1/);
});

test('production refuses weak JWT and default bootstrap administrator credentials', () => {
  assert.match(source('src/lib/security-config.js'), /configuredJwtSecret\.length < 32/);
  const index = source('src/index.js');
  assert.match(index, /ADMIN_BOOTSTRAP_PASSWORD/);
  assert.match(index, /isProduction && bootstrapPassword\.length < 12/);
  assert.match(index, /isProduction && usesPublishedLocalCredentials/);
});
