const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const createAppUpdateRouter = require('../src/routes/app-updates');
const { validAssetKey, isAndroidOtaIncludedInNativeBuild } = createAppUpdateRouter;

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_releases (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      version_code INTEGER NOT NULL,
      version_name TEXT NOT NULL,
      runtime_version TEXT NOT NULL DEFAULT '',
      apk_url TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      md5 TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      release_notes TEXT NOT NULL DEFAULT '',
      mandatory INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      published_at TEXT
    );
    CREATE TABLE app_update_logs (
      id TEXT PRIMARY KEY,
      stage TEXT NOT NULL DEFAULT 'production',
      platform TEXT NOT NULL DEFAULT 'android',
      version_name TEXT NOT NULL UNIQUE,
      update_id TEXT UNIQUE,
      runtime_version TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      release_notes TEXT NOT NULL DEFAULT '',
      release_date TEXT NOT NULL,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function latestHandler(db) {
  const router = createAppUpdateRouter(db);
  return router.stack.find((layer) => layer.route?.path === '/android/latest').route.stack[0].handle;
}

function nativeLogHandler(db) {
  const router = createAppUpdateRouter(db);
  return router.stack.find((layer) => layer.route?.path === '/native/:platform/:versionName').route.stack[0].handle;
}

async function invoke(handler, versionCode) {
  let payload;
  const headers = {};
  await handler(
    { query: { versionCode: String(versionCode) } },
    {
      set(name, value) { headers[name] = value; },
      json(value) { payload = value; return this; },
    },
  );
  return { payload, headers };
}

test('Android update manifest exposes native and OTA availability in one fast response', async () => {
  const db = createDb();
  const handler = latestHandler(db);
  assert.deepEqual((await invoke(handler, 1)).payload, {
    available: false,
    currentVersionCode: 1,
    ota: { available: null },
  });

  let runtimeWithoutRelease;
  await handler(
    { query: { versionCode: '1', runtimeVersion: '1.1-key2' } },
    { set() {}, json(value) { runtimeWithoutRelease = value; return this; } },
  );
  assert.deepEqual(runtimeWithoutRelease.ota, { available: false });

  db.prepare(`
    INSERT INTO app_update_logs
      (id,platform,version_name,update_id,runtime_version,release_date)
    VALUES ('log-30','android','DEV-030','update-30','1.0.2','2026-08-13')
  `).run();

  db.prepare(`
    INSERT INTO app_releases (
      id,platform,version_code,version_name,runtime_version,apk_url,file_size,md5,sha256,
      release_notes,mandatory,is_active,published_at
    ) VALUES ('release-2','android',2,'1.0.1','1.0.1','https://download.example/sidu.apk',123,
      '0123456789abcdef0123456789abcdef',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'Updater foundation',0,1,'2026-08-11 18:00:00')
  `).run();

  const available = await invoke(handler, 1);
  assert.equal(available.headers['Cache-Control'], 'no-store');
  assert.equal(available.payload.available, true);
  assert.equal(available.payload.release.versionCode, 2);
  assert.equal(available.payload.release.apkUrl, 'https://download.example/sidu.apk');

  const otaRequest = {
    query: { versionCode: '2', runtimeVersion: '1.0.2', updateId: 'update-29' },
  };
  let otaPayload;
  await handler(otaRequest, {
    set() {},
    json(value) { otaPayload = value; return this; },
  });
  assert.equal(otaPayload.ota.available, true);
  assert.equal(otaPayload.ota.latestUpdateId, 'update-30');

  otaRequest.query.updateId = 'update-30';
  await handler(otaRequest, {
    set() {},
    json(value) { otaPayload = value; return this; },
  });
  assert.equal(otaPayload.ota.available, false);

  const current = await invoke(handler, 2);
  assert.equal(current.payload.available, false);
  assert.equal(current.payload.release, null);
  db.close();
});

test('native build 13 and newer treat DEV-070 as embedded', () => {
  const dev070 = '00000000-0000-4000-8000-000000000013';
  assert.equal(isAndroidOtaIncludedInNativeBuild(12, dev070), false);
  assert.equal(isAndroidOtaIncludedInNativeBuild(13, dev070), true);
  assert.equal(isAndroidOtaIncludedInNativeBuild(14, dev070), true);
  assert.equal(isAndroidOtaIncludedInNativeBuild(13, 'different-update'), false);
});

test('native release log is available only for its production platform and version', async () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO app_update_logs
      (id,platform,version_name,update_id,runtime_version,release_date)
    VALUES ('native-1-1','android','1.1',NULL,'1.1','2026-09-05')
  `).run();
  const handler = nativeLogHandler(db);

  async function invokeNative(platform, versionName) {
    const result = { statusCode: 200, headers: {} };
    await handler(
      { params: { platform, versionName } },
      {
        set(name, value) { result.headers[name] = value; return this; },
        status(value) { result.statusCode = value; return this; },
        json(value) { result.payload = value; return this; },
      },
    );
    return result;
  }

  assert.equal((await invokeNative('android', '1.1')).payload.log.versionName, '1.1');
  assert.equal((await invokeNative('ios', '1.1')).payload.log, null);
  assert.equal((await invokeNative('android', '1.0.11')).payload.log, null);
  assert.equal((await invokeNative('windows', '1.1')).statusCode, 400);
  db.close();
});

test('OTA manifest fails closed without an exact self-hosted runtime', async () => {
  let upstreamCalls = 0;
  const router = createAppUpdateRouter(createDb(), {
    otaRootDirectory: path.join(__dirname, 'missing-ota-root'),
    fetch: async () => { upstreamCalls += 1; },
  });
  const handler = router.stack.find((layer) => layer.route?.path === '/ota').route.stack[0].handle;
  const result = { statusCode: 200 };
  await handler({
    get(name) {
      return {
        'Expo-Platform': 'android',
        'Expo-Runtime-Version': '1.0.8',
        'expo-channel-name': 'production',
      }[name];
    },
  }, {
    status(value) { result.statusCode = value; return this; },
    json(value) { result.payload = value; return this; },
  }, error => { throw error; });
  assert.equal(result.statusCode, 404);
  assert.equal(upstreamCalls, 0);
});

test('500 simultaneous first-party update checks avoid the Expo upstream', async () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO app_update_logs
      (id,platform,version_name,update_id,runtime_version,release_date)
    VALUES ('log-30','android','DEV-030','update-30','1.0.2','2026-08-13')
  `).run();
  let upstreamCalls = 0;
  const router = createAppUpdateRouter(db, {
    fetch: async () => {
      upstreamCalls += 1;
      return new Response('{}', { status: 200 });
    },
  });
  const handler = router.stack.find((layer) => layer.route?.path === '/android/latest').route.stack[0].handle;
  const requests = Array.from({ length: 500 }, () => new Promise((resolve, reject) => {
    handler(
      { query: { versionCode: '4', runtimeVersion: '1.0.2', updateId: 'update-30' } },
      {
        set() { return this; },
        json(value) { resolve(value); return this; },
      },
      reject,
    );
  }));
  const results = await Promise.all(requests);
  assert.equal(upstreamCalls, 0);
  results.forEach(result => assert.equal(result.ota.available, false));
  db.close();
});

