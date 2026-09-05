const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('high-value create and send routes require idempotency handling', () => {
  const expectations = [
    ['src/routes/posts.js', "idempotent('posts.create')"],
    ['src/routes/comments.js', "idempotent('comments.create')"],
    ['src/routes/chat.js', "idempotent('chat.send')"],
    ['src/routes/reef.js', "idempotent('reef.create')"],
    ['src/routes/reef.js', "idempotent('reef.send-message')"],
    ['src/routes/refrigerant.js', "idempotent('refrigerant.use-on-post')"],
    ['src/routes/refrigerant.js', "idempotent('refrigerant.gift')"],
    ['src/routes/frost-shells.js', "idempotent('frost-shell.gift')"],
    ['src/routes/slice-boxes.js', "idempotent('slice-boxes.create')"],
    ['src/routes/upload.js', "idempotent('upload.file')"],
    ['src/routes/upload.js', "idempotent('upload.motion-photo')"],
  ];
  for (const [file, marker] of expectations) {
    assert.match(source(file), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('cool, comment-like, and follow accept desired state instead of relying on toggles', () => {
  assert.match(source('src/routes/posts.js'), /typeof req\.body\?\.cooled === 'boolean'/);
  assert.match(source('src/routes/comments.js'), /typeof req\.body\?\.liked === 'boolean'/);
  assert.match(source('src/routes/follows.js'), /typeof req\.body\?\.following === 'boolean'/);
});

test('client coalesces identical in-flight mutations and sends an idempotency key', () => {
  const client = source('../community-app/src/api/client.ts');
  assert.match(client, /const inFlightMutations = new Map/);
  assert.match(client, /'Idempotency-Key': createIdempotencyKey\(\)/);
  assert.match(client, /const existing = inFlightMutations\.get\(fingerprint\)/);
  assert.match(client, /app-moderation\\\/posts/);
});
