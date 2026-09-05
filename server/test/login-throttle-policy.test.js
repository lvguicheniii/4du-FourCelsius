const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('administrator and user login throttles survive process restarts', () => {
  const throttle = fs.readFileSync(path.join(root, 'src', 'lib', 'login-throttle.js'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'src', 'routes', 'admin', 'api.js'), 'utf8');
  const auth = fs.readFileSync(path.join(root, 'src', 'routes', 'auth.js'), 'utf8');
  const migrations = fs.readFileSync(path.join(root, 'src', 'db', 'migrations.js'), 'utf8');

  assert.match(migrations, /CREATE TABLE IF NOT EXISTS login_throttles/);
  assert.match(throttle, /createHmac\('sha256', JWT_SECRET\)/);
  assert.match(throttle, /ON CONFLICT\(scope,subject_hash\) DO UPDATE/);
  assert.match(throttle, /DELETE FROM login_throttles/);
  assert.match(throttle, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(admin, /admin_account/);
  assert.match(admin, /Retry-After/);
  assert.match(auth, /user_account/);
  assert.match(auth, /Retry-After/);
  assert.doesNotMatch(admin, /new Map\(\)/);
});
