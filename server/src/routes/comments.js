const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth, optionalAuth, requireNotMuted } = require('../middleware/auth');
const { replaceSensitiveWords } = require('../lib/content-filter');
const { sendPushToUser } = require('../lib/push');
const { assertCanReport } = require('../lib/entropy');
const { triggerAchievement } = require('../lib/achievements');
const { getUserIpRegion } = require('../lib/ip-region');
const { idempotent } = require('../middleware/idempotency');
const { rateLimit } = require('../middleware/rate-limit');
const { enqueueModeration } = require('../lib/moderation');
const { isApprovedMediaUrl } = require('../lib/media-ownership');

const router = Router();

function canonicalMediaUrl(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    const parsed = new URL(input);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return input.split(/[?#]/, 1)[0];
  }
}

function ownedSticker(userId, requestedUrl, req) {
  if (!isApprovedMediaUrl(requestedUrl, req)) return null;
  const canonical = canonicalMediaUrl(requestedUrl);
  if (!canonical) return null;
  return db.prepare('SELECT id,url FROM user_stickers WHERE user_id=?').all(userId)
    .find((item) => canonicalMediaUrl(item.url) === canonical) || null;
}

// 发表评论
const commentWriteLimit = rateLimit({ scope: 'comments.create', limit: 30, windowMs: 30 * 1000 });

router.post('/:postId', auth, requireNotMuted, idempotent('comments.create'), commentWriteLimit, (req, res) => {
  const kind = req.body?.kind === 'sticker' ? 'sticker' : 'text';
  const sticker = kind === 'sticker' ? ownedSticker(req.userId, req.body?.mediaUrl, req) : null;
  if (kind === 'sticker' && !sticker) return res.status(400).json({ error: '只能发送自己已添加的表情包' });
  const content = kind === 'sticker' ? String(req.body?.content || '[表情包]') : String(req.body?.content || '');
  if (!content.trim()) return res.status(400).json({ error: '评论不能为空' });

  const post = db.prepare(`
    SELECT p.id FROM posts p
    WHERE p.id = ? AND p.status = 'active'
      AND (COALESCE(p.visibility, 'public') = 'public' OR p.user_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=p.user_id)
           OR (b.user_id=p.user_id AND b.blocked_user_id=?)
      )
  `).get(req.params.postId, req.userId, req.userId, req.userId);
  if (!post) return res.status(404).json({ error: '帖子不存在' });

  const safeContent = replaceSensitiveWords(content);
  const mediaUrl = sticker?.url || '';
  const id = uuid();
  db.prepare('INSERT INTO comments (id, post_id, user_id, content, kind, media_url) VALUES (?,?,?,?,?,?)')
    .run(id, req.params.postId, req.userId, safeContent, kind, mediaUrl);
  try {
    enqueueModeration(db, {
      targetType: 'comment',
      targetId: id,
      authorId: req.userId,
      contentSnapshot: kind === 'text' ? safeContent : '',
      mediaSnapshot: kind === 'sticker' ? [mediaUrl] : [],
    });
  } catch (error) {
    console.error('Moderation task enqueue failed for comment:', error.message);
  }
  try {
    db.prepare(`
      INSERT INTO recommendation_events (user_id, post_id, event_type)
      VALUES (?, ?, 'comment')
    `).run(req.userId, req.params.postId);
  } catch {}

  // 通知帖子作者
  const postOwner = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.postId);
  if (postOwner && postOwner.user_id !== req.userId) {
    triggerAchievement(db, req.userId, 'make_ripples', { ws: req.app.get('ws') });
  }
  if (postOwner && postOwner.user_id !== req.userId) {
    const nick = req.user?.nickname || req.user?.username || '用户';
    const commentPreview = kind === 'sticker' ? '[表情包]' : String(safeContent).trim();
    const notificationContent = `${nick} 评论了你的切片：${commentPreview}`;
    db.prepare(`INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at) VALUES (?,?,'interaction',?,?,?,?,datetime('now','+8 hours'))`)
      .run(uuid(), postOwner.user_id, 'comment', '评论通知', notificationContent, req.params.postId);

    const ws = req.app.get('ws');
    if (ws) {
      ws.send(postOwner.user_id, {
        type: 'notification',
        category: 'interaction',
        notificationType: 'comment',
        title: '评论通知',
        content: notificationContent,
        relatedId: req.params.postId,
      });
    }
    sendPushToUser(postOwner.user_id, {
      title: '评论通知',
      body: notificationContent,
      data: { type: 'comment', postId: req.params.postId },
    });
  }

  const cmt = db.prepare(`
    SELECT c.*, u.username, u.nickname, u.avatar, u.gender, u.age, u.register_ip, u.last_login_ip
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `).get(id);

  req.app.get('ws')?.broadcastCoalesced?.(`post-stats:${req.params.postId}`, { type: 'post_stats_changed', relatedId: req.params.postId });

  res.status(201).json({
    id: cmt.id,
    userId: cmt.user_id,
    username: cmt.username,
    nickname: cmt.nickname || cmt.username,
    avatar: cmt.avatar,
    gender: cmt.gender || null,
    age: cmt.age,
    content: cmt.content,
    kind: cmt.kind || 'text',
    mediaUrl: cmt.media_url || '',
    createdAt: cmt.created_at,
    likes: cmt.likes_count || 0,
    liked: false,
    refrigerants: cmt.refrigerant_count || 0,
    ipRegion: getUserIpRegion(cmt),
  });
});

