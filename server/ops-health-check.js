const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const COS = require('cos-nodejs-sdk-v5');
const Database = require('better-sqlite3');
const { selectLatestBackup } = require('./src/lib/backup-encryption');

require('dotenv').config({ path: process.env.SIDU_ENV_PATH || '/opt/sidu/.env' });

const DB_PATH = process.env.SIDU_DB_PATH || '/opt/sidu/src/data/sidu.db';
const STATE_PATH = process.env.SIDU_OPS_STATE_PATH || '/opt/sidu/backups/ops-health-state.json';
const RESTORE_DRILL_STATE_PATH = process.env.SIDU_RESTORE_DRILL_STATE_PATH || '/opt/sidu/backups/restore-drill-state.json';
const HEALTH_URL = process.env.SIDU_HEALTH_URL || 'http://127.0.0.1:3001/api/health';
const CERT_SERVER_NAME = process.env.SIDU_CERT_SERVER_NAME || 'your-api.example';
const CERT_HOST = process.env.SIDU_CERT_HOST || CERT_SERVER_NAME;
const MAX_BACKUP_AGE_MS = (Number(process.env.SIDU_MAX_BACKUP_AGE_HOURS) || 30) * 60 * 60 * 1000;
const MIN_CERT_REMAINING_MS = (Number(process.env.SIDU_MIN_CERT_REMAINING_HOURS) || 36) * 60 * 60 * 1000;
const MAX_RESTORE_DRILL_AGE_MS = (Number(process.env.SIDU_MAX_RESTORE_DRILL_AGE_DAYS) || 35) * 24 * 60 * 60 * 1000;
const ALERT_WEBHOOK_URL = String(process.env.SIDU_ALERT_WEBHOOK_URL || '').trim();
const APP_ROOT = process.env.SIDU_APP_ROOT || '/opt/sidu';

function cosCall(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => error ? reject(error) : resolve(data));
  });
}

function httpHealthCheck() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const request = http.get(HEALTH_URL, { timeout: 5000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        let payload = null;
        try { payload = JSON.parse(body); } catch {}
        resolve({
          ok: response.statusCode === 200 && payload?.status === 'ok',
          statusCode: response.statusCode,
          latencyMs: Date.now() - startedAt,
        });
      });
    });
    request.on('timeout', () => request.destroy(new Error('health timeout')));
    request.on('error', reject);
  });
}

function certificateCheck() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: CERT_HOST,
      port: 443,
      servername: net.isIP(CERT_SERVER_NAME) ? undefined : CERT_SERVER_NAME,
      rejectUnauthorized: true,
    }, () => {
      const certificate = socket.getPeerCertificate();
      const expiresAt = new Date(certificate.valid_to);
      const remainingMs = expiresAt.getTime() - Date.now();
      const identityError = tls.checkServerIdentity(CERT_SERVER_NAME, certificate);
      socket.end();
      resolve({
        ok: socket.authorized && !identityError && Number.isFinite(remainingMs) && remainingMs >= MIN_CERT_REMAINING_MS,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError || identityError?.message || null,
        expiresAt: Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : null,
        remainingHours: Math.floor(remainingMs / 3600000),
      });
    });
    socket.setTimeout(5000, () => socket.destroy(new Error('certificate timeout')));
    socket.on('error', reject);
  });
}

function databaseCheck() {
  const database = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = database.pragma('quick_check', { simple: true });
    return { ok: quickCheck === 'ok', quickCheck, sizeBytes: fs.statSync(DB_PATH).size };
  } finally {
    database.close();
  }
}

