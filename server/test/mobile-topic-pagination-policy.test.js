const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const topicSource = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/app/topic/[name].tsx'),
  'utf8',
);

test('topic pagination blocks duplicate page requests and stale topic responses', () => {
  assert.match(topicSource, /loadingMoreRef\.current/);
  assert.match(topicSource, /const generation = refresh \? \+\+requestGenerationRef\.current/);
  assert.match(topicSource, /if \(generation !== requestGenerationRef\.current\) return/);
  assert.match(topicSource, /return \(\) => \{ requestGenerationRef\.current \+= 1; \}/);
});
