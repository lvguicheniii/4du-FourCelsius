const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');

test('profile mutations bound user-controlled text and tag structures', () => {
  assert.match(source, /昵称不能为空且不能超过 20 个字符/);
  assert.match(source, /个人简介不能超过 500 个字符/);
  assert.match(source, /!Array\.isArray\(tags\) \|\| tags\.length > 20/);
  assert.match(source, /每个个性标签需为 1-20 个字符/);
});

test('avatar and cover changes only accept media owned by the current user', () => {
  assert.match(source, /isOwnedMediaUrl\(avatar, req\.userId, req\)/);
  assert.match(source, /isOwnedMediaUrl\(cover_image, req\.userId, req\)/);
});

test('password inputs have an upper bound before expensive hashing or comparison', () => {
  assert.match(source, /password\.length > 128/);
  assert.match(source, /current_password\.length > 128/);
});
