const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('administrator password changes require the current password and revoke old tokens', () => {
  const api = fs.readFileSync(path.join(root, 'src', 'routes', 'admin', 'api.js'), 'utf8');
  const append2 = fs.readFileSync(path.join(root, 'src', 'routes', 'admin', 'append2.js'), 'utf8');
  const adminPage = fs.readFileSync(path.join(root, 'src', 'public', 'admin', 'index.html'), 'utf8');

  assert.match(api, /req\.body\?\.old_password/);
  assert.match(api, /req\.body\?\.new_password/);
  assert.match(api, /new_password\.length < 12/);
  assert.match(api, /token_version=token_version\+1/);
  assert.match(api, /payload\.tokenVersion/);
  assert.doesNotMatch(api, /change-password-direct/);
  assert.doesNotMatch(append2, /router\.put\('\/change-password'/);
  assert.doesNotMatch(append2, /router\.put\('\/change-username'/);
  assert.doesNotMatch(adminPage, /change-password-direct/);
});
