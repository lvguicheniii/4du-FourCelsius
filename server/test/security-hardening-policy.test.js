const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('administrator database browsing blocks secrets and redacts sensitive columns', () => {
  const source = read('src/routes/admin/append2.js');
  assert.match(source, /blockedTables = new Set\(\['sessions', 'web_sessions', 'device_push_tokens'/);
  assert.match(source, /password_hash\|security_answer\|token\|token_hash/);
  assert.match(source, /'\[已隐藏\]'/);
});

test('registration and recommendation telemetry use persistent abuse controls', () => {
  const auth = read('src/routes/auth.js');
  const posts = read('src/routes/posts.js');
  assert.match(auth, /persistentRateLimit\(\{[\s\S]*scope: 'auth\.register'[\s\S]*limit: 5/);
  assert.match(auth, /password\.length < 10/);
  assert.match(posts, /if \(!req\.userId\) return res\.status\(202\)\.json\(\{ accepted: 0 \}\)/);
  assert.match(posts, /events\.slice\(0, 20\)/);
});

test('account deletion anonymizes identity and revokes every session channel', () => {
  const source = read('src/routes/auth.js');
  assert.match(source, /username=\?, password_hash=\?, nickname='已注销用户'/);
  assert.match(source, /DELETE FROM sessions WHERE user_id=\?/);
  assert.match(source, /DELETE FROM web_sessions WHERE user_id=\?/);
  assert.match(source, /DELETE FROM device_push_tokens WHERE user_id=\?/);
  assert.match(source, /register_ip='', last_login_ip=''/);
});

test('public health response does not expose internal worker configuration', () => {
  const source = read('src/index.js');
  const health = source.slice(source.indexOf("app.get('/api/health'"), source.indexOf("app.use('/api',"));
  assert.doesNotMatch(health, /credentialsConfigured|bizTypesConfigured|lastError|region/);
});

test('production uploads are metadata-stripped, quota-bound and fail closed', () => {
  const source = read('src/routes/upload.js');
  assert.match(source, /reserveDailyUpload\(uid, req\.file\.size\)/);
  assert.match(source, /await normalizeImage\(req\.file\)/);
  assert.match(source, /MEDIA_STORAGE_UNAVAILABLE/);
  assert.doesNotMatch(source, /uploadToCOS\([^\n]+\)\.catch\(\(\) => persistLocally/);
});

test('database backups are authenticated and encrypted before cloud upload', () => {
  const backup = read('backup.js');
  const verifier = read('verify-backup.js');
  const restore = read('restore-drill.js');
  const encryption = read('src/lib/backup-encryption.js');
  assert.match(encryption, /aes-256-gcm/);
  assert.match(encryption, /setAuthTag/);
  assert.match(encryption, /Encrypted backup authentication failed/);
  assert.match(backup, /encryptBackup/);
  assert.match(backup, /`backups\/\$\{filename\}\.enc`/);
  assert.match(verifier, /decodeBackupObject/);
  assert.match(restore, /decodeBackupObject/);
});

test('new websocket clients keep bearer tokens out of request URLs', () => {
  const server = read('src/ws.js');
  const appClient = fs.readFileSync(path.resolve(__dirname, '../../community-app/src/contexts/ws.tsx'), 'utf8');
  const webClient = fs.readFileSync(path.resolve(__dirname, '../../community-web/src/session.tsx'), 'utf8');
  const nginx = read('nginx-ip.conf');
  assert.match(server, /sec-websocket-protocol/);
  assert.match(appClient, /new WebSocket\(wsUrl, \['sidu-auth-v1', token\]\)/);
  assert.match(webClient, /\['sidu-auth-v1', sessionToken\]/);
  assert.doesNotMatch(appClient, /\/ws\?token=/);
  assert.doesNotMatch(webClient, /\/ws\?token=/);
  assert.match(nginx, /location \/ws \{[\s\S]*access_log off;/);
});
