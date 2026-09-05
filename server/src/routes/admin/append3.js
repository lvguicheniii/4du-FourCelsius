const { getAchievementProgramCondition } = require('../../lib/achievement-program-conditions');

module.exports = function registerAdminAppend3(router, { adminAuth, db, logAdmin }) {
  router.get('/achievements', adminAuth, (req, res) => {
    const achievements = db.prepare(`
      SELECT d.key,d.name,d.hint,d.condition_text AS conditionText,
             d.is_hidden AS isHidden,d.sort_order AS sortOrder,
             COUNT(ua.user_id) AS unlockedUsers,
             COALESCE(SUM(ua.trigger_count),0) AS triggerCount
      FROM achievement_definitions d
      LEFT JOIN user_achievements ua ON ua.achievement_key=d.key
      GROUP BY d.key
      ORDER BY d.sort_order,d.key
    `).all().map(item => ({
      ...item,
      isHidden: !!item.isHidden,
      programConditionText: getAchievementProgramCondition(item.key),
    }));
    res.json({ achievements });
  });

  router.put('/achievements/:key', adminAuth, (req, res) => {
    const current = db.prepare('SELECT * FROM achievement_definitions WHERE key=?').get(req.params.key);
    if (!current) return res.status(404).json({ error: '成就不存在' });
    const name = String(req.body.name ?? current.name).trim();
    const hint = String(req.body.hint ?? current.hint).trim();
    const conditionText = String(req.body.conditionText ?? current.condition_text).trim();
    const isHidden = req.body.isHidden === true || req.body.isHidden === 1 ? 1 : 0;
    if (!name || name.length > 30) return res.status(400).json({ error: '成就名称需要为1至30个字符' });
    if (!hint || hint.length > 160) return res.status(400).json({ error: '提示语需要为1至160个字符' });
    if (!conditionText || conditionText.length > 300) return res.status(400).json({ error: '外显达成条件需要为1至300个字符' });
    db.prepare(`
      UPDATE achievement_definitions
      SET name=?,hint=?,condition_text=?,is_hidden=?,updated_at=datetime('now','+8 hours')
      WHERE key=?
    `).run(name, hint, conditionText, isHidden, current.key);
    logAdmin(
      req.adminId,
      'update_achievement',
      'achievement',
      current.key,
      `更新成就“${name}”${isHidden ? '（隐藏）' : ''}`,
      req.ip,
    );
    res.json({ ok: true });
  });
};
