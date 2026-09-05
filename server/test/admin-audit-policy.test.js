const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/admin/api.js'), 'utf8');
const moderationSource = fs.readFileSync(path.join(__dirname, '..', 'src/routes/admin/append4.js'), 'utf8');

test('every report decision creates an administrator audit record', () => {
  assert.match(source, /`handle_\$\{type \|\| 'post'\}_report`/);
  assert.match(source, /处理结果：\$\{status\}/);
});

test('user status changes are validated and ban logs retain their reason', () => {
  assert.match(source, /\['active', 'banned', 'deleted'\]\.includes\(status\)/);
  assert.match(source, /封禁 \$\{days\}d，原因：/);
});

test('Tencent second review reuses standard punishments and can hold light private-message violations', () => {
  assert.match(moderationSource, /applyAdminMute\(req, targetId/);
  assert.match(moderationSource, /applyAdminBan\(req, targetId/);
  assert.match(moderationSource, /action === 'light'/);
  assert.match(moderationSource, /light_violation=1/);
  assert.doesNotMatch(moderationSource, /'system','moderation'/);
});