function resourceChecks() {
  const stat = fs.statfsSync(path.parse(DB_PATH).root);
  const totalBytes = stat.blocks * stat.bsize;
  const freeBytes = stat.bavail * stat.bsize;
  const diskFreePercent = totalBytes ? freeBytes / totalBytes * 100 : 0;
  const memoryInfo = fs.readFileSync('/proc/meminfo', 'utf8');
  const availableKb = Number(memoryInfo.match(/^MemAvailable:\s+(\d+)/m)?.[1] || 0);
  const totalKb = Number(memoryInfo.match(/^MemTotal:\s+(\d+)/m)?.[1] || 0);
  const memoryAvailablePercent = totalKb ? availableKb / totalKb * 100 : 0;
  return {
    disk: { ok: diskFreePercent >= 15, freePercent: Math.round(diskFreePercent * 10) / 10, freeBytes },
    memory: {
      ok: memoryAvailablePercent >= 10,
      availablePercent: Math.round(memoryAvailablePercent * 10) / 10,
      loadAverage: os.loadavg().map(value => Math.round(value * 100) / 100),
    },
  };
}

function mediaCheck() {
  return require('./src/lib/media-runtime').mediaRuntimeCheck();
}

async function backupCheck() {
  const Bucket = process.env.COS_BACKUP_BUCKET || process.env.COS_BUCKET;
  const Region = process.env.COS_BACKUP_REGION || process.env.COS_REGION;
  const SecretId = process.env.COS_BACKUP_SECRET_ID || process.env.COS_SECRET_ID;
  const SecretKey = process.env.COS_BACKUP_SECRET_KEY || process.env.COS_SECRET_KEY;
  if (!Bucket || !Region || !SecretId || !SecretKey) throw new Error('COS backup configuration is incomplete');
  const cos = new COS({ SecretId, SecretKey });
  const list = await cosCall(cos, 'getBucket', { Bucket, Region, Prefix: 'backups/sidu-', MaxKeys: 1000 });
  const latest = selectLatestBackup(list.Contents);
  if (!latest) return { ok: false, error: 'No database backup exists in COS' };
  const modifiedAt = new Date(latest.LastModified);
  const ageMs = Date.now() - modifiedAt.getTime();
  return {
    ok: Number.isFinite(ageMs) && ageMs <= MAX_BACKUP_AGE_MS,
    key: latest.Key,
    modifiedAt: modifiedAt.toISOString(),
    ageHours: Math.round(ageMs / 360000) / 10,
    sizeBytes: Number(latest.Size) || 0,
  };
}

async function safeCheck(task) {
  try { return await task(); }
  catch (error) { return { ok: false, error: String(error?.message || error).slice(0, 300) }; }
}

function summarizeChecks(checks) {
  const issues = Object.entries(checks)
    .filter(([, result]) => !result?.ok)
    .map(([name, result]) => `${name}: ${result?.error || 'threshold exceeded'}`);
  return { status: issues.length ? 'unhealthy' : 'healthy', issues };
}

function readPreviousState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return null; }
}

function permissionCheck({
  appRoot = APP_ROOT,
  criticalCodePaths = [
    path.join(APP_ROOT, 'src', 'index.js'),
    path.join(APP_ROOT, 'src', 'db', 'migrations.js'),
    path.join(APP_ROOT, 'package.json'),
  ],
  mutablePaths = [
    path.dirname(DB_PATH),
    path.join(APP_ROOT, 'backups'),
    path.join(APP_ROOT, '.cache'),
    path.join(APP_ROOT, 'tmp'),
    path.join(APP_ROOT, 'uploads'),
  ],
  expectedOwnerUid = 0,
  otaAssetDirectory = path.join(appRoot, '.cache', 'ota-assets'),
  nginxGroupGid = null,
} = {}) {
  const protectedPaths = [appRoot, ...criticalCodePaths];
  const writableByGroupOrOthers = protectedPaths.filter(target => (fs.statSync(target).mode & 0o022) !== 0);
  const nonRootOwnedCode = criticalCodePaths.filter(target => fs.statSync(target).uid !== expectedOwnerUid);
  const serviceUnwritable = mutablePaths.filter((target) => {
    try {
      fs.accessSync(target, fs.constants.W_OK);
      return false;
    } catch {
      return true;
    }
  });
  let otaAssetDirectoryMode = null;
  let otaUnreadableFiles = [];
  let otaAssetGroupMismatch = false;
  if (fs.existsSync(otaAssetDirectory)) {
    const directoryStats = fs.statSync(otaAssetDirectory);
    otaAssetDirectoryMode = directoryStats.mode & 0o7777;
    otaAssetGroupMismatch = Number.isInteger(nginxGroupGid) && directoryStats.gid !== nginxGroupGid;
    otaUnreadableFiles = fs.readdirSync(otaAssetDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.join(otaAssetDirectory, entry.name))
      .filter((target) => {
        const stats = fs.statSync(target);
        const readableByNginxGroup = (stats.mode & 0o040) !== 0;
        const groupMatches = !Number.isInteger(nginxGroupGid) || stats.gid === nginxGroupGid;
        return !readableByNginxGroup || !groupMatches;
      });
  }
  const otaCacheUnsafe = otaAssetDirectoryMode != null
    && (((otaAssetDirectoryMode & 0o050) !== 0o050) || otaAssetGroupMismatch || otaUnreadableFiles.length > 0);
  const ok = writableByGroupOrOthers.length === 0
    && nonRootOwnedCode.length === 0
    && serviceUnwritable.length === 0
    && !otaCacheUnsafe;
  return {
    ok,
    writableByGroupOrOthers,
    nonRootOwnedCode,
    serviceUnwritable,
    otaAssetDirectory,
    otaAssetDirectoryMode,
    otaAssetGroupMismatch,
    otaUnreadableFiles,
    error: ok ? null : 'production code or writable data permissions are unsafe',
  };
}

