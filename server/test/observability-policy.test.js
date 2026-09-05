const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src/index.js'), 'utf8');

test('API responses and server errors carry a request id', () => {
  assert.match(indexSource, /res\.set\('X-Request-ID', req\.requestId\)/);
  assert.match(indexSource, /requestId: req\.requestId/);
  assert.match(indexSource, /unhandled_request_error/);
});

test('structured failure logs avoid request bodies and authorization headers', () => {
  const failureLogger = indexSource.slice(indexSource.indexOf("type: 'http_request_failed'"), indexSource.indexOf("app.use('/uploads'"));
  assert.doesNotMatch(failureLogger, /req\.body/);
  assert.doesNotMatch(failureLogger, /authorization/i);
});
