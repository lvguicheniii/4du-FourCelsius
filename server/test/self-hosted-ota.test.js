const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildClientManifest, codeSigningHeader, resolveChannelManifest, sha256Base64Url } = require('../src/lib/self-hosted-ota');

test('self-hosted OTA preserves the standalone deep-link scheme in Expo client config', async () => {
  const { buildExpoClientConfig } = await import('../../community-app/scripts/self-hosted-ota-config.mjs');
  const appJson = { name: '肆度', slug: 'app', version: '1.0.8', scheme: 'communityapp', updates: { url: 'https://example.test/ota' } };
  const expoClient = buildExpoClientConfig(appJson, '1.0.5');
  assert.equal(expoClient.scheme, 'communityapp');
  assert.equal(expoClient.runtimeVersion, '1.0.5');
  assert.deepEqual(expoClient.updates, appJson.updates);
});

test('self-hosted OTA selects an exact channel, platform and runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidu-self-ota-'));
  const directory = path.join(root, 'channels', 'production', 'android');
  fs.mkdirSync(directory, { recursive: true });
  const stored = { id: '11111111-1111-4111-8111-111111111111', groupId: '22222222-2222-4222-8222-222222222222', channel: 'production', platform: 'android', runtimeVersion: '1.0.5', versionName: 'DEV-046', createdAt: new Date().toISOString(), launchAsset: { key: 'a'.repeat(64), hash: 'hash', fileExtension: 'hbc' }, assets: [] };
  fs.writeFileSync(path.join(directory, '1.0.5.json'), JSON.stringify(stored));
  assert.equal(resolveChannelManifest(root, 'production', 'android', '1.0.5').id, stored.id);
  assert.equal(resolveChannelManifest(root, 'production', 'ios', '1.0.5'), null);
  assert.equal(resolveChannelManifest(root, '../production', 'android', '1.0.5'), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('client manifest uses only first-party immutable asset URLs', () => {
  const asset = { key: 'b'.repeat(64), hash: sha256Base64Url(Buffer.from('asset')), fileExtension: 'png' };
  const manifest = buildClientManifest({ id: '11111111-1111-4111-8111-111111111111', groupId: '22222222-2222-4222-8222-222222222222', channel: 'production', runtimeVersion: '1.0.5', versionName: 'DEV-046', createdAt: new Date().toISOString(), launchAsset: asset, assets: [asset] }, 'https://your-api.example');
  assert.equal(manifest.runtimeVersion, '1.0.5');
  assert.match(manifest.launchAsset.url, /^https:\/\/175\.178\.40\.40\/api\/app-updates\/ota\/assets\/[a-f0-9]{64}$/);
  assert.equal(manifest.extra.sidu.source, 'tencent-self-hosted');
});

test('signed manifests are bound to their exact first-party response body', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const asset = { key: 'c'.repeat(64), hash: sha256Base64Url(Buffer.from('asset')), fileExtension: 'png' };
  const stored = { id: '11111111-1111-4111-8111-111111111111', groupId: '22222222-2222-4222-8222-222222222222', channel: 'production', runtimeVersion: '1.0.8', versionName: 'SEC-001', createdAt: new Date().toISOString(), launchAsset: asset, assets: [] };
  const body = JSON.stringify(buildClientManifest(stored, 'https://your-api.example'));
  stored.codeSigning = {
    keyId: 'main',
    algorithm: 'rsa-v1_5-sha256',
    manifestSha256: crypto.createHash('sha256').update(body).digest('hex'),
    signature: crypto.sign('sha256', Buffer.from(body), privateKey).toString('base64'),
  };
  const header = codeSigningHeader(stored, body);
  assert.match(header, /^sig="[A-Za-z0-9+/]+=*", keyid="main", alg="rsa-v1_5-sha256"$/);
  assert.equal(crypto.verify('sha256', Buffer.from(body), publicKey, Buffer.from(stored.codeSigning.signature, 'base64')), true);
  assert.equal(codeSigningHeader(stored, `${body} `), null);
});
