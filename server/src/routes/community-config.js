const { Router } = require('express');
const db = require('../db');
const { optionalAuth } = require('../middleware/auth');
const { getFeatureState, isFeatureEnabled } = require('../lib/feature-flags');

const router = Router();

router.get('/', optionalAuth, (req, res) => {
  const boards = db.prepare(`
    SELECT id,name,description as desc,icon,color,color_dark as colorDark,category,is_active as active
    FROM boards
    ORDER BY CASE category
      WHEN '情绪' THEN 1 WHEN '共鸣' THEN 2 WHEN '兴趣' THEN 3
      WHEN '生活' THEN 4 WHEN '404' THEN 5 ELSE 6 END, sort, name
  `).all();
  const topics = db.prepare('SELECT id,name FROM topics ORDER BY sort,name').all();
  const dailyTopicEnabled = isFeatureEnabled('daily_theme', req.userId);
  const dailyTopic = dailyTopicEnabled
    ? db.prepare("SELECT id,title,theme_date as themeDate FROM daily_themes WHERE status!='disabled' AND theme_date=date('now','+8 hours') LIMIT 1").get() || null
    : null;
  const dailyTopicHistory = dailyTopicEnabled
    ? db.prepare("SELECT id,title,theme_date as themeDate FROM daily_themes WHERE status!='disabled' AND theme_date<date('now','+8 hours') ORDER BY theme_date DESC LIMIT 120").all()
    : [];
  res.json({ boards, topics, features: getFeatureState(req.userId), dailyTopic, dailyTopicHistory });
});

module.exports = router;
