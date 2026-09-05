const { v4: uuid } = require('uuid');
const { addCst, parseCst } = require('./time');

const LEVELS = [
  {
    level: 0,
    threshold: 0,
    title: '浅海漂流客',
    english: 'Shallow Sea Drifter',
    description: '您当前处于自由漂流状态。享受 26°C 的微风吧。',
  },
  {
    level: 1,
    threshold: 100,
    title: '浮霜清道夫',
    english: 'Frost Scavenger',
    description: '恭喜，您已获得一把官方配发的赛博捞网。虽然只能清理水面上的浮冰和杂质，但维持浅水区的体面，是每个清道夫的骄傲。',
  },
  {
    level: 2,
    threshold: 500,
    title: '隐礁巡航卫',
    english: 'Hidden Reef Patrol Guard',
    description: '隐海的礁石危机四伏，系统已为您配备防撞击潜水服。请注意，您的任务是维护边界，而不是在礁石里和别人吵架。',
  },
  {
    level: 3,
    threshold: 2000,
    title: '潜流探测员',
    english: 'Undercurrent Explorer',
    description: '您已深入极少有人踏足的潜流域。这里的噪音极小。系统已为您的探测仪开启高频声呐，请保持极度的理智与冷酷。',
  },
  {
    level: 4,
    threshold: 10000,
    title: '肆度守望者',
    english: '4°C Watcher',
    description: '您已与这片深海融为一体。您不再是观测者，您就是 4°C 秩序本身。请静静注视这片海域，直到宇宙的尽头！',
  },
];

function getEntropyState(user = {}) {
  const value = Number(user.calibration_value) || 0;
  const permanentLv4 = !!user.entropy_lv4_earned;
  let current = LEVELS[0];
  for (const level of LEVELS) {
    if (value >= level.threshold) current = level;
  }
  if (permanentLv4) current = LEVELS[4];
  const next = current.level < 4 ? LEVELS[current.level + 1] : null;
  const progress = next
    ? Math.max(0, Math.min(1, (value - current.threshold) / (next.threshold - current.threshold)))
    : 1;
  const cooldownUntil = user.report_cooldown_until || null;
  const cooldownActive = !!cooldownUntil && (parseCst(cooldownUntil)?.getTime() || 0) > Date.now();
  return {
    value,
    level: current.level,
    title: current.title,
    english: current.english,
    description: current.description,
    currentThreshold: current.threshold,
    nextThreshold: next?.threshold ?? null,
    nextTitle: next?.title ?? null,
    progress,
    invalidReportCount: Number(user.invalid_report_count) || 0,
    damaged: value < 0,
    reportCooldownUntil: cooldownUntil,
    reportCooldownActive: cooldownActive,
    permanentLv4,
  };
}

function assertCanReport(db, userId) {
  const user = db.prepare(`
    SELECT calibration_value, report_cooldown_until
    FROM users WHERE id = ?
  `).get(userId);
  if (!user) return { ok: false, status: 404, error: '用户不存在' };
  const until = user.report_cooldown_until;
  if (until && (parseCst(until)?.getTime() || 0) > Date.now()) {
    return {
      ok: false,
      status: 429,
      error: '设备修复中，暂时无法发射举报信号。',
      reportCooldownUntil: until,
    };
  }
  if (until) db.prepare('UPDATE users SET report_cooldown_until = NULL WHERE id = ?').run(userId);
  return { ok: true };
}

function insertSystemNotification(db, userId, type, title, content, relatedId) {
  const id = uuid();
  db.prepare(`
    INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at)
    VALUES (?, ?, 'system', ?, ?, ?, ?, datetime('now','+8 hours'))
  `).run(id, userId, type, title, content, relatedId || '');
  return { id, userId, type, title, content, relatedId: relatedId || '' };
}

function settleReport(db, { table, targetColumn, reportId, status }) {
  const transaction = db.transaction(() => {
    const report = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(reportId);
    if (!report || report.calibration_processed) return { processed: false, notifications: [] };
    const notifications = [];
    let delta = 0;

    if (status === 'accepted') {
      const rank = db.prepare(`
        SELECT COUNT(*) AS count FROM ${table}
        WHERE ${targetColumn} = ?
          AND (created_at < ? OR (created_at = ? AND id <= ?))
      `).get(report[targetColumn], report.created_at, report.created_at, report.id).count;
      delta = rank <= 3 ? 10 : 5;
      db.prepare(`
        UPDATE users
        SET calibration_value = calibration_value + ?,
            entropy_lv4_earned = CASE WHEN calibration_value + ? >= 10000 THEN 1 ELSE entropy_lv4_earned END
        WHERE id = ?
      `).run(delta, delta, report.reporter_id);
      const content = rank <= 3
        ? '您标记的异常垃圾已被清理，当前水域更加洁净了！熵减值 +5，由于你是前三位举报成功的用户，熵减值额外 +5！感谢您的努力！'
        : '您标记的异常垃圾已被清理，当前水域更加洁净了！熵减值 +5。';
      notifications.push(insertSystemNotification(
        db, report.reporter_id, 'entropy_reward', '肆度观测站广播', content, report.id,
      ));
    } else if (status === 'rejected') {
      const user = db.prepare(`
        SELECT calibration_value, invalid_report_count FROM users WHERE id = ?
      `).get(report.reporter_id);
      const invalidCount = (Number(user?.invalid_report_count) || 0) + 1;
      if (invalidCount >= 5) {
        delta = -25;
        const nextValue = (Number(user?.calibration_value) || 0) + delta;
        const cooldownUntil = nextValue < 0 ? addCst({ days: 7 }) : null;
        db.prepare(`
          UPDATE users
          SET calibration_value = calibration_value - 25,
              invalid_report_count = 0,
              report_cooldown_until = COALESCE(?, report_cooldown_until)
          WHERE id = ?
        `).run(cooldownUntil, report.reporter_id);
        notifications.push(insertSystemNotification(
          db,
          report.reporter_id,
          'entropy_penalty',
          '系统警告',
          '[系统警告] 您的探测器似乎出现了幻听，误报太多导致设备过载，熵减值 -25。请喝杯冰水冷静一下。',
          report.id,
        ));
      } else {
        db.prepare('UPDATE users SET invalid_report_count = ? WHERE id = ?')
          .run(invalidCount, report.reporter_id);
      }
    }

    db.prepare(`
      UPDATE ${table}
      SET calibration_processed = 1, calibration_delta = ?
      WHERE id = ?
    `).run(delta, report.id);
    return { processed: true, delta, notifications };
  });
  const settlement = transaction();
  if (settlement.processed) {
    const report = db.prepare(`SELECT reporter_id FROM ${table} WHERE id=?`).get(reportId);
    if (report?.reporter_id && status === 'accepted') {
      require('./achievements').triggerAchievement(db, report.reporter_id, 'first_alarm');
    }
    if (report?.reporter_id && status === 'rejected' && settlement.delta < 0) {
      const user = db.prepare('SELECT calibration_value FROM users WHERE id=?').get(report.reporter_id);
      if ((Number(user?.calibration_value) || 0) < 0) {
        require('./achievements').triggerAchievement(db, report.reporter_id, 'sonar_short_circuit');
      }
    }
  }
  return settlement;
}

module.exports = { LEVELS, getEntropyState, assertCanReport, settleReport };