// 评论点赞独立于切片降温：使用 comment_likes，不触碰 posts/likes/temperature。
router.post('/:id/like', auth, idempotent('comments.like'), (req, res) => {
  const comment = db.prepare(`
    SELECT c.id, c.user_id, c.likes_count, c.post_id, u.nickname, u.username
    FROM comments c
    JOIN users u ON u.id = c.user_id
    JOIN posts p ON p.id = c.post_id
    WHERE c.id = ? AND c.status = 'active' AND p.status = 'active'
      AND (COALESCE(p.visibility,'public')='public' OR p.user_id=?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=p.user_id)
           OR (b.user_id=p.user_id AND b.blocked_user_id=?)
      )
  `).get(req.params.id, req.userId, req.userId, req.userId);
  if (!comment) return res.status(404).json({ error: '评论不存在' });

  const existing = db.prepare('SELECT 1 FROM comment_likes WHERE user_id = ? AND comment_id = ?')
    .get(req.userId, comment.id);
  const shouldLike = typeof req.body?.liked === 'boolean' ? req.body.liked : !existing;
  const changed = shouldLike !== !!existing;
  const result = db.transaction(() => {
    if (shouldLike) {
      db.prepare('INSERT OR IGNORE INTO comment_likes (user_id, comment_id) VALUES (?, ?)').run(req.userId, comment.id);
    } else {
      db.prepare('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?').run(req.userId, comment.id);
    }
    const count = db.prepare('SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?').get(comment.id).count;
    db.prepare('UPDATE comments SET likes_count = ? WHERE id = ?').run(count, comment.id);
    return count;
  })();

  if (changed && shouldLike && comment.user_id !== req.userId) {
    const nick = req.user?.nickname || req.user?.username || '用户';
    db.prepare(`
      INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at)
      VALUES (?, ?, 'interaction', 'comment_like', '评论点赞', ?, ?, datetime('now','+8 hours'))
    `).run(uuid(), comment.user_id, `${nick} 点赞了你的评论`, comment.post_id);
    const ws = req.app.get('ws');
    if (ws) ws.send(comment.user_id, {
      type: 'notification', category: 'interaction', notificationType: 'comment_like',
      title: '评论点赞', content: `${nick} 点赞了你的评论`, relatedId: comment.post_id,
    });
    sendPushToUser(comment.user_id, {
      title: '评论点赞',
      body: `${nick} 点赞了你的评论`,
      data: { type: 'comment_like', postId: comment.post_id },
    });
  }

  res.json({ liked: shouldLike, likes: result });
});

