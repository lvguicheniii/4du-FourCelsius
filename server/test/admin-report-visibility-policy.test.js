const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('pending reports remain visible after a related user account is removed', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin', 'api.js'), 'utf8');
  const reporterLeftJoins = source.match(/LEFT JOIN users ru ON/g) || [];

  assert.equal(reporterLeftJoins.length, 5);
  assert.match(source, /COALESCE\(ru\.nickname,ru\.username,'已注销用户'\)/);
  assert.match(source, /r\.reporter_id as reporter_id/i);
});

test('dashboard pending report card routes to the first non-empty report category', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin', 'api.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'admin', 'index.html'), 'utf8');

  assert.match(api, /reportsPendingByType\s*=\s*\{/);
  assert.match(api, /reportsPendingByType,/);
  assert.match(admin, /class="c dashboard-link"[^>]+onclick="openPendingReports\(\)"/);
  assert.match(admin, /order=\['post','comment','message','reef_message','reef'\]/);
  assert.match(admin, /_rSt='pending';_rP=1;go\('reports'\)/);
});
