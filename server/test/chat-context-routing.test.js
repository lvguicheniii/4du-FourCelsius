const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('private-chat entry points keep post, comment, and profile contexts distinct', () => {
  const chatRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'chat.js'), 'utf8');

  assert.match(chatRoute, /kind === 'post_context' \|\| kind === 'comment_context'/);
  assert.match(chatRoute, /sourceComment\.user_id !== targetId/);
  assert.match(chatRoute, /commentId: sourceComment\.id/);

  const appRoot = path.join(__dirname, '..', '..', 'community-app', 'src', 'app');
  const postPath = path.join(appRoot, 'post', '[id].tsx');
  const profilePath = path.join(appRoot, 'user', '[name].tsx');
  if (fs.existsSync(postPath) && fs.existsSync(profilePath)) {
    const postScreen = fs.readFileSync(postPath, 'utf8');
    const profileScreen = fs.readFileSync(profilePath, 'utf8');
    assert.match(postScreen, /sourceCommentId: item\.id/);
    assert.match(postScreen, /sourcePostId: post\.id/);
    const profileChatParams = profileScreen.slice(profileScreen.indexOf("pathname: '/chat/[name]'"));
    assert.doesNotMatch(profileChatParams.slice(0, 700), /sourcePostId|sourceCommentId/);
  }
});
