const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');

function appSource(...parts) {
  return fs.readFileSync(path.join(root, 'community-app', 'src', ...parts), 'utf8');
}

test('undercurrent salvage recovers from empty pools and handles non-momentum drags', () => {
  const source = appSource('app', 'undercurrent.tsx');
  assert.match(source, /onScrollEndDrag=\{\(\) => \{\s*isDraggingWheelRef\.current = false;\s*scheduleSalvage\(450\);\s*\}\}/);
  assert.match(source, /const fresh = await getUndercurrent\(genderMode\)/);
  assert.match(source, /const fresh = await getBeacons\(genderMode\)/);
  assert.match(source, /isSalvagingRef\.current = false;\s*Alert\.alert\('暂无可打捞的切片'/);
  assert.match(source, /isSalvagingRef\.current = false;\s*Alert\.alert\('暂无可共振的信标'/);
});

test('reef composer tracks the keyboard and message previews own their unread indicators', () => {
  const reef = appSource('app', 'reef', '[id].tsx');
  const messages = appSource('app', '(tabs)', 'messages.tsx');
  const reefCard = appSource('components', 'reef-share-card.tsx');
  assert.match(reef, /<KeyboardInsetView/);
  assert.doesNotMatch(reef, /<KeyboardAvoidingView/);
  assert.match(messages, /conversationPreview/);
  assert.match(messages, /backgroundColor: '#33A9DC'/);
  assert.match(reefCard, /room\.unread/);
  assert.match(reefCard, /backgroundColor: accent/);
});

test('reef retention notification replaces vote buttons with the saved choice', () => {
  const notifications = appSource('app', 'notifications.tsx');
  assert.match(notifications, /reefVoteStatus\?\.myVote \? \(/);
  assert.match(notifications, /你已选择了\{reefVoteStatus\.myVote === 'yes' \? '是' : '否'\}/);
  assert.match(notifications, /if \(!item\.relatedId \|\| reefVoteLoading \|\| reefVoteStatus\?\.myVote\) return/);
});

test('every feed pager page keeps a measurable full-height native container and Android swipe navigation', () => {
  const source = appSource('app', '(tabs)', 'index.tsx');
  assert.match(source, /<View key=\{page\.key\} collapsable=\{false\} style=\{\{ flex: 1, backgroundColor: colors\.bg \}\}>/);
  assert.match(source, /style=\{\{ flex: 1, backgroundColor: colors\.bg \}\}\s+showsVerticalScrollIndicator/);
  assert.match(source, /<AnimatedPagerView[\s\S]*\{TABS\.map\(renderFeedPage\)\}[\s\S]*<\/AnimatedPagerView>/);
  assert.doesNotMatch(source, /Platform\.OS === 'android' \? renderFeedPage/);
  assert.doesNotMatch(source, /if \(Platform\.OS === 'android'\) \{\s*setTab\(t\);\s*return;/);
});

test('Android refresh controls remain direct native elements under Fabric', () => {
  const source = appSource('components', 'app-refresh-control.tsx');
  assert.match(source, /export const AppRefreshControl = RefreshControl/);
  assert.doesNotMatch(source, /export function AppRefreshControl/);
});
