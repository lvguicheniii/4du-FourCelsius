const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { JWT_SECRET } = require('../src/lib/security-config');

async function main() {
  const user = db.prepare("SELECT id,token_version FROM users WHERE status!='banned' ORDER BY created_at LIMIT 1").get();
  if (!user) throw new Error('No active user is available for the feature-gate smoke test');
  const token = jwt.sign({ userId: user.id, tokenVersion: user.token_version }, JWT_SECRET, { expiresIn: '2m' });
  const headers = { Authorization: `Bearer ${token}` };

  const blockedVideo = await fetch('http://127.0.0.1:3001/api/upload?type=vp', { method: 'POST', headers });
  const blockedBody = await blockedVideo.json();
  if (blockedVideo.status !== 403 || !String(blockedBody.error || '').includes('暂未开放')) {
    throw new Error(`Video upload gate returned ${blockedVideo.status}: ${JSON.stringify(blockedBody)}`);
  }

  const livePhotoMotion = await fetch('http://127.0.0.1:3001/api/upload?type=vp&livePhoto=1', { method: 'POST', headers });
  if (livePhotoMotion.status === 403) throw new Error('Live Photo motion uploads were incorrectly blocked');

  const imageRequest = await fetch('http://127.0.0.1:3001/api/upload?type=p', { method: 'POST', headers });
  if (imageRequest.status === 403) throw new Error('Image uploads were incorrectly blocked by the video feature flag');

  console.log(JSON.stringify({ ok: true, videoStatus: blockedVideo.status, livePhotoStatus: livePhotoMotion.status, imageStatus: imageRequest.status }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
