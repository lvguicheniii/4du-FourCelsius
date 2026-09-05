const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin', 'api.js'), 'utf8');

test('admin CSV export quotes values and neutralizes spreadsheet formulas', () => {
  assert.match(source, /function csvCell\(value\)/);
  assert.match(source, /\/\^\[=\+\\-@\\t\]\//);
  assert.match(source, /text\.replace\(\/"\/g, '""'\)/);
  assert.match(source, /\.map\(csvCell\)\.join\(','\)/);
  assert.doesNotMatch(source, /u\.created_at\]\.join\(','\)/);
});
