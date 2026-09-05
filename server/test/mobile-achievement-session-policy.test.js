const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/components/achievement-toast.tsx'),
  'utf8',
);
const achievementScreen = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/app/achievements.tsx'),
  'utf8',
);
const settingsScreen = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/app/settings.tsx'),
  'utf8',
);
const notificationsScreen = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/app/notifications.tsx'),
  'utf8',
);

test('achievement queues and timers reset when the signed-in account changes', () => {
  assert.match(source, /sessionGenerationRef\.current \+= 1/);
  assert.match(source, /queue\.current = \[\]/);
  assert.match(source, /seen\.current\.clear\(\)/);
  assert.match(source, /clearTimeout\(hideTimerRef\.current\)/);
});

test('old achievement callbacks cannot acknowledge events as a newer account', () => {
  assert.match(source, /const generation = sessionGenerationRef\.current/);
  assert.match(source, /generation !== sessionGenerationRef\.current/);
  assert.match(source, /if \(!token \|\| !item\.id/);
});

test('mobile achievement surfaces use the award-style medal instead of a star', () => {
  const achievementSurfaces = `${source}\n${achievementScreen}\n${settingsScreen}\n${notificationsScreen}`;
  assert.match(source, /<AwardIcon size=\{20\} color=\{colors\.accent\} \/>/);
  assert.doesNotMatch(source, /backgroundColor: colors\.accentBg/);
  assert.match(achievementScreen, /<AwardIcon /);
  assert.match(settingsScreen, /<AwardIcon /);
  assert.match(notificationsScreen, /isAchievementNotification\(item\)/);
  assert.match(notificationsScreen, /achievement[\s\S]*<AwardIcon size=\{20\} color=\{colors\.accent\} \/>/);
  assert.match(notificationsScreen, /achievementIconBox: \{ backgroundColor: 'transparent' \}/);
  assert.doesNotMatch(achievementSurfaces, /name="star(?:-outline)?"/);
});

test('native achievement notifications use the matching award artwork', () => {
  const appConfig = fs.readFileSync(
    path.resolve(__dirname, '../../community-app/app.json'),
    'utf8',
  );
  const achievementPush = fs.readFileSync(
    path.resolve(__dirname, '../src/lib/achievements.js'),
    'utf8',
  );
  assert.match(appConfig, /achievement-notification-icon\.png/);
  assert.match(achievementPush, /api\/notification-assets\/achievement-award\.png/);
});
