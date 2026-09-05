const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authSource = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/contexts/auth.tsx'),
  'utf8',
);
const clientSource = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/api/client.ts'),
  'utf8',
);
const loginSource = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/app/login.tsx'),
  'utf8',
);

test('mobile login persists its secure session before leaving the login screen', () => {
  assert.match(authSource, /const login = useCallback\(async/);
  assert.match(authSource, /await Promise\.all\(\[\s*SecureStore\.setItemAsync\(TOKEN_KEY/);
  assert.ok(authSource.indexOf('await Promise.all([') < authSource.indexOf('setToken(t);'));
  assert.match(loginSource, /await authLogin\(result\.token/);
});

test('corrupt or partial secure sessions are cleared atomically on startup', () => {
  assert.match(authSource, /const parsedUser = JSON\.parse\(savedUser\)/);
  assert.match(authSource, /else if \(savedToken \|\| savedUser\)/);
  assert.match(authSource, /SecureStore\.deleteItemAsync\(TOKEN_KEY\)/);
  assert.match(authSource, /SecureStore\.deleteItemAsync\(USER_KEY\)/);
});

test('server-forced relogin invalidates both the API token and auth context', () => {
  assert.match(clientSource, /if \(res\.status === 401 && data\.relogin/);
  assert.match(clientSource, /_token === requestToken/);
  assert.match(clientSource, /authInvalidationHandler\?\.\(\)/);
  assert.match(authSource, /setAuthInvalidationHandler\(\(\) => \{ void clearSession\(\); \}\)/);
});

test('stale account refreshes cannot overwrite or sign out a newer session', () => {
  assert.match(authSource, /const requestToken = getApiToken\(\)/);
  assert.match(authSource, /if \(getApiToken\(\) !== requestToken \|\| refreshGeneration !== refreshGenerationRef\.current\) return/);
  assert.match(authSource, /getApiToken\(\) === requestToken/);
  assert.match(authSource, /storageQueueRef\.current\.then\(operation, operation\)/);
  assert.match(authSource, /const refreshGeneration = \+\+refreshGenerationRef\.current/);
  assert.match(authSource, /refreshGeneration !== refreshGenerationRef\.current/);
});

test('request timeout remains active while the response body is being read', () => {
  assert.ok(clientSource.indexOf('body = await res.text();') < clientSource.indexOf('clearTimeout(timeout);'));
});
