const test = require('node:test');
const assert = require('node:assert/strict');
const createAppUpdateRouter = require('../src/routes/app-updates');
const { baseVersionName, mergePublicUpdateLogs } = require('../src/lib/update-log-groups');

test('normalizes platform and runtime suffixes without changing standalone versions', () => {
  assert.equal(baseVersionName('DEV-055-ios'), 'DEV-055');
  assert.equal(baseVersionName('DEV-051-R106-android'), 'DEV-051');
  assert.equal(baseVersionName('DEV-054'), 'DEV-054');
});

test('merges duplicate platform and runtime logs while keeping distinct releases separate', () => {
  const common = {
    title: '同一项修复',
    releaseNotes: '同一份说明',
    releaseDate: '2026-08-29',
    stage: 'production',
  };
  const logs = mergePublicUpdateLogs([
    { ...common, versionName: 'DEV-055-android', platform: 'android' },
    { ...common, versionName: 'DEV-055-ios', platform: 'ios' },
    { ...common, versionName: 'DEV-051-R106-android', platform: 'android' },
    { ...common, versionName: 'DEV-051-android', platform: 'android' },
    { ...common, versionName: 'DEV-050-ios', platform: 'ios', title: '另一项修复' },
  ]);

  assert.deepEqual(logs, [
    { ...common, versionName: 'DEV-055', platform: 'all' },
    { ...common, versionName: 'DEV-051', platform: 'android' },
    { ...common, versionName: 'DEV-050', platform: 'ios', title: '另一项修复' },
  ]);
});

test('public history endpoint returns merged release entries', () => {
  const rows = [
    { versionName: 'DEV-056-android', platform: 'android', title: '排版优化', releaseNotes: '左右间距一致', releaseDate: '2026-08-29', stage: 'production' },
    { versionName: 'DEV-056-ios', platform: 'ios', title: '排版优化', releaseNotes: '左右间距一致', releaseDate: '2026-08-29', stage: 'production' },
  ];
  const db = { prepare: () => ({ all: () => rows }) };
  const router = createAppUpdateRouter(db);
  const handler = router.stack.find(layer => layer.route?.path === '/history').route.stack[0].handle;
  let payload;
  handler({}, {
    set() {},
    json(value) { payload = value; },
  });
  assert.deepEqual(payload, { logs: [{ ...rows[0], versionName: 'DEV-056', platform: 'all' }] });
});

test('running update endpoint hides technical platform suffixes from the app popup', () => {
  const db = {
    prepare: () => ({
      get: () => ({
        versionName: 'DEV-056-ios',
        title: '排版优化',
        releaseNotes: '左右间距一致',
        releaseDate: '2026-08-29',
        stage: 'production',
        platform: 'ios',
        runtimeVersion: '1.0.6',
      }),
    }),
  };
  const router = createAppUpdateRouter(db);
  const handler = router.stack.find(layer => layer.route?.path === '/running/:updateId').route.stack[0].handle;
  let payload;
  handler({ params: { updateId: '1daae68a-72b1-48b0-826b-265eee0ce9dd' } }, {
    set() {},
    json(value) { payload = value; },
  });
  assert.equal(payload.log.versionName, 'DEV-056');
});
