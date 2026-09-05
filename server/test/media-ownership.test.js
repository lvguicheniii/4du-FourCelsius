const test = require('node:test');
const assert = require('node:assert/strict');

process.env.COS_BUCKET = 'private-bucket-123';
process.env.COS_REGION = 'ap-guangzhou';
const { isApprovedMediaUrl, isOwnedMediaUrl, sameMediaUrl } = require('../src/lib/media-ownership');

const req = {
  hostname: 'api.example.com',
  get(name) {
    if (name === 'host') return 'api.example.com';
    return '';
  },
};

test('media URLs must belong to the authenticated user and an approved host', () => {
  const ownCos = 'https://private-bucket-123.cos.ap-guangzhou.myqcloud.com/USERS/user-a/posts/a.jpg';
  assert.equal(isOwnedMediaUrl(ownCos, 'user-a', req), true);
  assert.equal(isOwnedMediaUrl(ownCos, 'user-b', req), false);
  assert.equal(isOwnedMediaUrl('https://evil.example/USERS/user-a/posts/a.jpg', 'user-a', req), false);
  assert.equal(isOwnedMediaUrl('https://api.example.com/uploads/USERS/user-a/posts/a.jpg', 'user-a', req), true);
  assert.equal(isOwnedMediaUrl('/uploads/USERS/user-a/posts/a.jpg', 'user-a', req), true);
  assert.equal(isOwnedMediaUrl('//evil.example/uploads/USERS/user-a/posts/a.jpg', 'user-a', req), false);
  assert.equal(isOwnedMediaUrl('javascript://api.example.com/uploads/USERS/user-a/posts/a.jpg', 'user-a', req), false);
});

test('approved media may belong to another user but never to an external host', () => {
  const receivedCos = 'https://private-bucket-123.cos.ap-guangzhou.myqcloud.com/USERS/user-b/stickers/a.gif';
  assert.equal(isApprovedMediaUrl(receivedCos, req), true);
  assert.equal(isApprovedMediaUrl('/uploads/USERS/user-b/stickers/a.gif', req), true);
  assert.equal(isApprovedMediaUrl('https://evil.example/USERS/user-b/stickers/a.gif', req), false);
  assert.equal(isApprovedMediaUrl('//evil.example/uploads/USERS/user-b/stickers/a.gif', req), false);
});

test('signed and unsigned forms of the same object compare as one media asset', () => {
  const unsigned = 'https://private-bucket-123.cos.ap-guangzhou.myqcloud.com/USERS/user-a/videos/a.mp4';
  assert.equal(sameMediaUrl(`${unsigned}?q-sign-algorithm=sha1&q-key-time=1;2`, unsigned), true);
  assert.equal(sameMediaUrl('https://api.example.com/uploads/USERS/user-a/videos/a.mp4', '/uploads/USERS/user-a/videos/a.mp4'), true);
  assert.equal(sameMediaUrl(unsigned, unsigned.replace('a.mp4', 'b.mp4')), false);
});

test('post, chat and reef write routes enforce media ownership', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = file => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', file), 'utf8');
  assert.match(read('posts.js'), /isOwnedMediaUrl\(value, req\.userId, req\)/);
  assert.match(read('chat.js'), /mediaValues\.some\(value => !isOwnedMediaUrl/);
  assert.match(read('reef.js'), /!isOwnedMediaUrl\(liveMedia\?\.motionUrl/);
  assert.match(read('stickers.js'), /!isApprovedMediaUrl\(sourceUrl, req\)/);
  assert.match(read('chat.js'), /kind === 'sticker' && !isApprovedMediaUrl\(content, req\)/);
  assert.match(read('reef.js'), /kind === 'sticker' && !isApprovedMediaUrl\(content, req\)/);
  assert.match(read('comments.js'), /!isApprovedMediaUrl\(requestedUrl, req\)/);
  assert.match(read('chat.js'), /sameMediaUrl\(submittedUrl/);
  assert.match(read('reef.js'), /sameMediaUrl\(submittedUrl/);
});
