const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sidu-upload-security-'));
process.env.SIDU_DB_PATH = path.join(testRoot, 'test.db');
const uploadRouter = require('../src/routes/upload');
const { normalizeImage, storeUserAsset } = uploadRouter.securityTestHooks;
const db = require('../src/db');
const { reserveDailyUpload } = require('../src/lib/upload-quota');
const { persistentRateLimit } = require('../src/middleware/persistent-rate-limit');

test.after(() => {
  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('ordinary images are decoded and re-encoded without EXIF metadata', async () => {
  const input = path.join(testRoot, 'private-location.jpg');
  await sharp({ create: { width: 24, height: 12, channels: 3, background: '#33A9DC' } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { ImageDescription: 'private-location-marker' } } })
    .toFile(input);
  assert.ok((await sharp(input).metadata()).exif);
  const file = { path: input, filename: path.basename(input), originalname: 'photo.jpg', mimetype: 'image/jpeg', size: fs.statSync(input).size };
  await normalizeImage(file);
  const metadata = await sharp(file.path).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(file.mimetype, 'image/jpeg');
  assert.equal(fs.existsSync(input), false);
  fs.rmSync(file.path, { force: true });
});

test('production user-media storage fails closed when private object storage is unavailable', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFallback = process.env.ALLOW_LOCAL_MEDIA_FALLBACK;
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_LOCAL_MEDIA_FALLBACK;
  const input = path.join(testRoot, 'asset.jpg');
  fs.writeFileSync(input, 'not uploaded');
  await assert.rejects(
    storeUserAsset(input, 'user-1', 'posts', 'asset.jpg', 'image/jpeg'),
    error => error?.statusCode === 503 && error?.code === 'MEDIA_STORAGE_UNAVAILABLE',
  );
  assert.equal(fs.existsSync(input), true);
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousFallback === undefined) delete process.env.ALLOW_LOCAL_MEDIA_FALLBACK;
  else process.env.ALLOW_LOCAL_MEDIA_FALLBACK = previousFallback;
});

test('daily upload quotas persist file and byte usage in SQLite', () => {
  db.prepare("INSERT INTO users(id,username,password_hash,nickname) VALUES ('quota-user','quota-user','disabled','quota-user')").run();
  assert.deepEqual(
    reserveDailyUpload('quota-user', 40, { usageDate: '2026-08-30', fileLimit: 2, byteLimit: 100 }),
    { usageDate: '2026-08-30', fileCount: 1, byteCount: 40, fileLimit: 2, byteLimit: 100 },
  );
  reserveDailyUpload('quota-user', 60, { usageDate: '2026-08-30', fileLimit: 2, byteLimit: 100 });
  assert.throws(
    () => reserveDailyUpload('quota-user', 1, { usageDate: '2026-08-30', fileLimit: 2, byteLimit: 100 }),
    error => error?.statusCode === 429 && error?.code === 'UPLOAD_DAILY_QUOTA_EXCEEDED',
  );
});

test('persistent rate limits survive middleware recreation', () => {
  const makeResponse = () => ({
    headers: {}, statusCode: 200,
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(body) { this.body = body; return this; },
  });
  const options = { scope: 'test.persistent', limit: 1, windowMs: 60_000, subject: () => 'same-client' };
  let proceeded = 0;
  persistentRateLimit(options)({}, makeResponse(), () => { proceeded += 1; });
  const response = makeResponse();
  persistentRateLimit(options)({}, response, () => { proceeded += 1; });
  assert.equal(proceeded, 1);
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.code, 'RATE_LIMITED');
});
