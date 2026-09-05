const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth, optionalAuth, requireNotMuted } = require('../middleware/auth');
const { calculateTemperature } = require('../utils/temperature');
const {
  arrangeRecommendations,
  encodeCursor,
  decodeCursor,
  recommendationSeed,
  parseBoardIds,
  extractTopic,
} = require('../utils/recommend');
const { sendPushToUser } = require('../lib/push');
const { triggerAchievement } = require('../lib/achievements');
const { assertCanReport } = require('../lib/entropy');
const { formatCst } = require('../lib/time');
const { getUserIpRegion } = require('../lib/ip-region');
const { idempotent } = require('../middleware/idempotency');
const { isFeatureEnabled } = require('../lib/feature-flags');
const { enqueueModeration } = require('../lib/moderation');
const { isOwnedMediaUrl, sameMediaUrl } = require('../lib/media-ownership');
const { persistentRateLimit } = require('../middleware/persistent-rate-limit');

const router = Router();

function sliceBoxSummary(post) {
  if (!post.slice_box_id) return null;
  const box = db.prepare('SELECT id,name FROM slice_boxes WHERE id=?').get(post.slice_box_id);
  return box ? { id: box.id, name: box.name } : null;
}

function refrigerantBoostExpiresAt(post) {
  const row = db.prepare("SELECT MAX(expires_at) AS expires_at FROM post_refrigerant_boosts WHERE post_id=? AND expires_at > datetime('now','+8 hours')").get(post.id);
  return row?.expires_at || null;
}

function recordRecommendationEvent(userId, postId, eventType, dwellMs = 0, sessionId = '') {
  try {
    db.prepare(`
      INSERT INTO recommendation_events (user_id, session_id, post_id, event_type, dwell_ms)
      SELECT ?, ?, id, ?, ? FROM posts WHERE id = ?
    `).run(userId || null, String(sessionId || '').slice(0, 80), eventType, Math.max(0, Math.min(600000, Number(dwellMs) || 0)), postId);
  } catch {}
}

function buildRecommendationContext(userId, nowMs) {
  if (!userId) return {};
  const cutoff = formatCst(new Date(nowMs));
  const boardScores = new Map();
  const topicScores = new Map();
  const seenPenalty = new Map();
  const addInterest = (row, weight) => {
    for (const boardId of parseBoardIds(row.board_id)) {
      boardScores.set(boardId, (boardScores.get(boardId) || 0) + weight);
    }
    const topic = extractTopic(row.content);
    if (topic) topicScores.set(topic, (topicScores.get(topic) || 0) + weight);
  };

  const cooled = db.prepare(`
    SELECT p.board_id, p.content, p.id
    FROM post_cools action JOIN posts p ON p.id = action.post_id
    WHERE action.user_id = ? AND action.created_at <= ?
    ORDER BY action.created_at DESC LIMIT 200
  `).all(userId, cutoff);
  cooled.forEach((row) => {
    addInterest(row, 3);
    seenPenalty.set(row.id, Math.max(seenPenalty.get(row.id) || 0, 0.14));
  });

  const commented = db.prepare(`
    SELECT p.board_id, p.content, p.id
    FROM comments action JOIN posts p ON p.id = action.post_id
    WHERE action.user_id = ? AND action.created_at <= ? AND action.status = 'active'
    ORDER BY action.created_at DESC LIMIT 200
  `).all(userId, cutoff);
  commented.forEach((row) => {
    addInterest(row, 4);
    seenPenalty.set(row.id, Math.max(seenPenalty.get(row.id) || 0, 0.16));
  });

  const events = db.prepare(`
    SELECT e.post_id, e.event_type, e.dwell_ms, p.board_id, p.content
    FROM recommendation_events e JOIN posts p ON p.id = e.post_id
    WHERE e.user_id = ? AND e.created_at <= ?
    ORDER BY e.created_at DESC LIMIT 500
  `).all(userId, cutoff);
  events.forEach((row) => {
    if (row.event_type === 'open') addInterest(row, 1);
    if (row.event_type === 'dwell') addInterest(row, Math.min(3, Math.max(0.5, Number(row.dwell_ms) / 15000)));
    const penalty = row.event_type === 'impression' ? 0.05
      : row.event_type === 'open' ? 0.10
        : row.event_type === 'dwell' ? 0.13
          : row.event_type === 'report' ? 1
            : 0;
    if (penalty) seenPenalty.set(row.post_id, Math.max(seenPenalty.get(row.post_id) || 0, penalty));
  });

  const normalize = (scores) => {
    const max = Math.max(1, ...scores.values());
    return new Map([...scores].map(([key, value]) => [key, value / max]));
  };
  return {
    boardAffinity: normalize(boardScores),
    topicAffinity: normalize(topicScores),
    seenPenalty,
  };
}

