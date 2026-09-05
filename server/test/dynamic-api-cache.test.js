const assert = require('node:assert/strict');
const test = require('node:test');

const {
  disableDynamicApiCaching,
  isImmutableApiAsset,
} = require('../src/middleware/dynamic-api-cache');

test('dynamic API middleware removes conditional validators and forbids caching', () => {
  const req = {
    path: '/posts',
    headers: {
      'if-none-match': 'W/"cached"',
      'if-modified-since': 'Sun, 30 Aug 2026 10:00:00 GMT',
    },
  };
  const responseHeaders = {};
  const res = { set(name, value) { responseHeaders[name] = value; } };
  let continued = false;

  disableDynamicApiCaching(req, res, () => { continued = true; });

  assert.equal(continued, true);
  assert.equal(req.headers['if-none-match'], undefined);
  assert.equal(req.headers['if-modified-since'], undefined);
  assert.match(responseHeaders['Cache-Control'], /no-store/);
  assert.equal(responseHeaders.Pragma, 'no-cache');
  assert.equal(responseHeaders.Expires, '0');
});

test('immutable API assets retain their route-specific cache policy', () => {
  assert.equal(isImmutableApiAsset('/notification-assets/achievement.png'), true);
  assert.equal(isImmutableApiAsset('/app-updates/ota/assets/deadbeef'), true);
  assert.equal(isImmutableApiAsset('/posts'), false);

  const req = {
    path: '/app-updates/ota/assets/deadbeef',
    headers: { 'if-none-match': '"asset"' },
  };
  let headerWrites = 0;
  disableDynamicApiCaching(req, { set() { headerWrites += 1; } }, () => {});
  assert.equal(req.headers['if-none-match'], '"asset"');
  assert.equal(headerWrites, 0);
});
