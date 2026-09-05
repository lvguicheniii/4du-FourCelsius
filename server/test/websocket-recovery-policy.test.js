const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');

test('mobile WebSocket recovery handles stale foreground sockets and event bursts', () => {
  const context = fs.readFileSync(path.join(root, 'community-app', 'src', 'contexts', 'ws.tsx'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'community-app', 'src', 'app', 'chat', '[name].tsx'), 'utf8');
  const reef = fs.readFileSync(path.join(root, 'community-app', 'src', 'app', 'reef', '[id].tsx'), 'utf8');

  assert.match(context, /AppState\.addEventListener/);
  assert.match(context, /msg\.type === 'pong'/);
  assert.match(context, /event\.code === 4001 \|\| event\.code === 4003/);
  assert.match(context, /event\.code === 1012/);
  assert.match(context, /if \(wsRef\.current !== ws\) return/);
  assert.match(context, /setChatEvents\(current => \[\.\.\.current, msg\]\.slice\(-100\)\)/);
  assert.match(context, /msg\.type === 'reef_message_batch'/);
  assert.match(context, /setReefEvents\(current => \[\.\.\.current, \.\.\.events\]\.slice\(-100\)\)/);
  assert.match(chat, /const pending = chatEvents\.filter/);
  assert.match(reef, /connectionVersion > 1/);
});
