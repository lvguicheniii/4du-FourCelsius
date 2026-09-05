import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildExpoClientConfig } from './self-hosted-ota-config.mjs';

const require = createRequire(import.meta.url);
const { buildClientManifest } = require('../../server/src/lib/self-hosted-ota');

function argsMap(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 2) out[values[i]?.replace(/^--/, '')] = values[i + 1];
  return out;
}
function required(value, label) { if (!String(value || '').trim()) throw new Error(`${label} is required`); return String(value).trim(); }
function hash(bytes, encoding = 'hex') { return crypto.createHash('sha256').update(bytes).digest(encoding); }
function uuid() { return crypto.randomUUID(); }
function contentType(ext) {
  return ({ hbc: 'application/javascript', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', xml: 'application/xml', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg' })[ext] || 'application/octet-stream';
}

const args = argsMap(process.argv.slice(2));
const versionName = required(args.version, '--version');
const runtimeVersion = required(args.runtime, '--runtime');
const message = required(args.message, '--message');
const privateKeyPath = path.resolve(required(args['private-key'] || process.env.SIDU_OTA_PRIVATE_KEY, '--private-key or SIDU_OTA_PRIVATE_KEY'));
const publicOrigin = required(args['public-origin'] || 'https://your-api.example', '--public-origin').replace(/\/$/, '');
const platforms = required(args.platform || 'android,ios', '--platform').split(',').map(v => v.trim());
const output = path.resolve(args.output || path.join('ota-builds', versionName));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sidu-ota-export-'));
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
fs.mkdirSync(path.join(output, 'manifests'), { recursive: true });

const appJson = JSON.parse(fs.readFileSync(path.resolve('app.json'), 'utf8')).expo;
const createdAt = new Date().toISOString();
const groupId = uuid();
const index = { versionName, runtimeVersion, message, createdAt, groupId, platforms: {} };
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

for (const platform of platforms) {
  if (!['android', 'ios'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
  const exportDir = path.join(temporary, platform);
  const result = spawnSync(path.resolve('node_modules/.bin/expo'), ['export', '--platform', platform, '--output-dir', exportDir, '--clear'], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`Expo export failed for ${platform}`);
  const metadata = JSON.parse(fs.readFileSync(path.join(exportDir, 'metadata.json'), 'utf8')).fileMetadata[platform];
  const copyAsset = (relativePath, extension) => {
    const bytes = fs.readFileSync(path.join(exportDir, relativePath));
    const key = hash(bytes);
    const destination = path.join(output, 'assets', key);
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx' });
    return { key, hash: hash(bytes, 'base64url'), fileExtension: extension, contentType: contentType(extension), size: bytes.length };
  };
  const launchExtension = path.extname(metadata.bundle).slice(1) || 'hbc';
  const manifest = {
    id: uuid(), groupId, channel: 'production', platform, runtimeVersion, versionName,
    message, createdAt, expoClient: buildExpoClientConfig(appJson, runtimeVersion),
    launchAsset: copyAsset(metadata.bundle, launchExtension),
    assets: metadata.assets.map(asset => copyAsset(asset.path, asset.ext)),
  };
  const clientManifestBody = JSON.stringify(buildClientManifest(manifest, publicOrigin));
  manifest.codeSigning = {
    keyId: 'main',
    algorithm: 'rsa-v1_5-sha256',
    manifestSha256: hash(Buffer.from(clientManifestBody)),
    signature: crypto.sign('sha256', Buffer.from(clientManifestBody), privateKey).toString('base64'),
  };
  fs.writeFileSync(path.join(output, 'manifests', `${platform}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  index.platforms[platform] = { updateId: manifest.id, assets: manifest.assets.length + 1 };
}
fs.writeFileSync(path.join(output, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ output, ...index }, null, 2));
