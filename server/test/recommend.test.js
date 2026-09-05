const test = require('node:test');
const assert = require('node:assert/strict');
const {
  recommendScore,
  arrangeRecommendations,
  encodeCursor,
  decodeCursor,
} = require('../src/utils/recommend');
const { formatCst } = require('../src/lib/time');

function post(id, author, createdAt, extras = {}) {
  return {
    id,
    user_id: author,
    content: '',
    board_id: '["daily"]',
    created_at: createdAt,
    updated_at: createdAt,
    likes_count: 0,
    comments_count: 0,
    author_post_count: 3,
    impression_count: 0,
    ...extras,
  };
}

test('recommendation cursor round-trips and rejects malformed input', () => {
  const value = { offset: 20, nowMs: 1710000000000 };
  assert.deepEqual(decodeCursor(encodeCursor(value)), value);
  assert.equal(decodeCursor('not-a-cursor'), null);
});

test('recommendation freshness decays smoothly instead of using the display temperature twice', () => {
  const nowMs = Date.now();
  const recent = post('recent', 'u1', formatCst(new Date(nowMs - 2 * 3600000)));
  const older = post('older', 'u2', formatCst(new Date(nowMs - 26 * 3600000)));
  assert.ok(recommendScore(recent, { nowMs, seed: 'test' }) > recommendScore(older, { nowMs, seed: 'test' }));
  const hour25 = recommendScore(post('h25', 'u3', formatCst(new Date(nowMs - 25 * 3600000))), { nowMs, seed: 'test' });
  assert.ok(Math.abs(hour25 - recommendScore(older, { nowMs, seed: 'test' })) < 1);
});

test('recommendation ordering limits an author to two posts in a recent ten-item window', () => {
  const nowMs = Date.now();
  const createdAt = formatCst(new Date(nowMs - 3600000));
  const candidates = [
    ...Array.from({ length: 5 }, (_, index) => post(`a${index}`, 'author-a', createdAt, { likes_count: 10 - index })),
    ...Array.from({ length: 8 }, (_, index) => post(`b${index}`, `author-${index}`, createdAt, { likes_count: 4 })),
  ];
  const arranged = arrangeRecommendations(candidates, { nowMs, seed: 'stable-test' });
  for (let index = 0; index < arranged.length; index += 1) {
    const window = arranged.slice(Math.max(0, index - 9), index + 1);
    if (index < 10) assert.ok(window.filter((item) => item.user_id === 'author-a').length <= 2);
  }
  assert.equal(new Set(arranged.map((item) => item.id)).size, candidates.length);
});
