const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('operations alerts never enter user-facing notification delivery', () => {
  const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/notifications.js'), 'utf8');
  const health = fs.readFileSync(path.resolve(__dirname, '../ops-health-check.js'), 'utf8');
  const mobile = fs.readFileSync(path.resolve(__dirname, '../../community-app/src/lib/notification-policy.ts'), 'utf8');
  const migrations = fs.readFileSync(path.resolve(__dirname, '../src/db/migrations.js'), 'utf8');
  for (const title of ['系统运维告警', '系统运维恢复']) {
    assert.match(routes, new RegExp(title));
    assert.match(mobile, new RegExp(title));
    assert.match(migrations, new RegExp(title));
  }
  assert.doesNotMatch(health, /INSERT INTO notifications/);
  assert.match(health, /notifyExternal/);
});