test('self-hosted OTA assets require immutable SHA-256 keys', () => {
  assert.equal(validAssetKey('../etc/passwd'), false);
  assert.equal(validAssetKey('a'.repeat(63)), false);
  assert.equal(validAssetKey('a'.repeat(64)), true);
});

test('cached self-hosted OTA assets are public, immutable and handed to Nginx', async () => {
  const otaRootDirectory = fs.mkdtempSync(path.join(__dirname, 'sidu-ota-assets-'));
  const assetKey = 'a'.repeat(64);
  const assetsDirectory = path.join(otaRootDirectory, 'assets');
  fs.mkdirSync(assetsDirectory, { recursive: true });
  fs.writeFileSync(path.join(assetsDirectory, assetKey), Buffer.alloc(1024, 0x2a));
  const router = createAppUpdateRouter(createDb(), { otaRootDirectory, accelRedirect: true });
  const handler = router.stack.find((layer) => layer.route?.path === '/ota/assets/:key').route.stack[0].handle;

  function responseRecorder() {
    return {
      headers: {},
      statusCode: 200,
      ended: false,
      set(name, value) { this.headers[name] = value; return this; },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.payload = value; this.ended = true; return this; },
      end() { this.ended = true; return this; },
    };
  }

  const response = responseRecorder();
  await handler({ params: { key: assetKey } }, response, (error) => { throw error; });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(response.headers['X-Accel-Redirect'], `/_ota-self-hosted-assets/${assetKey}`);
  assert.equal(response.ended, true);
  fs.rmSync(otaRootDirectory, { recursive: true, force: true });
});