function restoreDrillCheck() {
  const state = JSON.parse(fs.readFileSync(RESTORE_DRILL_STATE_PATH, 'utf8'));
  const checkedAt = new Date(state.checkedAt);
  const ageMs = Date.now() - checkedAt.getTime();
  return {
    ok: state.status === 'healthy' && Number.isFinite(ageMs) && ageMs <= MAX_RESTORE_DRILL_AGE_MS,
    status: state.status,
    checkedAt: Number.isFinite(checkedAt.getTime()) ? checkedAt.toISOString() : null,
    ageDays: Number.isFinite(ageMs) ? Math.round(ageMs / 8640000) / 10 : null,
    backupKey: state.backupKey || null,
    error: state.error || null,
  };
}

async function notifyExternal(title, content) {
  if (!ALERT_WEBHOOK_URL) return;
  let endpoint;
  try { endpoint = new URL(ALERT_WEBHOOK_URL); } catch { throw new Error('SIDU_ALERT_WEBHOOK_URL is invalid'); }
  if (endpoint.protocol !== 'https:') throw new Error('SIDU_ALERT_WEBHOOK_URL must use HTTPS');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, source: 'sidu-ops', time: new Date().toISOString() }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`alert webhook returned ${response.status}`);
}

async function notifyIncident(title, content) {
  try {
    await notifyExternal(title, content);
  } catch (error) {
    console.error(`[ops-alert] webhook failed: ${String(error?.message || error).slice(0, 300)}`);
  }
}

async function run() {
  const resources = await safeCheck(async () => resourceChecks());
  const checks = {
    api: await safeCheck(httpHealthCheck),
    database: await safeCheck(async () => databaseCheck()),
    backup: await safeCheck(backupCheck),
    restoreDrill: await safeCheck(async () => restoreDrillCheck()),
    permissions: await safeCheck(async () => permissionCheck({ nginxGroupGid: 33 })),
    certificate: await safeCheck(certificateCheck),
    media: await safeCheck(async () => mediaCheck()),
    disk: resources.disk || resources,
    memory: resources.memory || resources,
  };
  const summary = summarizeChecks(checks);
  const state = { checkedAt: new Date().toISOString(), ...summary, checks };
  const previous = readPreviousState();

  if (state.status === 'unhealthy' && previous?.status !== 'unhealthy') {
    await notifyIncident('系统运维告警', `服务器健康检查发现异常：${state.issues.join('；')}`);
  } else if (state.status === 'healthy' && previous?.status === 'unhealthy') {
    await notifyIncident('系统运维恢复', '服务器健康检查已全部恢复正常。');
  }

  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(state));
  if (state.status !== 'healthy') process.exitCode = 1;
  return state;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: 'unhealthy', error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { run, summarizeChecks, permissionCheck };
