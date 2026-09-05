const db = require('../db');
const { nowCst } = require('./time');

const MAX_REFRIGERANT = 4;

function beijingDate() {
  return nowCst().slice(0, 10);
}

const claimDailyRefrigerant = db.transaction((userId) => {
  const user = db.prepare(`
    SELECT refrigerant_count, refrigerant_last_claim_date
    FROM users WHERE id = ?
  `).get(userId);
  if (!user) return { granted: false, count: 0 };

  const today = beijingDate();
  const current = Math.max(0, Math.min(MAX_REFRIGERANT, Number(user.refrigerant_count) || 0));
  if (user.refrigerant_last_claim_date === today) {
    return { granted: false, count: current };
  }

  const next = Math.min(
    MAX_REFRIGERANT,
    current + 1,
  );
  db.prepare(`
    UPDATE users
    SET refrigerant_count = ?, refrigerant_last_claim_date = ?
    WHERE id = ?
  `).run(next, today, userId);
  return { granted: next > current, count: next };
});

module.exports = { MAX_REFRIGERANT, claimDailyRefrigerant };