// 用户降过温的所有帖子（必须在 /:id 之前）
// /liked 仅为旧版 App 兼容入口，实际语义和存储均为切片降温。
router.get(['/cooled', '/liked'], auth, (req, res) => {
  const likedPosts = db.prepare(`
    SELECT p.*, u.username, u.nickname, u.avatar, u.gender, u.age
    FROM post_cools l
    JOIN posts p ON l.post_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE l.user_id = ?
      AND p.status = 'active'
      AND (COALESCE(p.visibility, 'public') = 'public' OR p.user_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id = ? AND b.blocked_user_id = p.user_id)
           OR (b.user_id = p.user_id AND b.blocked_user_id = ?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM post_reports r WHERE r.post_id = p.id AND r.reporter_id = ?
      )
    ORDER BY l.created_at DESC
    LIMIT 200
  `).all(req.userId, req.userId, req.userId, req.userId, req.userId);

  const result = likedPosts.map(p => ({
    id: p.id,
    userId: p.user_id,
    username: p.username,
    nickname: p.nickname || p.username,
    avatar: p.avatar,
    content: p.content,
    images: JSON.parse(p.images || '[]'),
    thumbnails: JSON.parse(p.thumbnails || p.images || '[]'),
    livePhotos: JSON.parse(p.live_photos || '[]'),
    videoUrl: p.video_url || null,
    videoPoster: p.video_poster || null,
    videoMediaType: p.video_media_type || null,
    boardId: p.board_id,
    reefRoomId: p.reef_room_id || null,
    sliceBox: sliceBoxSummary(p),
    visibility: p.visibility || 'public',
    isPrivate: p.visibility === 'private',
    likes: p.likes_count,
    comments: db.prepare("SELECT COUNT(*) as c FROM comments WHERE post_id = ? AND status = 'active'").get(p.id).c,
    refrigerants: p.refrigerant_count || 0,
    refrigerantBoostExpiresAt: refrigerantBoostExpiresAt(p),
    liked: true,
    createdAt: p.created_at,
    temperature: calculateTemperature(p.likes_count, p.created_at, p.updated_at, p.board_id, p.refrigerant_count),
  }));

  res.json({ posts: result });
});

// 推荐流：服务端统一评分，并使用稳定快照游标分页。
router.get('/recommend', optionalAuth, (req, res) => {
  const limit = Math.min(30, Math.max(5, parseInt(req.query.limit, 10) || 20));
  const cursor = decodeCursor(req.query.cursor);
  const nowMs = cursor?.nowMs || Date.now();
  const offset = cursor?.offset || 0;
  const viewerId = req.userId || '__guest__';
  const snapshotTime = formatCst(new Date(nowMs));
  const posts = db.prepare(`
    SELECT p.*, u.username, u.nickname, u.avatar,
           COALESCE(p.comments_count, 0) AS comments_count,
           (SELECT COUNT(1) FROM posts author_posts
            WHERE author_posts.user_id = p.user_id AND author_posts.status = 'active') AS author_post_count,
           (SELECT COUNT(1) FROM recommendation_events impressions
            WHERE impressions.post_id = p.id
              AND impressions.event_type = 'impression'
              AND impressions.created_at <= ?) AS impression_count,
           (SELECT COUNT(1) FROM post_refrigerant_boosts boosts
            WHERE boosts.post_id = p.id AND boosts.expires_at > ?) AS refrigerant_boost_count,
           CASE WHEN viewer_cool.user_id IS NULL THEN 0 ELSE 1 END AS viewer_cooled,
           CASE WHEN viewer_follow.follower_id IS NULL THEN 0 ELSE 1 END AS viewer_follows_author
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN post_cools viewer_cool
      ON viewer_cool.post_id = p.id AND viewer_cool.user_id = ?
    LEFT JOIN follows viewer_follow
      ON viewer_follow.following_id = p.user_id AND viewer_follow.follower_id = ?
    WHERE p.status = 'active'
      AND p.board_id NOT LIKE '%announce%'
      AND (COALESCE(p.visibility, 'public') = 'public' OR p.user_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id = ? AND b.blocked_user_id = p.user_id)
           OR (b.user_id = p.user_id AND b.blocked_user_id = ?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM post_reports r
        WHERE r.post_id = p.id AND r.reporter_id = ?
      )
    ORDER BY p.created_at DESC
    LIMIT 500
  `).all(snapshotTime, snapshotTime, viewerId, viewerId, viewerId, viewerId, viewerId, viewerId);

  // 所有符合可见性与安全过滤条件的切片都参与排序。
  // 已融化或权重较低的切片只会自然排到后方，不再从推荐页彻底消失。
  const activePosts = posts;

  const sorted = arrangeRecommendations(activePosts, {
    nowMs,
    seed: recommendationSeed(req.userId, nowMs),
    ...buildRecommendationContext(req.userId, nowMs),
  });
  const page = sorted.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < sorted.length;

  const result = page.map(p => ({
    id: p.id,
    userId: p.user_id,
    username: p.username,
    nickname: p.nickname || p.username,
    avatar: p.avatar,
    content: p.content,
    images: JSON.parse(p.images || '[]'),
    thumbnails: JSON.parse(p.thumbnails || p.images || '[]'),
    livePhotos: JSON.parse(p.live_photos || '[]'),
    videoUrl: p.video_url || null,
    videoPoster: p.video_poster || null,
    videoMediaType: p.video_media_type || null,
    boardId: p.board_id,
    reefRoomId: p.reef_room_id || null,
    sliceBox: sliceBoxSummary(p),
    visibility: p.visibility || 'public',
    isPrivate: p.visibility === 'private',
    likes: p.likes_count,
    comments: p.comments_count,
    refrigerants: p.refrigerant_count || 0,
    refrigerantBoostExpiresAt: refrigerantBoostExpiresAt(p),
    liked: !!p.viewer_cooled,
    createdAt: p.created_at,
    temperature: calculateTemperature(p.likes_count, p.created_at, p.updated_at, p.board_id, p.refrigerant_count),
  }));

  res.json({
    posts: result,
    hasMore,
    nextCursor: hasMore ? encodeCursor({ offset: nextOffset, nowMs }) : null,
  });
});

