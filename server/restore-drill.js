const fs = require('node:fs');
const path = require('node:path');
const COS = require('cos-nodejs-sdk-v5');
const Database = require('better-sqlite3');
const {
  backupEncryptionKey,
  decodeBackupObject,
  selectLatestBackup,
} = require('./src/lib/backup-encryption');

require('dotenv').config({ path: process.env.SIDU_ENV_PATH || '/opt/sidu/.env' });

const BACKUP_DIR = process.env.SIDU_BACKUP_DIR || '/opt/sidu/backups';
const STATE_PATH = process.env.SIDU_RESTORE_DRILL_STATE_PATH || path.join(BACKUP_DIR, 'restore-drill-state.json');
const REQUIRED_TABLES = ['users', 'posts', 'comments', 'messages', 'notifications', 'schema_migrations'];

function cosCall(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => error ? reject(error) : resolve(data));
  });
}

function removeSqliteArtifacts(databasePath) {
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

function validateSnapshot(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);

    const existingTables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const missingTables = REQUIRED_TABLES.filter(table => !existingTables.has(table));
    if (missingTables.length) throw new Error(`Required tables missing: ${missingTables.join(', ')}`);

    const foreignKeyIssues = database.pragma('foreign_key_check');
    if (foreignKeyIssues.length) throw new Error(`Foreign key check failed: ${foreignKeyIssues.length} orphaned rows`);

    return {
      integrity,
      migrations: database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      users: database.prepare('SELECT COUNT(*) AS count FROM users').get().count,
      posts: database.prepare('SELECT COUNT(*) AS count FROM posts').get().count,
      comments: database.prepare('SELECT COUNT(*) AS count FROM comments').get().count,
    };
  } finally {
    database.close();
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const temporaryPath = `${STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, STATE_PATH);
}

async function run() {
  const Bucket = process.env.COS_BACKUP_BUCKET || process.env.COS_BUCKET;
  const Region = process.env.COS_BACKUP_REGION || process.env.COS_REGION;
  const SecretId = process.env.COS_BACKUP_SECRET_ID || process.env.COS_SECRET_ID;
  const SecretKey = process.env.COS_BACKUP_SECRET_KEY || process.env.COS_SECRET_KEY;
  if (!Bucket || !Region || !SecretId || !SecretKey) throw new Error('COS backup configuration is incomplete');
  const encryptionKey = backupEncryptionKey({ required: process.env.NODE_ENV === 'production' });

  const cos = new COS({ SecretId, SecretKey });
  const list = await cosCall(cos, 'getBucket', { Bucket, Region, Prefix: 'backups/sidu-', MaxKeys: 1000 });
  const latest = selectLatestBackup(list.Contents);
  if (!latest) throw new Error('No database backup exists in COS');

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const drillPath = path.join(BACKUP_DIR, `restore-drill-${process.pid}-${Date.now()}.db.tmp`);
  try {
    const downloaded = await cosCall(cos, 'getObject', { Bucket, Region, Key: latest.Key });
    const plaintext = decodeBackupObject({ Key: latest.Key, Body: downloaded.Body }, encryptionKey);
    fs.writeFileSync(drillPath, plaintext, { flag: 'wx', mode: 0o600 });
    const checks = validateSnapshot(drillPath);
    const state = {
      checkedAt: new Date().toISOString(),
      status: 'healthy',
      backupKey: latest.Key,
      sizeBytes: plaintext.length,
      checks,
    };
    writeState(state);
    console.log(`[restore-drill] ok key=${latest.Key} bytes=${plaintext.length} migrations=${checks.migrations} users=${checks.users}`);
    return state;
  } finally {
    removeSqliteArtifacts(drillPath);
  }
}

if (require.main === module) {
  run().catch((error) => {
    writeState({ checkedAt: new Date().toISOString(), status: 'unhealthy', error: String(error.message).slice(0, 300) });
    console.error('[restore-drill] failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { run, validateSnapshot, removeSqliteArtifacts };
