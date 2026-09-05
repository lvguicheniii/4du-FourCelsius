const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { triggerAchievement } = require('../lib/achievements');

const router = express.Router();

const CLIENT_EVENTS = new Set([
  'resonant_echo',
  'sentient_cable',
  'words_unsaid',
  'abyss_dive',
  'ground_state',
  'slice_salvage',
  'pelican_town_local',
]);

router.use(auth);

router.get('/', (req, res) => {
  const items = db.prepare(`
    SELECT d.key,d.name,d.hint,d.condition_text AS conditionText,
           d.is_hidden AS isHidden,d.sort_order AS sortOrder,
           CASE WHEN ua.user_id IS NULL THEN 0 ELSE 1 END AS unlocked,
           ua.unlocked_at AS unlockedAt,ua.trigger_count AS triggerCount,
           ua.last_triggered_at AS lastTriggeredAt
    FROM achievement_definitions d
    LEFT JOIN user_achievements ua
      ON ua.achievement_key=d.key AND ua.user_id=?
    ORDER BY d.sort_order,d.key
  `).all(req.userId).map(item => ({
    ...item,
    isHidden: !!item.isHidden,
    unlocked: !!item.unlocked,
    name: item.isHidden && !item.unlocked ? '???' : item.name,
    hint: item.unlocked ? item.hint : undefined,
    conditionText: item.unlocked ? item.conditionText : undefined,
  }));
  res.json({ achievements: items });
});

router.get('/events/pending', (req, res) => {
  const events = db.prepare(`
    SELECT id,achievement_key AS achievementKey,name_snapshot AS name,
           hint_snapshot AS hint,created_at AS createdAt
    FROM achievement_events
    WHERE user_id=? AND displayed_at IS NULL
    ORDER BY created_at ASC LIMIT 30
  `).all(req.userId);
  res.json({ events });
});

router.post('/events/ack', (req, res) => {
  const ids = Array.isArray(req.body.ids)
    ? req.body.ids.map(String).filter(Boolean).slice(0, 50)
    : [];
  if (!ids.length) return res.json({ ok: true, acknowledged: 0 });
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`
    UPDATE achievement_events SET displayed_at=datetime('now','+8 hours')
    WHERE user_id=? AND id IN (${placeholders})
  `).run(req.userId, ...ids);
  res.json({ ok: true, acknowledged: result.changes });
});

router.post('/events/:key', (req, res) => {
  const key = String(req.params.key || '');
  if (!CLIENT_EVENTS.has(key)) return res.status(400).json({ error: '该成就不能由客户端触发' });
  const result = triggerAchievement(db, req.userId, key, { ws: req.app.get('ws') });
  res.json({ ok: true, triggered: !!result });
});

module.exports = router;
