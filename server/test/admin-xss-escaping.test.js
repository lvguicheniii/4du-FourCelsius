const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminPage = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'public', 'admin', 'index.html'),
  'utf8',
);

test('admin renders user-controlled values through the HTML escaper', () => {
  assert.match(adminPage, /E\(c\.content\)/);
  assert.match(adminPage, /E\(c\.uname\)/);
  assert.match(adminPage, /E\(p\.content\|\|'\(无内容\)'\)/);
  assert.match(adminPage, /E\(String\(v\)\.slice\(0,80\)\)/);
  assert.match(adminPage, /E\(n\.title\)/);
  assert.doesNotMatch(adminPage, /<td>'\+c\.content\+'<\/td>/);
  assert.doesNotMatch(adminPage, /<td>'\+n\.title\+'<\/td>/);
});
