const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');

test('the app has a recoverable root error boundary with privacy-limited telemetry', () => {
  const layout = fs.readFileSync(path.join(root, 'community-app', 'src', 'app', '_layout.tsx'), 'utf8');
  const screen = fs.readFileSync(path.join(root, 'community-app', 'src', 'components', 'app-error-screen.tsx'), 'utf8');
  const telemetry = fs.readFileSync(path.join(root, 'server', 'src', 'routes', 'telemetry.js'), 'utf8');

  assert.match(layout, /AppErrorScreen as ErrorBoundary/);
  assert.match(screen, /await retry\(\)/);
  assert.match(screen, /故障编号/);
  assert.match(telemetry, /MAX_REPORTS_PER_WINDOW/);
  assert.match(telemetry, /errorMessage: clean/);
  assert.doesNotMatch(telemetry, /req\.body[^\n]*content/);
});
