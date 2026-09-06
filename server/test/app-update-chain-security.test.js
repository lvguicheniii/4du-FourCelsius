const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const createAppUpdateRouter = require('../src/routes/app-updates');

test('native update metadata must be complete and use credential-free HTTPS', () => {
  const valid = {
    apk_url: 'https://your-api.example/uploads/app-releases/sidu.apk',
    file_size: 58_452_399,
    md5: '0123456789abcdef0123456789abcdef',
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };
  assert.equal(createAppUpdateRouter.validAndroidRelease(valid), true);
  assert.equal(createAppUpdateRouter.validAndroidRelease({ ...valid, apk_url: 'http://example.com/a.apk' }), false);
  assert.equal(createAppUpdateRouter.validAndroidRelease({ ...valid, apk_url: 'https://user:pass@example.com/a.apk' }), false);
  assert.equal(createAppUpdateRouter.validAndroidRelease({ ...valid, file_size: 0 }), false);
  assert.equal(createAppUpdateRouter.validAndroidRelease({ ...valid, md5: '' }), false);
  assert.equal(createAppUpdateRouter.validAndroidRelease({ ...valid, sha256: '' }), false);
});

test('admin publishing and app download both enforce complete update metadata', () => {
  const adminSource = fs.readFileSync(path.join(__dirname, '../src/routes/admin/append5.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../../community-app/src/lib/app-updater.ts'), 'utf8');
  assert.match(adminSource, /validateApkRelease/);
  assert.match(adminSource, /发布 APK 前必须填写有效的 MD5 和 SHA-256/);
  assert.match(appSource, /assertAndroidReleaseIntegrity\(release\)/);
  assert.match(appSource, /APP_ERROR_CODES\.UPDATE_PACKAGE_METADATA/);
  assert.match(appSource, /APP_ERROR_CODES\.UPDATE_PACKAGE_INTEGRITY/);
  assert.match(appSource, /info\.md5/);
});

test('OTA download closes the update modal and reloads in place before showing release notes', () => {
  const settingsSource = fs.readFileSync(path.join(__dirname, '../../community-app/src/app/settings.tsx'), 'utf8');
  const modalSource = fs.readFileSync(path.join(__dirname, '../../community-app/src/components/app-update-modal.tsx'), 'utf8');
  const rootLayoutSource = fs.readFileSync(path.join(__dirname, '../../community-app/src/app/_layout.tsx'), 'utf8');
  assert.match(settingsSource, /await downloadOtaUpdate\(\);[\s\S]*setUpdateDialogOpen\(false\);[\s\S]*reloadOtaUpdate/);
  assert.match(settingsSource, /Platform\.OS === 'android' \? 420 : 180/);
  assert.match(settingsSource, /reloadOtaUpdate\([\s\S]*\.catch\([\s\S]*setUpdating\(false\)/);
  assert.doesNotMatch(settingsSource, /更新已下载|下次打开肆度时将自动生效|setUpdatePhase\('ready'\)/);
  assert.doesNotMatch(modalSource, /'ready'/);
  assert.match(modalSource, /progressLabel\?: string/);
  assert.match(modalSource, /progressLabel \|\| `\$\{Math\.round\(normalizedProgress \* 100\)\}%`/);
  assert.match(settingsSource, /visibleDownloadProgress >= 0\.985/);
  assert.match(settingsSource, /正在校验完整性并准备重启/);
  assert.match(rootLayoutSource, /<ColdStartUpdateGate enabled=\{!showLaunchScreen\}/);
  assert.match(rootLayoutSource, /<UpdateLogGate enabled=\{!showLaunchScreen && coldStartUpdateSettled\} \/>/);
  assert.match(rootLayoutSource, /<PostUpdateModal/);
});

test('native dynamic API requests bypass stale HTTP validators and retry a 304 once', () => {
  const clientSource = fs.readFileSync(path.join(__dirname, '../../community-app/src/api/client.ts'), 'utf8');
  assert.match(clientSource, /cache: 'no-store'/);
  assert.match(clientSource, /res\.status === 304/);
  assert.match(clientSource, /_sidu_refresh=/);
});

test('cold starts check for updates once per process and defer release notes until the check settles', () => {
  const gateSource = fs.readFileSync(path.join(__dirname, '../../community-app/src/components/cold-start-update-gate.tsx'), 'utf8');
  const rootLayoutSource = fs.readFileSync(path.join(__dirname, '../../community-app/src/app/_layout.tsx'), 'utf8');
  assert.match(gateSource, /__siduColdStartUpdateCheckClaimed/);
  assert.match(gateSource, /checkForAppUpdate\(\)/);
  assert.match(gateSource, /downloadOtaUpdate\(\)[\s\S]*setVisible\(false\)[\s\S]*reloadOtaUpdate/);
  assert.match(gateSource, /pendingUpdate\?\.kind === 'store'[\s\S]*前往\$\{pendingUpdate\.release\.storeName\}更新/);
  assert.match(rootLayoutSource, /<ColdStartUpdateGate enabled=\{!showLaunchScreen\}/);
  assert.match(rootLayoutSource, /<UpdateLogGate enabled=\{!showLaunchScreen && coldStartUpdateSettled\}/);
});

test('iOS checks the App Store instead of applying an in-app OTA', () => {
  const updaterSource = fs.readFileSync(path.join(__dirname, '../../community-app/src/lib/app-updater.ts'), 'utf8');
  const iosBranch = updaterSource.slice(
    updaterSource.indexOf("if (Platform.OS === 'ios')"),
    updaterSource.indexOf("let updateCheck: AndroidUpdateCheck"),
  );
  assert.match(iosBranch, /checkIosAppStoreUpdate\(\)/);
  assert.match(updaterSource, /itunes\.apple\.com\/lookup/);
  assert.match(updaterSource, /\(\^\|\\\.\)apple\\\.com\$/);
  assert.doesNotMatch(iosBranch, /Updates\.checkForUpdateAsync/);
});

test('Android build 13 treats DEV-070 as embedded while preserving future OTA checks', () => {
  const updaterSource = fs.readFileSync(path.join(__dirname, '../../community-app/src/lib/app-updater.ts'), 'utf8');
  assert.match(updaterSource, /'00000000-0000-4000-8000-000000000013': 13/);
  assert.match(updaterSource, /versionCode >= minimumBuild/);
  assert.match(updaterSource, /payload\.ota\.available[\s\S]*!isAndroidOtaIncludedInNativeBuild\(currentVersionCode\(\), latestOtaUpdateId\)/);
  assert.match(updaterSource, /Updates\.checkForUpdateAsync\(\)/);
});
