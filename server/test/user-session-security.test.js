const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('user tokens are purpose-bound to the Sidu app and an explicit algorithm', () => {
  const authRoute = source('src/routes/auth.js');
  const middleware = source('src/middleware/auth.js');
  assert.match(authRoute, /purpose: 'user'/);
  assert.match(authRoute, /algorithm: 'HS256'/);
  assert.match(authRoute, /issuer: 'sidu-api'/);
  assert.match(authRoute, /audience: 'sidu-app'/);
  assert.match(middleware, /algorithms: \['HS256'\]/);
  assert.match(middleware, /payload\.purpose !== 'user'/);
});

test('HTTP and WebSocket authentication share the same app and web session verifier', () => {
  const middleware = source('src/middleware/auth.js');
  const websocket = source('src/ws.js');
  assert.match(middleware, /verifyAuthToken\(token\)/);
  assert.match(websocket, /verifyAuthToken\(token\)/);
  assert.doesNotMatch(websocket, /jwt\.verify\(token, JWT_SECRET\)/);
});

test('web sessions do not rotate the App single-device token and remain revocable', () => {
  const authRoute = source('src/routes/auth.js');
  const middleware = source('src/middleware/auth.js');
  assert.match(authRoute, /router\.post\('\/web-login'/);
  assert.match(authRoute, /sidu_web_/);
  assert.match(authRoute, /INSERT INTO web_sessions/);
  assert.match(authRoute, /LIMIT 5/);
  assert.match(authRoute, /DELETE FROM web_sessions WHERE user_id/);
  const webLogin = authRoute.slice(authRoute.indexOf("router.post('/web-login'"), authRoute.indexOf("router.post('/web-logout'"));
  assert.doesNotMatch(webLogin, /token_version\s*=/);
  assert.match(middleware, /webSessionHash/);
});
