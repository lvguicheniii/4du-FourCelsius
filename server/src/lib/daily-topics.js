function reconcileDailyTopics(db) {
  return db.prepare(`
    UPDATE daily_themes
    SET status = CASE
      WHEN theme_date = date('now','+8 hours') THEN 'active'
      WHEN theme_date > date('now','+8 hours') THEN 'pending'
      ELSE 'expired'
    END
    WHERE status != 'disabled'
  `).run();
}

module.exports = { reconcileDailyTopics };
