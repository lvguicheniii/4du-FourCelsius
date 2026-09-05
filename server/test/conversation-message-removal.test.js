const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('conversation previews ignore messages hidden by the current user', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/chat.js'), 'utf8');
  const conversations = source.slice(source.indexOf("router.get('/conversations'"), source.indexOf("router.get('/conversations/:peerId/preference'"));
  assert.match(conversations, /message_user_hides h/);
  assert.match(conversations, /h\.message_id = m\.id AND h\.user_id = \?/);
  assert.match(conversations, /message_user_hides unread_hide/);
});

test('message list refreshes immediately for recall websocket events', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'community-app', 'src', 'app', '(tabs)', 'messages.tsx'), 'utf8');
  assert.match(source, /lastChatMsg\?\.type === 'chat_message_recalled'/);
});
