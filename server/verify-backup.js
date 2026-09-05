const fs = require('fs');
const path = require('path');
const COS = require('cos-nodejs-sdk-v5');
const Database = require('better-sqlite3');
const {
  backupEncryptionKey,
  decodeBackupObject,
  selectLatestBackup,
} = require('./src/lib/backup-encryption');

require('dotenv').config({ path: process.env.SIDU_ENV_PATH || '/opt/sidu/.env' });

const BACKUP_DIR = process.env.SIDU_BACKUP_DIR || '/opt/sidu/backups';
const BUCKET = process.env.COS_BACKUP_BUCKET || process.env.COS_BUCKET;
const REGION = process.env.COS_BACKUP_REGION || process.env.COS_REGION;
const SECRET_ID = process.env.COS_BACKUP_SECRET_ID || process.env.COS_SECRET_ID;
const SECRET_KEY = process.env.COS_BACKUP_SECRET_KEY || process.env.COS_SECRET_KEY;
const BACKUP_ENCRYPTION_KEY = backupEncryptionKey({ required: process.env.NODE_ENV === 'production' });

if (!BUCKET || !REGION || !SECRET_ID || !SECRET_KEY) {
  throw new Error('COS backup configuration is incomplete');
}

const cos = new COS({
  SecretId: SECRET_ID,
  SecretKey: SECRET_KEY,
});

function cosCall(method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => error ? reject(error) : resolve(data));
  });
}

function removeSqliteArtifacts(databasePath) {
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const list = await cosCall('getBucket', {
    Bucket: BUCKET,
    Region: REGION,
    Prefix: 'backups/sidu-',
    MaxKeys: 1000,
  });
  const latest = selectLatestBackup(list.Contents);
  if (!latest) throw new Error('No database backup exists in COS');

  const verifyPath = path.join(BACKUP_DIR, `verify-${process.pid}-${Date.now()}.db.tmp`);
  try {
    const downloaded = await cosCall('getObject', {
      Bucket: BUCKET,
      Region: REGION,
      Key: latest.Key,
    });
    const plaintext = decodeBackupObject({ Key: latest.Key, Body: downloaded.Body }, BACKUP_ENCRYPTION_KEY);
    fs.writeFileSync(verifyPath, plaintext, { flag: 'wx', mode: 0o600 });

    const snapshot = new Database(verifyPath, { readonly: true, fileMustExist: true });
    try {
      const integrity = snapshot.pragma('integrity_check')[0]?.integrity_check;
      if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
      const migrations = snapshot.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
      const users = snapshot.prepare('SELECT COUNT(*) AS count FROM users').get().count;
      console.log(`[backup-verify] ok key=${latest.Key} bytes=${plaintext.length} migrations=${migrations} users=${users}`);
    } finally {
      snapshot.close();
    }
  } finally {
    removeSqliteArtifacts(verifyPath);
  }
}

main().catch((error) => {
  console.error('[backup-verify] failed:', error.message);
  process.exitCode = 1;
});
