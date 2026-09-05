const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { nowCst, addCst } = require('../lib/time');
const { MAX_REFRIGERANT, claimDailyRefrigerant } = require('../lib/refrigerant');
const { sendPushToUser } = require('../lib/push');
const { isFeatureEnabled } = require('../lib/feature-flags');
const { incrementMilestone, triggerAchievement } = require('../lib/achievements');
const { idempotent } = require('../middleware/idempotency');
const { getFrostShellState } = require('../lib/frost-shell');
const { handleGift } = require('./frost-shells');

const router = Router();

router.get('/', auth, (req, res) => {
  const daily = claimDailyRefrigerant(req.userId);
  const shells = getFrostShellState(db, req.userId);
  res.json({
    count: daily.count,
    dailyCount: daily.count,
    giftedCount: shells.eternalCount,
    eternalCount: shells.eternalCount,
    fragileCount: shells.fragileCount,
    max: MAX_REFRIGERANT,
    dailyGranted: daily.granted,
  });
});

router.post('/use-on-post/:postId', auth, idempotent('refrigerant.use-on-post'), (req, res) => {
  if (!isFeatureEnabled('refrigerant_boost', req.userId)) {
    return res.status(404).json({ error: '该功能暂未开放' });
  }

  const post = db.prepare(`
    SELECT p.id, p.user_id, p.refrigerant_count
    FROM posts p
    WHERE p.id = ?
      AND p.status = 'active'
      AND (COALESCE(p.visibility, 'public') = 'public' OR p.user_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.user_id = ? AND b.blocked_user_id = p.user_id)
           OR (b.user_id = p.user_id AND b.blocked_user_id = ?)
      )
  `).get(req.params.postId, req.userId, req.userId, req.userId);
  if (!post) return res.status(404).json({ error: '切片不存在或已失效' });

  claimDailyRefrigerant(req.userId);
  const usedOnDate = nowCst().slice(0, 10);
  const expiresAt = addCst({ hours: 6 });

  try {
    db.transaction(() => {
      const activeBoost = db.prepare(`
        SELECT expires_at FROM post_refrigerant_boosts
        WHERE post_id = ? AND expires_at > datetime('now','+8 hours')
        ORDER BY expires_at DESC LIMIT 1
      `).get(post.id);
      if (activeBoost) {
        const error = new Error('这条切片在制冷剂加权期间内已经使用过制冷剂，请等待6小时后再试');
        error.status = 409;
        throw error;
      }

      const dailyUse = db.prepare(`
        INSERT OR IGNORE INTO post_refrigerant_daily_uses(post_id, use_date, user_id)
        VALUES (?, ?, ?)
      `).run(post.id, usedOnDate, req.userId);
      if (dailyUse.changes !== 1) {
        const error = new Error('这份切片今天已经使用过制冷剂，请明天再试');
        error.status = 409;
        throw error;
      }

      const inventory = db.prepare('SELECT refrigerant_count FROM users WHERE id = ?').get(req.userId);
      if ((Number(inventory?.refrigerant_count) || 0) < 1) {
        const error = new Error('制冷剂不足，明天登录可再获得一瓶');
        error.status = 409;
        throw error;
      }

      db.prepare('UPDATE users SET refrigerant_count = refrigerant_count - 1 WHERE id = ?').run(req.userId);
      db.prepare('UPDATE posts SET refrigerant_count = refrigerant_count + 1 WHERE id = ?').run(post.id);
      db.prepare('INSERT INTO post_refrigerant_boosts(id, post_id, user_id, expires_at) VALUES (?,?,?,?)')
        .run(`boost_${uuid()}`, post.id, req.userId, expiresAt);
    })();
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || '制冷剂使用失败' });
  }

  const user = db.prepare('SELECT refrigerant_count FROM users WHERE id = ?').get(req.userId);
  const updated = db.prepare('SELECT refrigerant_count FROM posts WHERE id = ?').get(post.id);
  const achievementOptions = { ws: req.app.get('ws') };
  triggerAchievement(db, req.userId, 'r600a', achievementOptions);
  incrementMilestone(db, req.userId, 'refrigerant_uses', 'absolute_zero', 10, achievementOptions);

  if (post.user_id !== req.userId) {
    const actor = db.prepare('SELECT nickname, username FROM users WHERE id = ?').get(req.userId);
    const nick = actor?.nickname || actor?.username || '用户';
    const content = `${nick}对你的切片使用了1瓶制冷剂！你的切片将在6小时内获得推荐加权！`;
    db.prepare(`
      INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at)
      VALUES (?, ?, 'interaction', ?, ?, ?, ?, datetime('now','+8 hours'))
    `).run(uuid(), post.user_id, 'refrigerant', '制冷剂通知', content, post.id);
    const ws = req.app.get('ws');
    if (ws) ws.send(post.user_id, {
      type: 'notification',
      category: 'interaction',
      notificationType: 'refrigerant',
      title: '制冷剂通知',
      content,
      relatedId: post.id,
    });
    sendPushToUser(post.user_id, {
      title: '制冷剂通知',
      body: content,
      data: { type: 'refrigerant', postId: post.id },
    });
  }

  res.json({
    ok: true,
    remaining: Number(user?.refrigerant_count) || 0,
    refrigerants: Number(updated?.refrigerant_count) || 0,
    expiresAt,
  });
});

router.post('/gift', auth, idempotent('refrigerant.gift'), handleGift);

module.exports = router;