const recommendationEventLimit = persistentRateLimit({
  scope: 'posts.recommend-events',
  limit: 120,
  windowMs: 10 * 60 * 1000,
});

router.post('/recommend/events', optionalAuth, recommendationEventLimit, (req, res) => {
  // Anonymous events must never influence global recommendation statistics.
  if (!req.userId) return res.status(202).json({ accepted: 0 });
  const allowed = new Set(['impression', 'open', 'dwell']);
  const events = Array.isArray(req.body.events) ? req.body.events.slice(0, 20) : [];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO recommendation_events (user_id, session_id, post_id, event_type, dwell_ms)
    SELECT ?, ?, id, ?, ? FROM posts WHERE id = ?
  `);
  let accepted = 0;
  db.transaction(() => {
    for (const event of events) {
      const eventType = String(event?.eventType || '');
      const postId = String(event?.postId || '');
      if (!allowed.has(eventType) || !postId) continue;
      const result = insert.run(
        req.userId,
        String(event?.sessionId || '').slice(0, 80),
        eventType,
        Math.max(0, Math.min(600000, Number(event?.dwellMs) || 0)),
        postId,
      );
      accepted += result.changes;
    }
  })();
  res.status(202).json({ accepted });
});

// 关注用户的帖子
router.get('/following', auth, (req, res) => {
  const followingPosts = db.prepare(`
    SELECT p.*, u.username, u.nickname, u.avatar
    FROM follows f
    JOIN posts p ON f.following_id = p.user_id
    JOIN users u ON p.user_id = u.id
    WHERE f.follower_id = ? AND p.status = 'active'
      AND COALESCE(p.visibility, 'public') = 'public'
      AND p.board_id != 'announce'
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id = ? AND b.blocked_user_id = p.user_id)
           OR (b.user_id = p.user_id AND b.blocked_user_id = ?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM post_reports r WHERE r.post_id = p.id AND r.reporter_id = ?
      )
    ORDER BY p.created_at DESC
    LIMIT 200
  `).all(req.userId, req.userId, req.userId, req.userId);

  const result = followingPosts.map(p => ({
    id: p.id, userId: p.user_id, username: p.username,
    nickname: p.nickname || p.username, avatar: p.avatar,
    content: p.content, images: JSON.parse(p.images || '[]'),
    thumbnails: JSON.parse(p.thumbnails || p.images || '[]'),
    livePhotos: JSON.parse(p.live_photos || '[]'),
    videoUrl: p.video_url || null, videoPoster: p.video_poster || null,
    videoMediaType: p.video_media_type || null,
    boardId: p.board_id, reefRoomId: p.reef_room_id || null, sliceBox: sliceBoxSummary(p), likes: p.likes_count,
    refrigerants: p.refrigerant_count || 0,
    refrigerantBoostExpiresAt: refrigerantBoostExpiresAt(p),
    visibility: p.visibility || 'public', isPrivate: p.visibility === 'private',
    comments: db.prepare("SELECT COUNT(*) as c FROM comments WHERE post_id = ? AND status = 'active'").get(p.id).c,
    liked: !!db.prepare('SELECT 1 FROM post_cools WHERE user_id = ? AND post_id = ?').get(req.userId, p.id),
    createdAt: p.created_at,
    temperature: calculateTemperature(p.likes_count, p.created_at, p.updated_at, p.board_id, p.refrigerant_count),
  }));

  res.json({ posts: result });
});

const POST_PUBLISH_COOLDOWN_SECONDS = 44;

function getPostPublishCooldown(userId) {
  const latest = db.prepare(`
    SELECT created_at,
           CAST((julianday(datetime('now','+8 hours')) - julianday(created_at)) * 86400 AS INTEGER) AS elapsed_seconds
    FROM posts
    WHERE user_id=?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId);
  if (!latest) return { canPublish: true, retryAfterSeconds: 0 };
  const elapsedSeconds = Math.max(0, Number(latest.elapsed_seconds) || 0);
  const retryAfterSeconds = Math.max(0, POST_PUBLISH_COOLDOWN_SECONDS - elapsedSeconds);
  return { canPublish: retryAfterSeconds === 0, retryAfterSeconds };
}

