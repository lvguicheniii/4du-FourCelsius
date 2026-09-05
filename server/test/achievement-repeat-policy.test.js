const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('achievement unlocks are permanently one-time in every environment', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/lib/achievements.js'),
    'utf8',
  );

  assert.doesNotMatch(source, /ACHIEVEMENT_REPEAT|forceRepeat|DEVELOPMENT_REPEAT/);
  assert.match(source, /INSERT OR IGNORE INTO user_achievements/);
  assert.match(source, /if \(!claimed\.changes\) return false/);
});
