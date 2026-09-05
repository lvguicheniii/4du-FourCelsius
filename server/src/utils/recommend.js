/**
 * 肆度推荐引擎。
 *
 * 展示温度仍由 temperature.js 负责；推荐排序不再直接使用已经包含时间
 * 回温的展示温度，避免同一份时间信号被衰减两次。
 */

const { parseCst } = require('../lib/time');
const { calculateTemperature } = require('./temperature');

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function ageHours(createdAt, nowMs = Date.now()) {
  const created = parseCst(createdAt);
  if (!created) return 0;
  return Math.max(0, (nowMs - created.getTime()) / 3_600_000);
}

function parseBoardIds(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  try {
    const parsed = JSON.parse(value || '[]');
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).map(String);
  } catch {
    return value ? [String(value)] : [];
  }
}

function extractTopic(content) {
  const match = String(content || '').match(/^#([^\s#\n]{1,40})/u);
  return match ? match[1] : '';
}

function stableUnit(seed) {
  let hash = 2166136261;
  const input = String(seed || '');
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function recommendSignals(post, context = {}) {
  const cools = Math.max(0, Number(post.likes_count ?? post.likes) || 0);
  const comments = Math.max(0, Number(post.comments_count ?? post.comments) || 0);
  const hours = ageHours(post.created_at ?? post.createdAt, context.nowMs);

  // 独立降温信号：与自然回温分离，25 次降温后趋于饱和。
  const coldQuality = clamp01(Math.log1p(cools) / Math.log1p(25));
  // 72 小时平滑衰减，不再让老内容在一小时边界突然跳变。
  const freshness = Math.exp(-hours / 72);
  // 评论与降温共同代表有效互动，但采用对数压缩避免头部垄断。
  const engagement = clamp01(Math.log1p(comments * 1.4 + cools * 0.45) / Math.log1p(20));

  return { coldQuality, freshness, engagement, hours };
}

function recommendScore(post, context = {}) {
  const signals = recommendSignals(post, context);
  const authorPostCount = Math.max(0, Number(post.author_post_count) || 0);
  const newAuthorBoost = authorPostCount > 0 && authorPostCount <= 2 ? 1 : 0;
  const boardAffinity = Math.max(0, ...parseBoardIds(post.board_id ?? post.boardId)
    .map((id) => Number(context.boardAffinity?.get(id)) || 0));
  const topic = extractTopic(post.content);
  const topicAffinity = topic ? Number(context.topicAffinity?.get(topic)) || 0 : 0;
  const interestAffinity = clamp01(boardAffinity * 0.65 + topicAffinity * 0.35);
  const followingAffinity = post.viewer_follows_author ? 1 : 0;
  const seenPenalty = clamp01(Number(context.seenPenalty?.get(post.id)) || 0);
  const impressionCount = Math.max(0, Number(post.impression_count) || 0);
  const exploration = stableUnit(`${context.seed}:explore:${post.id}`) / (1 + impressionCount / 8);
  const refrigerantBoost = clamp01((Number(post.refrigerant_boost_count) || 0) / 4);
  const score =
    signals.coldQuality * 0.36 +
    signals.freshness * 0.20 +
    signals.engagement * 0.14 +
    interestAffinity * 0.12 +
    followingAffinity * 0.08 +
    newAuthorBoost * 0.06 +
    exploration * 0.04 +
    refrigerantBoost * 0.10 -
    seenPenalty;
  return Math.round(score * 100000) / 1000;
}

function sortByRecommend(posts, context = {}) {
  return posts
    .map((post) => ({
      ...post,
      _score: recommendScore(post, context),
      _tie: stableUnit(`${context.seed || ''}:${post.id}`),
    }))
    .sort((a, b) => b._score - a._score || b._tie - a._tie || String(b.id).localeCompare(String(a.id)));
}

function diversifyAuthors(posts) {
  const output = [];
  const deferred = [];
  for (const post of posts) {
    const recent = output.slice(-9);
    const sameAuthor = recent.filter((item) => item.user_id === post.user_id).length;
    if (sameAuthor >= 2) deferred.push(post);
    else output.push(post);
  }
  // 候选不足时仍然完整返回，只把重复作者内容放到较后位置。
  return [...output, ...deferred];
}

function insertRescueSlots(posts, context = {}) {
  const arranged = [...posts];
  const rescueCandidates = posts
    .filter((post) => {
      const temperature = calculateTemperature(
        post.likes_count,
        post.created_at,
        post.updated_at,
        post.board_id,
        post.refrigerant_count,
      );
      return temperature >= 24 && temperature < 26;
    })
    .sort((a, b) => stableUnit(`${context.seed}:rescue:${b.id}`) - stableUnit(`${context.seed}:rescue:${a.id}`));
  const used = new Set();
  for (let slot = 8; slot < arranged.length; slot += 10) {
    const candidate = rescueCandidates.find((post) => !used.has(post.id) && arranged.findIndex((item) => item.id === post.id) > slot);
    if (!candidate) continue;
    used.add(candidate.id);
    const currentIndex = arranged.findIndex((post) => post.id === candidate.id);
    arranged.splice(currentIndex, 1);
    arranged.splice(slot, 0, { ...candidate, _rescue: true });
  }
  return arranged;
}

function arrangeRecommendations(posts, context = {}) {
  return insertRescueSlots(diversifyAuthors(sortByRecommend(posts, context)), context);
}

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    const offset = Number(parsed.offset);
    const nowMs = Number(parsed.nowMs);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isFinite(nowMs)) return null;
    return { offset, nowMs };
  } catch {
    return null;
  }
}

function recommendationSeed(userId, nowMs) {
  const day = Math.floor(nowMs / DAY_MS);
  return `${userId || 'guest'}:${day}`;
}

module.exports = {
  ageHours,
  parseBoardIds,
  extractTopic,
  stableUnit,
  recommendSignals,
  recommendScore,
  sortByRecommend,
  arrangeRecommendations,
  encodeCursor,
  decodeCursor,
  recommendationSeed,
};