// 在上传媒体前先做轻量校验；真正写入时仍会再次校验，防止并发或改包绕过。
router.get('/publish-status', auth, (req, res) => {
  res.json(getPostPublishCooldown(req.userId));
});

// 发帖
router.post('/', auth, requireNotMuted, idempotent('posts.create'), (req, res) => {
  const { content, images, thumbnails, livePhotos, videoUrl, videoPoster, videoDurationMs, videoMediaId, videoMediaType, boardId, reefRoomId, sliceBoxId } = req.body;
  const imageList = Array.isArray(images) ? images : [];
  const livePhotoList = Array.isArray(livePhotos) ? livePhotos.slice(0, 9) : [];
  const thumbnailList = Array.isArray(thumbnails) ? thumbnails : imageList;
  if (imageList.length > 9 || thumbnailList.length !== imageList.length || imageList.some(value => !isOwnedMediaUrl(value, req.userId, req)) || thumbnailList.some(value => !isOwnedMediaUrl(value, req.userId, req))) {
    return res.status(400).json({ error: 'Post image upload is incomplete or invalid' });
  }
  if (livePhotoList.some(item => !item || !isOwnedMediaUrl(item.stillUrl, req.userId, req) || !isOwnedMediaUrl(item.motionUrl, req.userId, req))) {
    return res.status(400).json({ error: 'Live photo upload is incomplete or invalid' });
  }
  const isStandaloneVideo = !!videoUrl && videoMediaType !== 'live_photo';
  if (isStandaloneVideo && !isFeatureEnabled('video_upload', req.userId)) {
    return res.status(403).json({ error: '普通视频功能暂未开放' });
  }
  if (videoUrl && (imageList.length > 0 || livePhotoList.length > 0)) return res.status(400).json({ error: 'A post cannot contain both images and video' });
  if (!content && imageList.length === 0 && livePhotoList.length === 0 && !videoUrl && !reefRoomId) {
    return res.status(400).json({ error: '内容不能为空' });
  }

  const publishCooldown = getPostPublishCooldown(req.userId);
  if (!publishCooldown.canPublish) {
    res.set('Retry-After', String(publishCooldown.retryAfterSeconds));
    return res.status(429).json({
      error: '44秒内只能发布一份切片！',
      code: 'POST_PUBLISH_COOLDOWN',
      retryAfterSeconds: publishCooldown.retryAfterSeconds,
    });
  }

  const id = uuid();
  const imgs = JSON.stringify(imageList);
  const thumbs = JSON.stringify(thumbnailList);
  let sharedReefRoomId = '';
  if (reefRoomId) {
    const room = db.prepare("SELECT id,owner_id FROM reef_rooms WHERE id=? AND status='active'").get(String(reefRoomId));
    const participated = db.prepare('SELECT 1 FROM reef_members WHERE room_id=? AND user_id=?').get(String(reefRoomId), req.userId);
    if (!room || (!participated && room.owner_id !== req.userId)) return res.status(403).json({ error: '只能分享你参与或创建的礁石' });
    sharedReefRoomId = String(reefRoomId);
  }
  let selectedSliceBoxId = null;
  if (sliceBoxId) {
    const box = db.prepare('SELECT id FROM slice_boxes WHERE id=? AND user_id=?')
      .get(String(sliceBoxId), req.userId);
    if (!box) return res.status(403).json({ error: '只能将切片放入你自己的切片盒' });
    selectedSliceBoxId = box.id;
  }

  const selectedBoardIds = parseBoardIds(boardId || '["free"]');
  if (!selectedBoardIds.length || selectedBoardIds.length > 1) {
    return res.status(400).json({ error: '请选择一个有效冰格' });
  }
  const selectedBoard = db.prepare('SELECT id,is_active FROM boards WHERE id=?').get(selectedBoardIds[0]);
  if (!selectedBoard || selectedBoard.id === 'announce' || Number(selectedBoard.is_active) !== 1) {
    return res.status(409).json({ error: '该冰格已下架或不可用于制备切片' });
  }
  const normalizedBoardId = JSON.stringify(selectedBoardIds);

  if (videoUrl && !isOwnedMediaUrl(videoUrl, req.userId, req)) {
    return res.status(400).json({ error: '瑙嗛鏂囦欢灏氭湭涓婁紶' });
  }
  if (videoMediaId) {
    const media = db.prepare("SELECT id,media_type,playback_url,motion_url,poster_url FROM media_assets WHERE id=? AND owner_id=? AND context_type='post' AND media_type IN ('video','live_photo') AND status='ready'").get(String(videoMediaId), req.userId);
    if (!media) return res.status(400).json({ error: 'Video media record is invalid' });
    // iOS Live Photos arrive as a paired still + motion video, so the motion
    // asset is stored as `video` while the post keeps the semantic type.
    if (videoMediaType && videoMediaType !== media.media_type && !(videoMediaType === 'live_photo' && media.media_type === 'video')) return res.status(400).json({ error: 'Video media type is invalid' });
    if (videoUrl && !sameMediaUrl(videoUrl, media.motion_url || media.playback_url)) return res.status(400).json({ error: 'Video media record does not match the uploaded file' });
    if (videoPoster && media.poster_url && !sameMediaUrl(videoPoster, media.poster_url)) return res.status(400).json({ error: 'Video poster does not match the uploaded file' });
  }
  const livePhotosJson = JSON.stringify(livePhotoList.filter(item => item && item.stillUrl && item.motionUrl));
  db.prepare("INSERT INTO posts (id, user_id, content, images, thumbnails, live_photos, video_url, video_poster, video_duration_ms, video_media_id, video_media_type, board_id, reef_room_id, slice_box_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+8 hours'))")
    .run(id, req.userId, content || '', imgs, thumbs, livePhotosJson, videoUrl || null, videoPoster || null, Number(videoDurationMs) || null, videoMediaId || null, videoMediaType || null, normalizedBoardId, sharedReefRoomId || null, selectedSliceBoxId);

  // Content is intentionally visible immediately. Moderation is durable and asynchronous.
  try {
    enqueueModeration(db, {
      targetType: 'post',
      targetId: id,
      authorId: req.userId,
      contentSnapshot: content || '',
      mediaSnapshot: [...imageList, ...livePhotoList, ...(videoPoster ? [videoPoster] : [])],
    });
  } catch (error) {
    console.error('Moderation task enqueue failed for post:', error.message);
  }

  const post = getPost(id, req.userId);
  triggerAchievement(db, req.userId, 'prepare_slice', { ws: req.app.get('ws') });
  res.status(201).json(post);
});

