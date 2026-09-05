const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const appRoot = path.join(__dirname, '..', '..', 'community-app', 'src');

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

test('account changes clear legacy viewer state as well as server-backed caches', () => {
  const store = read('data/store.ts');

  for (const reset of [
    "_lastPostId = undefined",
    "_lastPeerName = ''",
    '_selPostId = null',
    "_bio = ''",
    '_tags = []',
    '_avatar = null',
    "_nickname = ''",
    '_deepFreezeTrigger = 0',
  ]) {
    assert.match(store, new RegExp(reset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(store, /Object\.keys\(_extraComments\)/);
});

test('websocket transient state and de-duplication are scoped to the current token', () => {
  const ws = read('contexts/ws.tsx');

  assert.match(ws, /activeTokenRef\.current !== token/);
  assert.match(ws, /seenEventIdsRef\.current\.clear\(\)/);
  assert.match(ws, /setChatEvents\(\[\]\)/);
  assert.match(ws, /setReefEvents\(\[\]\)/);
  assert.match(ws, /if \(wsRef\.current !== ws\) return;\s*setPostStats/);
});
