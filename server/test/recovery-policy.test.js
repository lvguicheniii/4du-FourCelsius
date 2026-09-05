const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('database backups are verified after upload and can be restore-tested', () => {
  const backup = fs.readFileSync(path.join(root, 'backup.js'), 'utf8');
  const verify = fs.readFileSync(path.join(root, 'verify-backup.js'), 'utf8');

  assert.match(backup, /headObject/);
  assert.match(backup, /Uploaded backup size mismatch/);
  assert.match(backup, /COS_BACKUP_BUCKET \|\| process\.env\.COS_BUCKET/);
  assert.doesNotMatch(backup, /deleteObject/);
  assert.match(verify, /getObject/);
  assert.match(verify, /integrity_check/);
  assert.match(verify, /COS_BACKUP_SECRET_ID \|\| process\.env\.COS_SECRET_ID/);
  assert.match(verify, /fileMustExist: true/);
  assert.match(verify, /removeSqliteArtifacts\(verifyPath\)/);
  assert.match(verify, /\['', '-shm', '-wal'\]/);
});

test('production cron verifies the latest off-server backup every day', () => {
  const cron = fs.readFileSync(path.join(root, 'ops', 'sidu-ops.cron'), 'utf8');
  assert.match(cron, /20 3 \* \* \* sidu .*verify-backup\.js/);
  assert.match(cron, /timeout 300s/);
});

test('operations monitoring validates certificate identity and alerts only through the private webhook', () => {
  const health = fs.readFileSync(path.join(root, 'ops-health-check.js'), 'utf8');
  assert.match(health, /tls\.checkServerIdentity\(CERT_SERVER_NAME, certificate\)/);
  assert.match(health, /const CERT_HOST = process\.env\.SIDU_CERT_HOST \|\| CERT_SERVER_NAME/);
  assert.match(health, /rejectUnauthorized: true/);
  assert.match(health, /socket\.authorized && !identityError/);
  assert.match(health, /SIDU_ALERT_WEBHOOK_URL/);
  assert.match(health, /COS_BACKUP_BUCKET \|\| process\.env\.COS_BUCKET/);
  assert.match(health, /endpoint\.protocol !== 'https:'/);
  assert.doesNotMatch(health, /INSERT INTO notifications/);
  assert.doesNotMatch(health, /notifyAdmins/);
  assert.match(health, /webhook failed/);
});
