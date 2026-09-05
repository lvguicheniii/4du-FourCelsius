const db = require('../src/db');

const requiredMigrations = [
  '077_update_log_dev_035',
  '078_web_sessions',
  '079_update_log_dev_036',
];
const applied = new Set(
  db.prepare(`SELECT id FROM schema_migrations WHERE id IN (${requiredMigrations.map(() => '?').join(',')})`)
    .all(...requiredMigrations)
    .map((row) => row.id),
);
const missingMigrations = requiredMigrations.filter((id) => !applied.has(id));
const updateLog = db.prepare("SELECT version_name, title FROM app_update_logs WHERE version_name = 'DEV-036'").get();
const foreignKeyIssues = db.pragma('foreign_key_check');
const result = {
  ok: missingMigrations.length === 0 && updateLog?.title === '网页社区端开始运行' && foreignKeyIssues.length === 0,
  missingMigrations,
  updateLog: updateLog || null,
  foreignKeyIssues: foreignKeyIssues.length,
};

process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) process.exitCode = 1;