// 获取帖子列表（首页信息流 / 冰格页）
// Move an existing post into one of the author's slice boxes (or remove it).
router.put('/:id/slice-box', auth, (req, res) => {
  const post = db.prepare("SELECT id FROM posts WHERE id=? AND user_id=? AND status='active'").get(req.params.id, req.userId);
  if (!post) return res.status(404).json({ error: 'Post not found or not owned by you' });
  const raw = req.body?.sliceBoxId;
  const sliceBoxId = raw == null || String(raw).trim() === '' ? null : String(raw).trim();
  if (sliceBoxId) {
    const box = db.prepare('SELECT id,name FROM slice_boxes WHERE id=? AND user_id=?').get(sliceBoxId, req.userId);
    if (!box) return res.status(400).json({ error: 'Slice box not found' });
  }
  db.prepare("UPDATE posts SET slice_box_id=?, updated_at=datetime('now','+8 hours') WHERE id=? AND user_id=?")
    .run(sliceBoxId, req.params.id, req.userId);
  const box = sliceBoxId ? db.prepare('SELECT id,name FROM slice_boxes WHERE id=?').get(sliceBoxId) : null;
  res.json({ sliceBox: box ? { id: box.id, name: box.name } : null });
});

router.get('/', optionalAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;
  const board = req.query.board;
  const userId = req.query.user_id;
  const sliceBoxId = String(req.query.slice_box_id || '').trim();

  let where = "p.status = 'active'";
  const params = [];
  if (sliceBoxId) {
    const box = db.prepare('SELECT id,user_id FROM slice_boxes WHERE id=?').get(sliceBoxId);
    if (!box) return res.status(404).json({ error: '切片盒不存在' });
    where += ' AND p.slice_box_id = ? AND p.user_id = ?';
    params.push(sliceBoxId, box.user_id);
    if (box.user_id !== req.userId) where += " AND COALESCE(p.visibility, 'public') = 'public'";
  } else if (userId) {
    where += " AND p.user_id = ?";
    params.push(userId);
    if (userId !== req.userId) where += " AND COALESCE(p.visibility, 'public') = 'public'";
  } else if (board) {
    where += ` AND (
      p.board_id = ?
      OR (
        json_valid(p.board_id)
        AND EXISTS (SELECT 1 FROM json_each(p.board_id) WHERE json_each.value = ?)
      )
    )`;
    params.push(String(board), String(board));
  }
  if (!userId && !sliceBoxId) {
    where += " AND COALESCE(p.visibility, 'public') = 'public'";
  }
  const viewerId = req.userId || '__guest__';
  where += ` AND NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.user_id = ? AND b.blocked_user_id = p.user_id)
       OR (b.user_id = p.user_id AND b.blocked_user_id = ?)
  ) AND NOT EXISTS (
    SELECT 1 FROM post_reports r WHERE r.post_id = p.id AND r.reporter_id = ?
  )`;
  params.push(viewerId, viewerId, viewerId);
  params.push(limit, offset);

  const posts = db.prepare(`
    SELECT p.*, u.username, u.nickname, u.avatar
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE ${where}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);

  const result = posts.map(p => ({
    id: p.id,
    userId: p.user_id,
    username: p.username,
    nickname: p.nickname || p.username,
    avatar: p.avatar,
    content: p.content,
    images: JSON.parse(p.images || '[]'),
    thumbnails: JSON.parse(p.thumbnails || p.images || '[]'),
    livePhotos: JSON.parse(p.live_photos || '[]'),
    videoUrl: p.video_url || null,
    videoPoster: p.video_poster || null,
    videoMediaType: p.video_media_type || null,
    boardId: p.board_id,
    reefRoomId: p.reef_room_id || null,
    sliceBox: sliceBoxSummary(p),
    visibility: p.visibility || 'public',
    isPrivate: p.visibility === 'private',
    likes: p.likes_count,
    comments: db.prepare("SELECT COUNT(*) as c FROM comments WHERE post_id = ? AND status = 'active'").get(p.id).c,
    refrigerants: p.refrigerant_count || 0,
    refrigerantBoostExpiresAt: refrigerantBoostExpiresAt(p),
    liked: req.userId ? !!db.prepare('SELECT 1 FROM post_cools WHERE user_id = ? AND post_id = ?').get(req.userId, p.id) : false,
    createdAt: p.created_at,
    temperature: calculateTemperature(p.likes_count, p.created_at, p.updated_at, p.board_id, p.refrigerant_count),
  }));

  res.json({ posts: result, hasMore: result.length === limit });
});

// 话题切片流：只匹配正文第一行的完整 #话题，避免相似话题串联。
router.get('/topic/:topic', optionalAuth, (req, res) => {
  const topicName = String(req.params.topic || '').trim().replace(/^#/, '').slice(0, 80);
  if (!topicName) return res.status(400).json({ error: '话题不能为空' });
  const topic = `#${topicName}`;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(10, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const viewerId = req.userId || '__guest__';
  const rows = db.prepare(`
    SELECT p.*,u.username,u.nickname,u.avatar
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.status='active'
      AND (COALESCE(p.visibility,'public')='public' OR p.user_id=?)
      AND (p.content=? OR substr(p.content,1,length(?)+1)=? || char(10))
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=p.user_id)
           OR (b.user_id=p.user_id AND b.blocked_user_id=?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM post_reports r WHERE r.post_id=p.id AND r.reporter_id=?
      )
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(viewerId, topic, topic, topic, viewerId, viewerId, viewerId, limit, offset);
  const posts = rows.map(p => ({
    id:p.id,userId:p.user_id,username:p.username,nickname:p.nickname||p.username,avatar:p.avatar,
    content:p.content,images:JSON.parse(p.images||'[]'),thumbnails:JSON.parse(p.thumbnails||p.images||'[]'),livePhotos:JSON.parse(p.live_photos||'[]'),videoUrl:p.video_url||null,videoPoster:p.video_poster||null,videoMediaType:p.video_media_type||null,
    boardId:p.board_id,reefRoomId:p.reef_room_id||null,sliceBox:sliceBoxSummary(p),visibility:p.visibility||'public',isPrivate:p.visibility==='private',
    likes:p.likes_count,comments:db.prepare("SELECT COUNT(*) as c FROM comments WHERE post_id=? AND status='active'").get(p.id).c,
    liked:req.userId?!!db.prepare('SELECT 1 FROM post_cools WHERE user_id=? AND post_id=?').get(req.userId,p.id):false,
    createdAt:p.created_at,temperature:calculateTemperature(p.likes_count,p.created_at,p.updated_at,p.board_id,p.refrigerant_count),
  }));
  res.json({ topic, posts, hasMore: posts.length === limit });
});

// 潜流：温度>16°C的帖子
router.get('/undercurrent', optionalAuth, (req, res) => {
  const viewerId = req.userId || '__guest__';
  const gender = ['male', 'female'].includes(req.query.gender) ? req.query.gender : '';
  const posts = db.prepare(`
    SELECT p.*, u.nickname, u.username, u.avatar
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.status = 'active' AND COALESCE(p.visibility, 'public') = 'public'
      AND p.user_id != ?
      AND (? = '' OR u.gender = ?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id = ? AND b.blocked_user_id = p.user_id)
           OR (b.user_id = p.user_id AND b.blocked_user_id = ?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM post_reports r WHERE r.post_id = p.id AND r.reporter_id = ?
      )
    ORDER BY p.updated_at DESC
    LIMIT 100
  `).all(viewerId, gender, gender, viewerId, viewerId, viewerId);
  const result = posts.map(p => {
    const temp = calculateTemperature(p.likes_count, p.created_at, p.updated_at, p.board_id, p.refrigerant_count);
    return {
      id: p.id, content: p.content, images: JSON.parse(p.images || '[]'), livePhotos: JSON.parse(p.live_photos || '[]'), videoUrl: p.video_url || null, videoPoster: p.video_poster || null, videoMediaType: p.video_media_type || null,
      boardId: p.board_id, reefRoomId: p.reef_room_id || null, sliceBox: sliceBoxSummary(p), likes: p.likes_count, comments: p.comments_count,
      refrigerants: p.refrigerant_count || 0,
      refrigerantBoostExpiresAt: refrigerantBoostExpiresAt(p),
      visibility: p.visibility || 'public', isPrivate: p.visibility === 'private',
      liked: req.userId ? !!db.prepare('SELECT 1 FROM post_cools WHERE user_id = ? AND post_id = ?').get(req.userId, p.id) : false,
      temperature: temp, createdAt: p.created_at,
      username: p.username, nickname: p.nickname, avatar: p.avatar, userId: p.user_id,
    };
  }).filter(p => p.temperature > 16);
  res.json({ posts: result });
});

// 潜流胶囊文案库
router.get('/capsule-texts', optionalAuth, (req, res) => {
  const texts = db.prepare('SELECT id, text FROM capsule_texts ORDER BY id').all();
  res.json({ texts });
});

// 获取帖子详情
router.get('/:id', optionalAuth, (req, res) => {
  const post = getPost(req.params.id, req.userId);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  res.json(post);
});

router.put('/:id/visibility', auth, (req, res) => {
  const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  if (post.user_id !== req.userId) return res.status(403).json({ error: '无权操作' });
  const visibility = req.body.visibility === 'private' ? 'private' : 'public';
  db.prepare("UPDATE posts SET visibility = ?, updated_at = datetime('now','+8 hours') WHERE id = ?")
    .run(visibility, req.params.id);
  res.json({ ok: true, visibility, isPrivate: visibility === 'private' });
});

// 删除帖子
router.delete('/:id', auth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  if (post.user_id !== req.userId) return res.status(403).json({ error: '无权操作' });

  db.prepare(`
    UPDATE posts
    SET status='deleted', delete_reason='用户主动删除', deleted_at=datetime('now','+8 hours'), updated_at=datetime('now','+8 hours')
    WHERE id=?
  `).run(req.params.id);
  res.json({ ok: true });
});

// 点赞/取消点赞
// /:id/like 仅为旧版 App 兼容入口；新代码统一调用 /cool。
router.post(['/:id/cool', '/:id/like'], auth, idempotent('posts.cool'), (req, res) => {
  const post = db.prepare(`
    SELECT p.id,p.user_id FROM posts p
    WHERE p.id=? AND p.status='active'
      AND (COALESCE(p.visibility,'public')='public' OR p.user_id=?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=p.user_id)
           OR (b.user_id=p.user_id AND b.blocked_user_id=?)
      )
  `).get(req.params.id, req.userId, req.userId, req.userId);
  if (!post) return res.status(404).json({ error: '帖子不存在' });

  const existing = db.prepare('SELECT 1 FROM post_cools WHERE user_id = ? AND post_id = ?').get(req.userId, req.params.id);

  const shouldCool = typeof req.body?.cooled === 'boolean' ? req.body.cooled : !existing;
  const changed = shouldCool !== !!existing;
  const newLikes = db.transaction(() => {
    if (shouldCool) {
      db.prepare('INSERT OR IGNORE INTO post_cools (user_id, post_id) VALUES (?,?)').run(req.userId, req.params.id);
    } else {
      db.prepare('DELETE FROM post_cools WHERE user_id = ? AND post_id = ?').run(req.userId, req.params.id);
    }
    const count = db.prepare('SELECT COUNT(*) AS count FROM post_cools WHERE post_id = ?').get(req.params.id).count;
    db.prepare("UPDATE posts SET likes_count = ?, updated_at = datetime('now','+8 hours') WHERE id = ?").run(count, req.params.id);
    return count;
  })();

  if (changed && shouldCool) {
    recordRecommendationEvent(req.userId, req.params.id, 'cool');
    if (post.user_id !== req.userId) {
      triggerAchievement(db, req.userId, 'active_cooling', { ws: req.app.get('ws') });
    }
    // 通知帖子作者
    const postOwner = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id);
    if (postOwner && postOwner.user_id !== req.userId) {
      const nick = req.user?.nickname || req.user?.username || '用户';
      db.prepare(`INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at) VALUES (?,?,'interaction',?,?,?,?,datetime('now','+8 hours'))`)
        .run(uuid(), postOwner.user_id, 'like', '降温通知', `${nick}给你的切片降温了！`, req.params.id);
      // WebSocket 实时推送
      const ws = req.app.get('ws');
      if (ws) {
        ws.send(postOwner.user_id, {
          type: 'notification',
          category: 'interaction',
          title: '降温通知',
          content: `${nick}给你的切片降温了！`,
          relatedId: req.params.id,
        });
      }
      sendPushToUser(postOwner.user_id, {
        title: '降温通知',
        body: `${nick}给你的切片降温了！`,
        data: { type: 'cool', postId: req.params.id },
      });
    }
  }
  res.json({ liked: shouldCool, likes: newLikes });
});

// 举报帖子
router.post('/:id/report', auth, (req, res) => {
  const reportAccess = assertCanReport(db, req.userId);
  if (!reportAccess.ok) return res.status(reportAccess.status).json(reportAccess);
  const post = db.prepare(`
    SELECT p.id,p.user_id FROM posts p
    WHERE p.id=? AND p.status='active'
      AND (COALESCE(p.visibility,'public')='public' OR p.user_id=?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=p.user_id)
           OR (b.user_id=p.user_id AND b.blocked_user_id=?)
      )
  `).get(req.params.id, req.userId, req.userId, req.userId);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  if (post.user_id === req.userId) return res.status(400).json({ error: '不能举报自己的切片' });

  const existing = db.prepare('SELECT id FROM post_reports WHERE post_id = ? AND reporter_id = ?')
    .get(req.params.id, req.userId);
  if (existing) return res.status(409).json({ error: '你已经举报过该帖子' });

  const { reason, detail } = req.body;
  const id = uuid();
  db.prepare('INSERT INTO post_reports (id, post_id, reporter_id, reason, detail) VALUES (?,?,?,?,?)')
    .run(id, req.params.id, req.userId, reason || 'other', detail || '');
  db.prepare('UPDATE posts SET report_count = report_count + 1, status = CASE WHEN report_count >= 3 THEN ? ELSE status END WHERE id = ?')
    .run('reported', req.params.id);
  recordRecommendationEvent(req.userId, req.params.id, 'report');

  res.status(201).json({ ok: true });
});

// 辅助：获取单帖详情
function getPost(id, userId) {
  const p = db.prepare(`
    SELECT p.*, u.username, u.nickname, u.avatar, u.gender, u.age
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ? AND p.status = 'active'
  `).get(id);
  if (!p) return null;
  if (p.visibility === 'private' && p.user_id !== userId) return null;
  if (userId) {
    const hiddenByBlock = db.prepare(`
      SELECT 1 FROM blocks
      WHERE (user_id = ? AND blocked_user_id = ?)
         OR (user_id = ? AND blocked_user_id = ?)
    `).get(userId, p.user_id, p.user_id, userId);
    const reportedByViewer = db.prepare(
      'SELECT 1 FROM post_reports WHERE post_id = ? AND reporter_id = ?',
    ).get(p.id, userId);
    if (hiddenByBlock || reportedByViewer) return null;
  }

  const comments = db.prepare(`
    SELECT c.*, u.username, u.nickname, u.avatar, u.gender, u.age, u.register_ip, u.last_login_ip
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ? AND c.status = 'active'
      AND (? = '' OR NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=c.user_id)
           OR (b.user_id=c.user_id AND b.blocked_user_id=?)
      ))
    ORDER BY c.created_at DESC
  `).all(id, userId || '', userId || '', userId || '');

  return {
    id: p.id,
    userId: p.user_id,
    username: p.username,
    nickname: p.nickname || p.username,
    avatar: p.avatar,
    gender: p.gender || null,
    age: p.age,
    content: p.content,
    images: JSON.parse(p.images || '[]'),
    thumbnails: JSON.parse(p.thumbnails || p.images || '[]'),
    livePhotos: JSON.parse(p.live_photos || '[]'),
    videoUrl: p.video_url || null,
    videoPoster: p.video_poster || null,
    videoMediaType: p.video_media_type || null,
    boardId: p.board_id,
    reefRoomId: p.reef_room_id || null,
    sliceBox: sliceBoxSummary(p),
    visibility: p.visibility || 'public',
    isPrivate: p.visibility === 'private',
    likes: p.likes_count,
    refrigerants: p.refrigerant_count || 0,
    refrigerantBoostExpiresAt: refrigerantBoostExpiresAt(p),
    liked: userId ? !!db.prepare('SELECT 1 FROM post_cools WHERE user_id = ? AND post_id = ?').get(userId, p.id) : false,
    comments: comments.map(c => ({
      id: c.id,
      userId: c.user_id,
      username: c.username,
      nickname: c.nickname || c.username,
      avatar: c.avatar,
      gender: c.gender || null,
      age: c.age,
      content: c.content,
      kind: c.kind || 'text',
      mediaUrl: c.media_url || '',
      createdAt: c.created_at,
      likes: c.likes_count || 0,
      liked: userId ? !!db.prepare('SELECT 1 FROM comment_likes WHERE user_id = ? AND comment_id = ?').get(userId, c.id) : false,
      refrigerants: c.refrigerant_count || 0,
      ipRegion: getUserIpRegion(c),
    })),
    createdAt: p.created_at,
    temperature: calculateTemperature(p.likes_count, p.created_at, p.updated_at, p.board_id, p.refrigerant_count),
  };
}

module.exports = router;
