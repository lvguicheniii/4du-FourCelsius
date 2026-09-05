const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeChecks, permissionCheck } = require('../ops-health-check');
const { validateSnapshot, removeSqliteArtifacts } = require('../restore-drill');
const { recordRequestMetric, getRuntimeMetrics } = require('../src/lib/runtime-metrics');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('operations health is unhealthy when any required check fails', () => {
  const result = summarizeChecks({
    api: { ok: true },
    database: { ok: true },
    backup: { ok: false, error: 'backup too old' },
  });
  assert.equal(result.status, 'unhealthy');
  assert.deepEqual(result.issues, ['backup: backup too old']);
});

test('runtime metrics retain request latency and status counters', () => {
  recordRequestMetric(25, 200);
  recordRequestMetric(1200, 503);
  const metrics = getRuntimeMetrics();
  assert.ok(metrics.requests.total >= 2);
  assert.ok(metrics.requests.slow >= 1);
  assert.ok(metrics.requests.status.serverError >= 1);
  assert.ok(metrics.requests.p95Ms >= 25);
});

test('restore drill validates an isolated usable snapshot', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sidu-restore-drill-'));
  const databasePath = path.join(directory, 'snapshot.db');
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE posts (id TEXT PRIMARY KEY);
    CREATE TABLE comments (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
    CREATE TABLE notifications (id TEXT PRIMARY KEY);
    CREATE TABLE schema_migrations (id TEXT PRIMARY KEY);
    INSERT INTO schema_migrations(id) VALUES ('test-migration');
  `);
  database.close();

  try {
    const checks = validateSnapshot(databasePath);
    assert.equal(checks.integrity, 'ok');
    assert.equal(checks.migrations, 1);
  } finally {
    removeSqliteArtifacts(databasePath);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('operations health rejects writable production code while allowing service data writes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sidu-permissions-'));
  const codePath = path.join(directory, 'index.js');
  const mutablePath = path.join(directory, 'data');
  fs.writeFileSync(codePath, 'module.exports = {};\n', { mode: 0o600 });
  fs.mkdirSync(mutablePath, { mode: 0o700 });

  try {
    const secure = permissionCheck({
      appRoot: directory,
      criticalCodePaths: [codePath],
      mutablePaths: [mutablePath],
      expectedOwnerUid: typeof process.getuid === 'function' ? process.getuid() : 0,
    });
    // Windows ACLs do not expose the same POSIX mode semantics as production
    // Linux. The Linux assertion remains strict; Windows still exercises the
    // result shape without turning a platform limitation into a false failure.
    if (process.platform !== 'win32') assert.equal(secure.ok, true);

    fs.chmodSync(codePath, 0o622);
    const unsafe = permissionCheck({
      appRoot: directory,
      criticalCodePaths: [codePath],
      mutablePaths: [mutablePath],
      expectedOwnerUid: typeof process.getuid === 'function' ? process.getuid() : 0,
    });
    if (process.platform !== 'win32') {
      assert.equal(unsafe.ok, false);
      assert.deepEqual(unsafe.writableByGroupOrOthers, [codePath]);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('operations health rejects OTA cache files that Nginx cannot read', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sidu-ota-permissions-'));
  const codePath = path.join(directory, 'index.js');
  const mutablePath = path.join(directory, 'data');
  const otaAssetDirectory = path.join(directory, '.cache', 'ota-assets');
  const assetPath = path.join(otaAssetDirectory, 'asset-key');
  fs.writeFileSync(codePath, 'module.exports = {};\n', { mode: 0o600 });
  fs.mkdirSync(mutablePath, { mode: 0o700 });
  fs.mkdirSync(otaAssetDirectory, { recursive: true, mode: 0o750 });
  fs.writeFileSync(assetPath, 'asset', { mode: 0o640 });

  try {
    const gid = fs.statSync(otaAssetDirectory).gid;
    const secure = permissionCheck({
      appRoot: directory,
      criticalCodePaths: [codePath],
      mutablePaths: [mutablePath],
      expectedOwnerUid: typeof process.getuid === 'function' ? process.getuid() : 0,
      otaAssetDirectory,
      nginxGroupGid: gid,
    });
    assert.equal(secure.otaAssetGroupMismatch, false);
    assert.deepEqual(secure.otaUnreadableFiles, []);

    const unsafe = permissionCheck({
      appRoot: directory,
      criticalCodePaths: [codePath],
      mutablePaths: [mutablePath],
      expectedOwnerUid: typeof process.getuid === 'function' ? process.getuid() : 0,
      otaAssetDirectory,
      // Windows does not expose POSIX chmod semantics reliably. A mismatched
      // Nginx group exercises the same production rejection path everywhere.
      nginxGroupGid: gid + 1,
    });
    assert.equal(unsafe.ok, false);
    assert.equal(unsafe.otaAssetGroupMismatch, true);
    assert.deepEqual(unsafe.otaUnreadableFiles, [assetPath]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
