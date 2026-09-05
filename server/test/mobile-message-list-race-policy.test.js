const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const appRoot = path.join(__dirname, '..', '..', 'community-app', 'src', 'app');

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

for (const [label, relativePath] of [
  ['message list', path.join('(tabs)', 'messages.tsx')],
  ['favorite conversations', 'message-favorites.tsx'],
]) {
  test(`${label} ignores stale responses and clears data without a session`, () => {
    const source = read(relativePath);
    assert.match(source, /const \{ token \} = useAuth\(\)/);
    assert.match(source, /const generation = \+\+loadGenerationRef\.current/);
    assert.match(source, /generation !== loadGenerationRef\.current/);
    assert.match(source, /if \(!token\)/);
    assert.match(source, /loadGenerationRef\.current \+= 1/);
  });
}

test('notification category and account changes invalidate older notification loads', () => {
  const source = read('notifications.tsx');
  assert.match(source, /const \{ token \} = useAuth\(\)/);
  assert.match(source, /const generation = \+\+loadGenerationRef\.current/g);
  assert.match(source, /generation !== loadGenerationRef\.current/g);
  assert.match(source, /return \(\) => \{ loadGenerationRef\.current \+= 1; \}/);
  assert.match(source, /\[acknowledgeVisibleInteraction, category, token\]/);
});
