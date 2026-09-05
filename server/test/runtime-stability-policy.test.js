const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('SQLite waits for short writer contention and validates itself on startup', () => {
  const database = fs.readFileSync(path.join(root, 'src', 'db', 'index.js'), 'utf8');
  assert.match(database, /busy_timeout = 5000/);
  assert.match(database, /wal_autocheckpoint = 1000/);
  assert.match(database, /journal_size_limit = 67108864/);
  assert.match(database, /pragma\('quick_check'\)/);
});

test('PM2 signals drain HTTP and WebSocket connections before closing SQLite', () => {
  const index = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
  const websocket = fs.readFileSync(path.join(root, 'src', 'ws.js'), 'utf8');
  assert.match(index, /process\.once\('SIGINT'/);
  assert.match(index, /process\.once\('SIGTERM'/);
  assert.match(index, /await Promise\.all\(\[httpClosed, wsServer\.shutdown\(\)\]\)/);
  assert.match(index, /wal_checkpoint\(TRUNCATE\)/);
  assert.match(websocket, /ws\.close\(1012, 'server_restart'\)/);
});

test('production process logs are bounded and retained for diagnosis', () => {
  const config = fs.readFileSync(path.join(root, 'ops', 'logrotate-sidu-pm2'), 'utf8');
  assert.match(config, /sidu-error\.log/);
  assert.match(config, /daily/);
  assert.match(config, /rotate 14/);
  assert.match(config, /size 10M/);
  assert.match(config, /copytruncate/);
});
