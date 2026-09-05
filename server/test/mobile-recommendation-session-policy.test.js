const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/lib/recommendation-events.ts'),
  'utf8',
);

test('recommendation queues and impression de-duplication reset across accounts', () => {
  assert.match(source, /let queueToken = getToken\(\)/);
  assert.match(source, /if \(currentToken !== queueToken\) resetScope\(currentToken\)/);
  assert.match(source, /queue = \[\]/);
  assert.match(source, /impressionIds\.clear\(\)/);
  assert.match(source, /sessionId = createSessionId\(\)/);
});

test('a delayed recommendation flush cannot use a newer account token', () => {
  assert.match(source, /if \(getToken\(\) !== queueToken\)/);
  assert.match(source, /resetScope\(getToken\(\)\)/);
});
