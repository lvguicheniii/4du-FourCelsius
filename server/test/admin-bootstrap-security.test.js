const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

test('local startup is easy while production rejects the published credentials', () => {
  assert.match(source, /ADMIN_BOOTSTRAP_USERNAME \|\| \(isProduction \? '' : 'noesis'\)/);
  assert.match(source, /ADMIN_BOOTSTRAP_PASSWORD \|\| \(isProduction \? '' : 'noesis'\)/);
  assert.match(source, /usesPublishedLocalCredentials/);
  assert.match(source, /isProduction && usesPublishedLocalCredentials/);
  assert.match(source, /bootstrapUsername\.length < 3/);
  assert.match(source, /isProduction && bootstrapPassword\.length < 12/);
  assert.match(source, /!isProduction && bootstrapPassword\.length < 6/);
});
