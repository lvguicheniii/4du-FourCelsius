const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authSource = fs.readFileSync(path.resolve(__dirname, '../../community-app/src/contexts/auth.tsx'), 'utf8');
const storeSource = fs.readFileSync(path.resolve(__dirname, '../../community-app/src/data/store.ts'), 'utf8');
const chatSource = fs.readFileSync(path.resolve(__dirname, '../../community-app/src/app/chat/[name].tsx'), 'utf8');

test('login and logout clear account-scoped viewer state', () => {
  assert.match(authSource, /resetAccountScopedStore\(\)/);
  assert.match(storeSource, /postStats\.clear\(\)/);
  assert.match(storeSource, /postStatsUpdatedAt\.clear\(\)/);
  assert.match(storeSource, /Object\.keys\(blockedUsers\)/);
  assert.match(storeSource, /Object\.keys\(reportedPosts\)/);
  assert.match(storeSource, /myStickers\.length = 0/);
});

test('private-message memory caches are partitioned by the signed-in user', () => {
  assert.match(chatSource, /const viewerId = String\(user\?\.id \|\| 'guest'\)/);
  assert.match(chatSource, /const messageCacheKey = `\$\{viewerId\}:\$\{peerName\}`/);
  assert.match(chatSource, /chatMessageCache\.get\(messageCacheKey\)/);
  assert.match(chatSource, /chatMessageCache\.set\(messageCacheKey/);
});
