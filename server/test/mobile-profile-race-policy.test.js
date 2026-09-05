const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profileSource = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/app/(tabs)/profile.tsx'),
  'utf8',
);
const otherProfileSource = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/app/user/[name].tsx'),
  'utf8',
);
const postCardSource = fs.readFileSync(
  path.resolve(__dirname, '../../community-app/src/components/post-card.tsx'),
  'utf8',
);

test('profile refreshes ignore stale responses after navigation or a newer request', () => {
  assert.match(profileSource, /const requestId = \+\+profileRequestRef\.current/);
  assert.match(profileSource, /if \(requestId !== profileRequestRef\.current\) return/);
  assert.match(profileSource, /return \(\) => \{ profileRequestRef\.current \+= 1; \}/);
});

test('profile posts and slice boxes load concurrently without delaying each other', () => {
  assert.match(profileSource, /await Promise\.allSettled\(\[/);
  assert.match(profileSource, /getPosts\(1, 50, undefined, data\.id\)/);
  assert.match(profileSource, /getSliceBoxes\(\)/);
});

test('other-user profiles ignore stale profile, post, and follow responses', () => {
  assert.match(otherProfileSource, /const requestId = \+\+userRequestRef\.current/);
  assert.match(otherProfileSource, /if \(requestId !== userRequestRef\.current\) return/);
  assert.match(otherProfileSource, /return \(\) => \{ userRequestRef\.current \+= 1; \}/);
  assert.match(otherProfileSource, /activeProfileIdRef\.current !== targetProfileId/);
  assert.match(otherProfileSource, /const profileMatchesRequest = !!profile/);
  assert.match(otherProfileSource, /styles\.floatingActionsWrap/);
  assert.match(otherProfileSource, /bottom: insets\.bottom \+ 12/);
});

test('feed cards keep single images bounded and open other-user profiles', () => {
  assert.match(postCardSource, /function SinglePostImage/);
  assert.match(postCardSource, /const maxHeight = 300/);
  assert.match(postCardSource, /const imageWidth = Math\.min\(width, maxHeight \* aspectRatio\)/);
  assert.match(postCardSource, /const imageHeight = imageWidth \/ aspectRatio/);
  assert.match(postCardSource, /contentFit="contain"/);
  assert.match(postCardSource, /authorId !== user\?\.id/);
  assert.match(postCardSource, /pathname: '\/user\/\[name\]'/);
});

test('mute countdowns refresh while either profile remains open', () => {
  assert.match(profileSource, /setInterval\(\(\) => setRestrictionTick/);
  assert.match(otherProfileSource, /setInterval\(\(\) => setRestrictionTick/);
});
