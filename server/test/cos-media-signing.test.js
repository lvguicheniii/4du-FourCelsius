const test = require('node:test');
const assert = require('node:assert/strict');

const { createCosMediaSigner } = require('../src/lib/cos-media-signing');

function signer() {
  return createCosMediaSigner({
    secretId: 'AKIDEXAMPLE',
    secretKey: 'secret-example',
    bucket: 'example-media-1234567890',
    region: 'ap-guangzhou',
    ttlSeconds: 3600,
  });
}

test('signs only URLs from the configured COS bucket', () => {
  const media = signer();
  const source = 'https://example-media-1234567890.cos.ap-guangzhou.myqcloud.com/USERS/u1/posts/a.jpg';
  const signed = media.signUrl(source);
  assert.match(signed, /^https:\/\/example-media-1234567890\.cos\.ap-guangzhou\.myqcloud\.com\/USERS\/u1\/posts\/a\.jpg\?/);
  assert.match(signed, /q-signature=/);
  assert.equal(media.signUrl('https://other.example.com/a.jpg'), 'https://other.example.com/a.jpg');
});

test('keeps signed URLs stable during the cache window', () => {
  const media = signer();
  const source = 'https://example-media-1234567890.cos.ap-guangzhou.myqcloud.com/USERS/u1/videos/a.mp4';
  assert.equal(media.signUrl(source), media.signUrl(source));
});

test('deep-signs media URLs inside objects, arrays, and JSON message content', () => {
  const media = signer();
  const stillUrl = 'https://example-media-1234567890.cos.ap-guangzhou.myqcloud.com/USERS/u1/live/a.jpg';
  const motionUrl = 'https://example-media-1234567890.cos.ap-guangzhou.myqcloud.com/USERS/u1/live/a.mp4';
  const result = media.signPayload({
    avatar: stillUrl,
    images: [stillUrl],
    content: JSON.stringify({ stillUrl, motionUrl }),
    local: '/uploads/USERS/u1/a.jpg',
  });
  assert.match(result.avatar, /q-signature=/);
  assert.match(result.images[0], /q-signature=/);
  const content = JSON.parse(result.content);
  assert.match(content.stillUrl, /q-signature=/);
  assert.match(content.motionUrl, /q-signature=/);
  assert.equal(result.local, '/uploads/USERS/u1/a.jpg');
});

test('is a no-op when COS signing is not configured', () => {
  const media = createCosMediaSigner({ secretId: '', secretKey: '', bucket: '', region: '' });
  const source = 'https://example-media-1234567890.cos.ap-guangzhou.myqcloud.com/a.jpg';
  const payload = { content: '{  "kept" : true }', source };
  assert.equal(media.enabled, false);
  assert.equal(media.signUrl(source), source);
  assert.equal(media.signPayload(payload), payload);
});
