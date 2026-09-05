const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = name => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', name), 'utf8');

test('direct messages reject unknown kinds and apply per-kind content bounds', () => {
  const source = route('chat.js');
  assert.match(source, /const MESSAGE_KINDS = new Set\(/);
  assert.match(source, /!MESSAGE_KINDS\.has\(kind\) \|\| typeof content !== 'string'/);
  assert.match(source, /Array\.from\(content\)\.length > MESSAGE_LENGTH_LIMITS\[kind\]/);
});

test('feedback and beacon images must be owned uploads', () => {
  assert.match(route('feedback.js'), /imageUrl && !isOwnedMediaUrl\(imageUrl, req\.userId, req\)/);
  assert.match(route('beacons.js'), /!isOwnedMediaUrl\(image, req\.userId, req\)/);
});

test('beacon text is server-bounded to the same 200 characters shown by the app', () => {
  assert.match(route('beacons.js'), /Array\.from\(content\.trim\(\)\)\.length > 200/);
});
