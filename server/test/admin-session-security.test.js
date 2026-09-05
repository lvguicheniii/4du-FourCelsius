const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'src', 'routes', 'admin', 'api.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src', 'public', 'admin', 'index.html'), 'utf8');

test('admin tokens use a separate secret, purpose, audience and short lifetime', () => {
  assert.match(api, /ADMIN_JWT_SECRET/);
  assert.match(api, /purpose: 'admin'/);
  assert.match(api, /audience: 'sidu-admin'/);
  assert.match(api, /issuer: 'sidu-api'/);
  assert.match(api, /algorithms: \['HS256'\]/);
  assert.match(api, /algorithm: 'HS256'/);
  assert.match(api, /expiresIn: '4h'/);
  assert.match(api, /payload\.purpose !== 'admin'/);
});

test('admin login and credential changes reject oversized inputs', () => {
  assert.match(api, /password\.length > 128/);
  assert.match(api, /old_password\.length > 128/);
  assert.match(api, /new_password\.length > 128/);
  assert.match(api, /username\.trim\(\)\.length > 64/);
});

test('admin responses are not cached', () => {
  assert.match(api, /Cache-Control', 'no-store'/);
  assert.match(api, /Pragma', 'no-cache'/);
});

test('browser token is tab-scoped and idle sessions expire', () => {
  assert.match(page, /sessionStorage\.getItem\('adm_tk'\)/);
  assert.match(page, /sessionStorage\.setItem\('adm_tk',T\)/);
  assert.doesNotMatch(page, /localStorage\.setItem\('adm_tk'/);
  assert.match(page, /ADMIN_IDLE_MS=30\*60\*1000/);
  assert.match(page, /setTimeout\(forceOut,ADMIN_IDLE_MS\)/);
});
