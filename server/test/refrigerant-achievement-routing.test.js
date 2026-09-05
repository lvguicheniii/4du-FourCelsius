const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('post use and shell gift trigger different achievements', () => {
  const refrigerant = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'refrigerant.js'), 'utf8');
  const frostShells = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'frost-shells.js'), 'utf8');
  const postUse = refrigerant.slice(refrigerant.indexOf("router.post('/use-on-post"), refrigerant.indexOf("router.post('/gift"));

  assert.match(postUse, /triggerAchievement\(db, req\.userId, 'r600a'/);
  assert.doesNotMatch(postUse, /hand_fragrance/);
  assert.match(frostShells, /triggerAchievement\(db, req\.userId, 'hand_fragrance'/);
  assert.doesNotMatch(frostShells, /deep_sea_lantern/);
  assert.doesNotMatch(postUse, /if \(post\.user_id !== req\.userId\) return/);
});
