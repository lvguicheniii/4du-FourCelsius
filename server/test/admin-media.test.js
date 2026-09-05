const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin post cards render standard videos and preserve media fields in report queries', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'admin', 'index.html'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin', 'api.js'), 'utf8');
  assert.match(html, /function postVideo\(url,poster\)/);
  assert.match(html, /videoType!==['"]live_photo['"]\?postVideo/);
  assert.match(html, /post_video_url/);
  assert.match(api, /p\.video_url as post_video_url/);
  assert.match(api, /p\.video_media_type as post_video_media_type/);
});
