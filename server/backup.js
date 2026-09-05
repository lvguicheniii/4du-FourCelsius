const fs = require('fs');
const path = require('path');
const COS = require('cos-nodejs-sdk-v5');
const Database = require('better-sqlite3');
const { backupEncryptionKey, encryptBackup } = require('./src/lib/backup-encryption');

require('dotenv').config({ path: '/opt/sidu/.env' });

const DB_PATH = '/opt/sidu/src/data/sidu.db';
const BACKUP_DIR = '/opt/sidu/backups';
const BUCKET = process.env.COS_BACKUP_BUCKET || process.env.COS_BUCKET;
const REGION = process.env.COS_BACKUP_REGION || process.env.COS_REGION;
const SECRET_ID = process.env.COS_BACKUP_SECRET_ID || process.env.COS_SECRET_ID;
const SECRET_KEY = process.env.COS_BACKUP_SECRET_KEY || process.env.COS_SECRET_KEY;
const BACKUP_ENCRYPTION_KEY = backupEncryptionKey({ required: true });

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

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const filename = `sidu-${stamp}.db`;
  const snapshotPath = path.join(BACKUP_DIR, `${filename}.tmp`);
  const encryptedPath = path.join(BACKUP_DIR, `${filename}.enc.tmp`);
  const key = `backups/${filename}.enc`;

  const source = new Database(DB_PATH, { readonly: true });
  try {
    await source.backup(snapshotPath);
  } finally {
    source.close();
  }

  try {
    const snapshot = new Database(snapshotPath, { readonly: true });
    try {
      const result = snapshot.pragma('integrity_check')[0]?.integrity_check;
      if (result !== 'ok') throw new Error(`SQLite integrity check failed: ${result}`);
    } finally {
      snapshot.close();
    }

    const encrypted = encryptBackup(fs.readFileSync(snapshotPath), BACKUP_ENCRYPTION_KEY);
    fs.writeFileSync(encryptedPath, encrypted, { flag: 'wx', mode: 0o600 });
    const size = fs.statSync(encryptedPath).size;
    console.log(`[backup] uploading ${key} (${size} bytes)`);
    await cosCall('putObject', {
      Bucket: BUCKET,
      Region: REGION,
      Key: key,
      Body: fs.createReadStream(encryptedPath),
      ContentLength: size,
      ContentType: 'application/octet-stream',
    });
    const uploaded = await cosCall('headObject', {
      Bucket: BUCKET,
      Region: REGION,
      Key: key,
    });
    const uploadedSize = Number(uploaded.headers?.['content-length']);
    if (!Number.isFinite(uploadedSize) || uploadedSize !== size) {
      throw new Error(`Uploaded backup size mismatch: local=${size}, remote=${uploadedSize || 'unknown'}`);
    }
    console.log(`[backup] uploaded ${key}`);

    // Retention is enforced by the backup bucket lifecycle policy. The backup
    // credential intentionally has no delete permission.
  } finally {
    fs.rmSync(snapshotPath, { force: true });
    fs.rmSync(encryptedPath, { force: true });
  }
}

main().catch((error) => {
  console.error('[backup] failed:', error.message);
  process.exitCode = 1;
});
