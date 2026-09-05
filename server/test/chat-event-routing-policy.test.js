const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chatRouteSource = fs.readFileSync(path.resolve(__dirname, '../src/routes/chat.js'), 'utf8');
const frostShellRouteSource = fs.readFileSync(path.resolve(__dirname, '../src/routes/frost-shells.js'), 'utf8');
const clientSource = fs.readFileSync(path.resolve(__dirname, '../../community-app/src/api/client.ts'), 'utf8');
const chatScreenSource = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/app/chat/[name].tsx'),
  'utf8',
);

test('private-message websocket events identify the conversation for both participants', () => {
  assert.match(chatRouteSource, /peerId: req\.userId, from: req\.userId/);
  assert.match(chatRouteSource, /peerId: targetId, from: 'me'/);
  assert.match(frostShellRouteSource, /peerId: req\.userId/);
  assert.match(frostShellRouteSource, /peerId: recipientId, from: 'me'/);
});

test('the active chat ignores websocket messages belonging to another peer', () => {
  assert.match(chatScreenSource, /const eventPeerId = String\(msg\.peerId \|\| ''\)/);
  assert.match(chatScreenSource, /eventPeerId === peerId/);
  assert.match(chatScreenSource, /if \(!isForCurrentPeer\) continue/);
});

test('late profile responses cannot replace the next conversation profile', () => {
  assert.match(chatScreenSource, /let cancelled = false/);
  assert.match(chatScreenSource, /if \(cancelled \|\| !p\) return/);
  assert.match(chatScreenSource, /return \(\) => \{ cancelled = true; \}/);
  assert.match(chatScreenSource, /setPeerProfile\(entryProfile\)/);
});

test('history polling and pagination cannot write into a different conversation', () => {
  assert.match(chatScreenSource, /activePeerNameRef\.current = peerName/);
  assert.match(chatScreenSource, /activePeerNameRef\.current !== requestedPeerName/);
  assert.match(chatScreenSource, /cancelled \|\| activePeerNameRef\.current !== peerName/);
});

test('drafts and delayed sends cannot leak into the next conversation', () => {
  assert.match(chatScreenSource, /previousPeerNameRef\.current === peerName/);
  assert.match(chatScreenSource, /setPendingMedia\(\[\]\)/);
  assert.match(chatScreenSource, /const sendingPeerName = peerName/);
  assert.match(chatScreenSource, /activePeerNameRef\.current !== sendingPeerName/);
});

test('chat reads, sends, and reports prefer immutable user ids over nicknames', () => {
  assert.match(clientSource, /toUserId: toUserId \|\| undefined/);
  assert.match(clientSource, /params\.set\('userId', options\.userId\)/);
  assert.match(clientSource, /peerUserId: peerUserId \|\| undefined/);
  assert.match(chatRouteSource, /requestedPeerId\s*\?\s*db\.prepare\('SELECT id FROM users WHERE id = \?'\)/);
  assert.match(chatRouteSource, /peerUserId\s*\?\s*db\.prepare\('SELECT id FROM users WHERE id=\?'\)/);
  assert.match(chatScreenSource, /userId: peerId \|\| peerUserId \|\| undefined/);
});