// 举报评论
router.post('/:id/report', auth, (req, res) => {
  const reportAccess = assertCanReport(db, req.userId);
  if (!reportAccess.ok) return res.status(reportAccess.status).json(reportAccess);
  const comment = db.prepare(`
    SELECT c.id,c.user_id FROM comments c
    JOIN posts p ON p.id=c.post_id
    WHERE c.id=? AND c.status='active' AND p.status='active'
      AND (COALESCE(p.visibility,'public')='public' OR p.user_id=?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=p.user_id)
           OR (b.user_id=p.user_id AND b.blocked_user_id=?)
      )
  `).get(req.params.id, req.userId, req.userId, req.userId);
  if (!comment) return res.status(404).json({ error: '评论不存在' });
  if (comment.user_id === req.userId) return res.status(400).json({ error: '不能举报自己的评论' });
  const duplicate = db.prepare(`
    SELECT id FROM comment_reports
    WHERE comment_id = ? AND reporter_id = ?
  `).get(req.params.id, req.userId);
  if (duplicate) return res.status(409).json({ error: '你已举报过这条评论' });
  const { reason, detail } = req.body;
  db.prepare(`
    INSERT INTO comment_reports (id, comment_id, reporter_id, reason, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuid(), req.params.id, req.userId, reason || 'other', detail || '');
  res.status(201).json({ ok: true });
});

// 获取帖子评论
router.get('/:postId', optionalAuth, (req, res) => {
  const viewerId = req.userId || '';
  const post = db.prepare(`
    SELECT p.id FROM posts p
    WHERE p.id = ? AND p.status = 'active'
      AND (COALESCE(p.visibility, 'public') = 'public' OR p.user_id = ?)
      AND (? = '' OR NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=p.user_id)
           OR (b.user_id=p.user_id AND b.blocked_user_id=?)
      ))
  `).get(req.params.postId, viewerId, viewerId, viewerId, viewerId);
  if (!post) return res.status(404).json({ error: '切片不存在' });
  const comments = db.prepare(`
    SELECT c.*, u.username, u.nickname, u.avatar, u.register_ip, u.last_login_ip
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ? AND c.status = 'active'
      AND (? = '' OR NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id=? AND b.blocked_user_id=c.user_id)
           OR (b.user_id=c.user_id AND b.blocked_user_id=?)
      ))
    ORDER BY c.created_at ASC
  `).all(req.params.postId, req.userId || '', req.userId || '', req.userId || '');

  res.json(comments.map(c => ({
    id: c.id,
    userId: c.user_id,
    username: c.username,
    nickname: c.nickname || c.username,
    avatar: c.avatar,
    content: c.content,
    kind: c.kind || 'text',
    mediaUrl: c.media_url || '',
    createdAt: c.created_at,
    likes: c.likes_count || 0,
    liked: req.userId ? !!db.prepare('SELECT 1 FROM comment_likes WHERE user_id = ? AND comment_id = ?').get(req.userId, c.id) : false,
    refrigerants: c.refrigerant_count || 0,
    ipRegion: getUserIpRegion(c),
  })));
});

// 删除评论
router.delete('/:id', auth, idempotent('comments.delete'), (req, res) => {
  const cmt = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!cmt) return res.status(404).json({ error: '评论不存在' });
  if (cmt.user_id !== req.userId) return res.status(403).json({ error: '无权操作' });

  db.prepare("UPDATE comments SET status='deleted' WHERE id = ?").run(req.params.id);
  req.app.get('ws')?.broadcastCoalesced?.(`post-stats:${cmt.post_id}`, { type: 'post_stats_changed', relatedId: cmt.post_id });
  res.json({ ok: true });
});

module.exports = router;
