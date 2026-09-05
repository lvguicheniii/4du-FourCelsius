const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const ws = fs.readFileSync(path.join(root, 'ws.js'), 'utf8');
const idempotency = fs.readFileSync(path.join(root, 'middleware', 'idempotency.js'), 'utf8');

test('JSON requests have a conservative configurable size limit', () => {
  assert.match(index, /express\.json\(\{ limit: process\.env\.JSON_BODY_LIMIT \|\| '1mb', strict: true \}\)/);
  assert.match(index, /status === 413/);
});

test('WebSocket frames are bounded and compression is disabled', () => {
  assert.match(ws, /WS_MAX_PAYLOAD_BYTES/);
  assert.match(ws, /maxPayload: MAX_PAYLOAD_BYTES/);
  assert.match(ws, /perMessageDeflate: false/);
});

test('idempotency history is pruned on startup and periodically', () => {
  assert.match(idempotency, /completed[\s\S]*-7 days/);
  assert.match(idempotency, /pending[\s\S]*-1 day/);
  assert.match(index, /pruneIdempotencyRequests\(\)/);
  assert.match(index, /setInterval\(pruneIdempotencyRequests, 24 \* 60 \* 60 \* 1000\)/);
  assert.match(index, /clearInterval\(idempotencyCleanupTimer\)/);
});
