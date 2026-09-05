const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

test('server startup never creates a known default administrator', () => {
  assert.doesNotMatch(source, /ADMIN_BOOTSTRAP_USERNAME \|\| 'admin'/);
  assert.doesNotMatch(source, /admin123/);
  assert.match(source, /bootstrapUsername\.length < 3/);
  assert.match(source, /bootstrapPassword\.length < 12/);
});
