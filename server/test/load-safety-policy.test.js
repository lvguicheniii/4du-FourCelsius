const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('WebSocket fanout uses cached block relationships and slow-client backpressure', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'ws.js'), 'utf8');
  const roomFanout = source.slice(source.indexOf('function broadcastRoom'), source.indexOf('function send(userId'));
  const globalFanout = source.slice(source.indexOf('function broadcast(data)'), source.indexOf('function getOnlineCount'));
  assert.match(source, /reloadBlockedPairs\(\)/);
  assert.match(source, /updateBlockPair/);
  assert.match(source, /MAX_SOCKET_BUFFER_BYTES/);
  assert.match(source, /ws\.bufferedAmount/);
  assert.match(source, /pendingLastOnline/);
  assert.match(source, /function broadcastRoomMessage/);
  assert.match(source, /type: 'reef_message_batch'/);
  assert.doesNotMatch(roomFanout, /db\.prepare/);
  assert.doesNotMatch(globalFanout, /db\.prepare/);
});

test('password work is asynchronous and bounded', () => {
  const work = fs.readFileSync(path.join(root, 'src', 'lib', 'password-work.js'), 'utf8');
  const auth = fs.readFileSync(path.join(root, 'src', 'routes', 'auth.js'), 'utf8');
  assert.match(work, /MAX_CONCURRENCY/);
  assert.match(work, /MAX_QUEUE/);
  assert.match(work, /bcrypt\.hash\(/);
  assert.match(work, /bcrypt\.compare\(/);
  assert.doesNotMatch(auth, /bcrypt\.(?:hashSync|compareSync)/);
});

test('high-frequency mutations and media uploads have overload protection', () => {
  const comments = fs.readFileSync(path.join(root, 'src', 'routes', 'comments.js'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'src', 'routes', 'chat.js'), 'utf8');
  const reef = fs.readFileSync(path.join(root, 'src', 'routes', 'reef.js'), 'utf8');
  const upload = fs.readFileSync(path.join(root, 'src', 'routes', 'upload.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, '..', 'community-app', 'src', 'api', 'client.ts'), 'utf8');
  assert.match(comments, /commentWriteLimit/);
  assert.match(chat, /directMessageWriteLimit/);
  assert.match(reef, /reefMessageWriteLimit/);
  assert.match(upload, /uploadConcurrencyLimit/);
  assert.match(upload, /withImageProcessingSlot/);
  assert.match(client, /retryAfterSeconds/);
  assert.match(client, /const maxAttempts = 6/);
  assert.match(client, /0\.8 \+ Math\.random\(\) \* 0\.4/);
});
