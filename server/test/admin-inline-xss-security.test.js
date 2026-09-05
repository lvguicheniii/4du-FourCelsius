const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/public/admin/index.html'), 'utf8');

test('admin inline JavaScript parameters encode apostrophes separately from HTML', () => {
  assert.match(source, /function J\(v\)\{return encodeURIComponent[\s\S]*replace\(\/'\/g,'%27'\)/);
  assert.match(source, /function modCmd[^{]+\{[^}]+J\(name\|\|''\)/);
  assert.match(source, /function historyCmd[^{]+\{[^}]+J\(uid\)/);
});

test('admin media viewers use the rendered image URL instead of interpolated JavaScript strings', () => {
  assert.match(source, /openImg\(this\.currentSrc\|\|this\.src\)/);
  assert.doesNotMatch(source, /openImg\(decodeURIComponent\(\\'\'\+encodeURIComponent/);
});

test('admin user-controlled text remains HTML escaped before innerHTML rendering', () => {
  assert.match(source, /function E\(v\)/);
  assert.match(source, /E\(content\)/);
  assert.match(source, /E\(name\)/);
  assert.match(source, /E\(t\.content_snapshot\)/);
});
