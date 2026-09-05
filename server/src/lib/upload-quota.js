const db = require('../db');
const { formatCst } = require('./time');

const DEFAULT_FILE_LIMIT = 60;
const DEFAULT_BYTE_LIMIT = 500 * 1024 * 1024;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function currentUsageDate(now = new Date()) {
  return formatCst(now).slice(0, 10);
}

function reserveDailyUpload(userId, sizeBytes, options = {}) {
  const uid = String(userId || '');
  const bytes = Math.max(0, Number(sizeBytes) || 0);
  if (!uid) throw new Error('Upload quota requires an authenticated user');
  const fileLimit = positiveInteger(options.fileLimit ?? process.env.UPLOAD_DAILY_FILE_LIMIT, DEFAULT_FILE_LIMIT);
  const byteLimit = positiveInteger(options.byteLimit ?? process.env.UPLOAD_DAILY_BYTE_LIMIT, DEFAULT_BYTE_LIMIT);
  const usageDate = options.usageDate || currentUsageDate(options.now);

  return db.transaction(() => {
    const usage = db.prepare(`
      SELECT file_count,byte_count FROM media_upload_daily_usage
      WHERE user_id=? AND usage_date=?
    `).get(uid, usageDate) || { file_count: 0, byte_count: 0 };
    const nextFiles = Number(usage.file_count) + 1;
    const nextBytes = Number(usage.byte_count) + bytes;
    if (nextFiles > fileLimit || nextBytes > byteLimit) {
      const error = new Error('今日上传额度已用完，请明天再试');
      error.statusCode = 429;
      error.code = 'UPLOAD_DAILY_QUOTA_EXCEEDED';
      throw error;
    }
    db.prepare(`
      INSERT INTO media_upload_daily_usage(user_id,usage_date,file_count,byte_count,updated_at)
      VALUES (?,?,?,?,datetime('now','+8 hours'))
      ON CONFLICT(user_id,usage_date) DO UPDATE SET
        file_count=excluded.file_count,
        byte_count=excluded.byte_count,
        updated_at=excluded.updated_at
    `).run(uid, usageDate, nextFiles, nextBytes);
    return { usageDate, fileCount: nextFiles, byteCount: nextBytes, fileLimit, byteLimit };
  })();
}

module.exports = { currentUsageDate, reserveDailyUpload };
