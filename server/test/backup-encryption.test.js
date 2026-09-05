const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  decodeBackupObject,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  selectLatestBackup,
} = require('../src/lib/backup-encryption');

test('database backups use authenticated AES-256-GCM encryption', () => {
  const key = crypto.randomBytes(32);
  const plaintext = Buffer.from('SQLite format 3\0private user data');
  const encrypted = encryptBackup(plaintext, key);
  assert.equal(isEncryptedBackup(encrypted), true);
  assert.equal(encrypted.includes(plaintext), false);
  assert.deepEqual(decryptBackup(encrypted, key), plaintext);
});

test('tampered encrypted backups fail closed', () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptBackup(Buffer.from('sensitive backup'), key);
  encrypted[encrypted.length - 1] ^= 0xff;
  assert.throws(() => decryptBackup(encrypted, key), /authentication failed/);
});

test('backup readers prefer the newest encrypted or legacy snapshot', () => {
  const latest = selectLatestBackup([
    { Key: 'backups/sidu-old.db', LastModified: '2026-09-01T00:00:00Z' },
    { Key: 'backups/readme.txt', LastModified: '2026-09-03T00:00:00Z' },
    { Key: 'backups/sidu-new.db.enc', LastModified: '2026-09-02T00:00:00Z' },
  ]);
  assert.equal(latest.Key, 'backups/sidu-new.db.enc');
});

test('legacy plaintext backups remain readable during migration', () => {
  const legacy = Buffer.from('SQLite format 3\0legacy');
  assert.deepEqual(decodeBackupObject({ Key: 'backups/sidu-old.db', Body: legacy }), legacy);
});
