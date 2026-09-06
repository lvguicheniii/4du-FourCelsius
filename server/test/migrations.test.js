const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { runMigrations } = require('../src/db/migrations');
const { preferenceMap, restoreShortcut, updatePreference } = require('../src/lib/conversation-preferences');
const { ACHIEVEMENT_PROGRAM_CONDITIONS } = require('../src/lib/achievement-program-conditions');

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name);
}

test('migrations are idempotent and record each version once', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE, phone TEXT, security_question TEXT, security_answer TEXT, role TEXT DEFAULT 'user');
    INSERT INTO users (id, username, phone, security_answer) VALUES ('stale-user', 'user_13800000000', '13900000000', 'legacy answer');
    CREATE TABLE notifications (id TEXT PRIMARY KEY, type TEXT);
    CREATE TABLE post_reports (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'other',
      detail TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      handled_by TEXT,
      handle_note TEXT DEFAULT '',
      handled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (reporter_id) REFERENCES users(id),
      FOREIGN KEY (handled_by) REFERENCES users(id)
    );
    CREATE TABLE comment_reports (id TEXT PRIMARY KEY, comment_id TEXT, created_at TEXT);
    CREATE TABLE message_reports (id TEXT PRIMARY KEY);
    CREATE TABLE filter_words (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY, to_user_id TEXT, from_user_id TEXT);
    CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT, comments_count INTEGER DEFAULT 0);
    CREATE TABLE comments (id TEXT PRIMARY KEY, post_id TEXT, user_id TEXT, content TEXT, status TEXT DEFAULT 'active');
    INSERT INTO posts (id, user_id) VALUES ('post-with-comment', 'stale-user');
    INSERT INTO comments (id, post_id, user_id, content) VALUES ('comment-1', 'post-with-comment', 'stale-user', 'hello');
    INSERT INTO post_reports (id, post_id, reporter_id) VALUES ('orphan-report', 'post-with-comment', 'missing-user');
    CREATE TABLE boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'snow',
      color TEXT NOT NULL DEFAULT '#33A9DC',
      color_dark TEXT NOT NULL DEFAULT '#7FD8F5',
      sort INTEGER DEFAULT 100,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO boards (id, name, icon, sort) VALUES ('b1', 'NOW', 'cafe', 0);
    CREATE TABLE admin_logs (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO admin_logs (id, created_at) VALUES ('legacy-log', '2026-08-01 10:00:00');
  `);
  db.pragma('foreign_keys = ON');
  db.prepare(`
    INSERT INTO users (id, username, phone, security_question, security_answer)
    VALUES (?, ?, ?, ?, ?)
  `).run('default-answer-user', 'user_13700000000', '13700000000', '你最喜欢的季节是什么？', bcrypt.hashSync('123456', 10));

  runMigrations(db);
  const migrationCount = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
  runMigrations(db);

  assert.ok(migrationCount > 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, migrationCount);
  assert.equal(db.prepare("SELECT icon FROM boards WHERE id='board_ootd'").get()?.icon, 'shirt-outline');
  assert.equal(db.prepare("SELECT icon FROM boards WHERE id='board_sleep'").get()?.icon, 'bed-outline');
  assert.equal(db.prepare("SELECT name FROM boards WHERE id='board_anime'").get()?.name, '二次元');
  assert.equal(columnNames(db, 'users').filter(name => name === 'age').length, 1);
  assert.ok(columnNames(db, 'notifications').includes('category'));
  assert.ok(columnNames(db, 'message_reports').includes('context_json'));
  assert.ok(columnNames(db, 'filter_words').includes('replacement'));
  assert.ok(columnNames(db, 'messages').includes('is_read'));
  assert.ok(columnNames(db, 'users').includes('refrigerant_count'));
  assert.ok(columnNames(db, 'users').includes('gifted_refrigerant_count'));
  assert.ok(columnNames(db, 'users').includes('refrigerant_last_claim_date'));
  assert.ok(columnNames(db, 'users').includes('fragile_frost_shell_count'));
  assert.ok(columnNames(db, 'users').includes('eternal_frost_shell_count'));
  assert.ok(columnNames(db, 'users').includes('frost_shell_online_seconds'));
  assert.ok(columnNames(db, 'users').includes('frost_shell_online_progress_date'));
  assert.ok(columnNames(db, 'users').includes('frost_shell_daily_claim_date'));
  assert.ok(columnNames(db, 'users').includes('calibration_value'));
  assert.ok(columnNames(db, 'posts').includes('video_media_type'));
  assert.equal(db.prepare("SELECT comments_count FROM posts WHERE id='post-with-comment'").get().comments_count, 1);
  assert.ok(columnNames(db, 'posts').includes('live_photos'));
  assert.ok(columnNames(db, 'messages').includes('recalled_at'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='message_user_hides'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reef_reports'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_reef_applications'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='security_rate_buckets'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_upload_daily_usage'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_recommendation_events_session_dedupe'").get());
  assert.ok(columnNames(db, 'users').includes('invalid_report_count'));
  assert.ok(columnNames(db, 'users').includes('report_cooldown_until'));
  assert.ok(columnNames(db, 'users').includes('entropy_lv4_earned'));
  assert.ok(columnNames(db, 'users').includes('last_online_at'));
  assert.ok(db.prepare("SELECT last_online_at FROM users WHERE id='stale-user'").get().last_online_at);
  assert.ok(columnNames(db, 'reef_rooms').includes('duration_hours'));
  assert.ok(columnNames(db, 'reef_rooms').includes('expires_at'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reef_members'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reef_retention_votes'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reef_message_reports'").get());
  assert.equal(db.prepare("SELECT capacity FROM reef_rooms WHERE id='reef_official_1'").get().capacity, 444);
  assert.ok(columnNames(db, 'message_reports').includes('calibration_processed'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='comment_likes'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='refrigerant_transfers'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_cools'").get());
  assert.ok(columnNames(db, 'posts').includes('visibility'));
  assert.ok(columnNames(db, 'posts').includes('reef_room_id'));
  assert.ok(columnNames(db, 'posts').includes('video_url'));
  assert.ok(columnNames(db, 'posts').includes('video_poster'));
  assert.ok(columnNames(db, 'posts').includes('video_media_id'));
  assert.ok(columnNames(db, 'comments').includes('frost_shell_count'));
  assert.ok(columnNames(db, 'messages').includes('media_id'));
  assert.ok(columnNames(db, 'reef_messages').includes('media_id'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_assets'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_preferences'").get());
  assert.ok(columnNames(db, 'conversation_preferences').includes('last_read_at'));
  assert.ok(columnNames(db, 'conversation_preferences').includes('last_read_message_id'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recommendation_events'").get());
  assert.ok(columnNames(db, 'posts').includes('refrigerant_count'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='feature_flags'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='daily_themes'").get());
  assert.equal(db.prepare("SELECT label FROM feature_flags WHERE key='daily_theme'").get().label, '每日话题');
  assert.deepEqual(
    db.prepare("SELECT label,enabled,rollout_percent FROM feature_flags WHERE key='video_upload'").get(),
    { label: '普通视频', enabled: 0, rollout_percent: 0 },
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM feature_flags WHERE key='video_media'").get().count, 0);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='device_push_tokens'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_refrigerant_boosts'").get());
  assert.ok(columnNames(db, 'posts').includes('slice_box_id'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='slice_boxes'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_refrigerant_daily_uses'").get());
  assert.ok(columnNames(db, 'boards').includes('category'));
  assert.ok(columnNames(db, 'boards').includes('is_active'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='idempotency_requests'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='login_throttles'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='moderation_tasks'").get());
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('moderation_tasks') WHERE name='context_snapshot'").get());
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('moderation_tasks') WHERE name='light_violation'").get());
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('comments') WHERE name='kind'").get());
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('comments') WHERE name='media_url'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='moderation_result_cache'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='frost_shell_transfers'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_releases'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_update_logs'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_sessions'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='captcha_challenges'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sms_verification_codes'").get());
  assert.ok(columnNames(db, 'sms_verification_codes').includes('phone_hash'));
  assert.ok(columnNames(db, 'sms_verification_codes').includes('code_hash'));
  assert.equal(columnNames(db, 'sms_verification_codes').includes('phone'), false);
  assert.equal(columnNames(db, 'sms_verification_codes').includes('code'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_update_logs').get().count, 47);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='1.1'").get().title, '稳定性与社区互动体验优化');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='1.1'").get().release_notes, /礁石新增@功能/);
  assert.equal(db.prepare("SELECT update_id FROM app_update_logs WHERE version_name='DEV-026'").get().update_id, '019ff5f7-b76c-716b-b545-533faec1b5ab');
  assert.equal(db.prepare("SELECT update_id FROM app_update_logs WHERE version_name='DEV-027'").get().update_id, '019ff69c-332e-7b23-8cce-2e9aa6e75342');
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-027'").get().title, '这次用起来更顺手了');
  assert.equal(db.prepare("SELECT update_id FROM app_update_logs WHERE version_name='DEV-028'").get().update_id, '019ff8ca-d40e-7fbf-b9c4-60e24befdb82');
  assert.equal(db.prepare("SELECT update_id FROM app_update_logs WHERE version_name='DEV-029'").get().update_id, '019ff8d8-d8d4-7e0c-bcf5-9cabca6a143e');
  assert.equal(db.prepare("SELECT update_id FROM app_update_logs WHERE version_name='DEV-030'").get().update_id, '019ff8ed-758d-75ed-a6ea-b05c61655827');
  for (const table of ['post_reports', 'comment_reports', 'message_reports', 'reef_message_reports', 'reef_reports']) {
    assert.ok(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name='handle_action'`).get());
  }
  assert.equal(db.prepare("SELECT update_id FROM app_update_logs WHERE version_name='DEV-031'").get().update_id, '019ff969-3b7c-7953-94cd-b2805e322d5f');
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-032'").get().title, '管理能力补齐，稳定性全面加固');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-032'").get().release_notes, /管理后台新增管理人员角色分工/);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-033'").get().title, '安全与备份体系进一步完善');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-033'").get().release_notes, /用户媒体文件增加异地备份/);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-034'").get().title, '安全与恢复能力持续加固');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-034'").get().release_notes, /非 root 密钥运维/);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-035'").get().title, '稳定性与会话体验优化');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-035'").get().release_notes, /账户切换隔离/);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-036'").get().title, '网页社区端开始运行');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-036'").get().release_notes, /实况照片在网页端以静态封面展示/);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-037'").get().title, '网页社区体验继续完善');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-037'").get().release_notes, /实时在线人数/);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-038'").get().title, '网页社区用起来更顺手了');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-038'").get().release_notes, /制备切片/);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-039'").get().title, '切片浏览和个人主页更顺手了');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-039'").get().release_notes, /单张图片现在会完整显示/);
  assert.equal(db.prepare("SELECT update_id FROM app_update_logs WHERE version_name='DEV-039'").get().update_id, '01a0425d-aee6-7940-84ab-3d75bc936614');
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-040'").get().title, '网页里的肆度，更完整了');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-040'").get().release_notes, /顶部导航/);
  assert.equal(db.prepare("SELECT update_id FROM app_update_logs WHERE version_name='DEV-040'").get().update_id, null);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-058'").get().title, '双端质感、网页地址与管理体验全面优化');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-058'").get().release_notes, /真实公历选择器/);
  assert.equal(db.prepare("SELECT title FROM app_update_logs WHERE version_name='DEV-066-android'").get().title, '更新体验、浏览稳定性与网页社区全面优化');
  assert.match(db.prepare("SELECT release_notes FROM app_update_logs WHERE version_name='DEV-066-android'").get().release_notes, /直接进入浮霜带“最新”/);
  assert.equal(db.prepare("SELECT reporter_id FROM post_reports WHERE id='orphan-report'").get().reporter_id, null);
  assert.equal(
    db.prepare("SELECT on_delete FROM pragma_foreign_key_list('post_reports') WHERE \"from\"='reporter_id'").get().on_delete,
    'SET NULL',
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM boards WHERE id='board_happy'").get().count, 0);
  assert.equal(db.prepare("SELECT icon FROM boards WHERE id='board_joy'").get().icon, 'happy-outline');
  assert.equal(db.prepare("SELECT icon FROM boards WHERE id='board_angry'").get().icon, 'emoticon-angry-outline');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='achievement_definitions'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_achievements'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='achievement_events'").get());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM achievement_definitions').get().count, 19);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM achievement_definitions WHERE key IN ('unknown_current','deep_sea_lantern')").get().count, 0);
  assert.equal(db.prepare("SELECT name FROM achievement_definitions WHERE key='hand_fragrance'").get().name, '手留余香');
  const achievementKeys = db.prepare('SELECT key FROM achievement_definitions').all().map(row => row.key).sort();
  assert.deepEqual(Object.keys(ACHIEVEMENT_PROGRAM_CONDITIONS).sort(), achievementKeys);
  assert.equal(db.prepare("SELECT refrigerant_count FROM users WHERE id = 'stale-user'").get().refrigerant_count, 4);
  assert.equal(db.prepare("SELECT gifted_refrigerant_count FROM users WHERE id = 'stale-user'").get().gifted_refrigerant_count, 0);
  assert.equal(db.prepare("SELECT username FROM users WHERE id = 'stale-user'").get().username, 'user_13900000000');
  assert.equal(bcrypt.compareSync('legacy answer', db.prepare("SELECT security_answer FROM users WHERE id = 'stale-user'").get().security_answer), true);
  assert.deepEqual(
    db.prepare("SELECT security_question, security_answer FROM users WHERE id = 'default-answer-user'").get(),
    { security_question: '', security_answer: '' },
  );
  const important = updatePreference(db, 'stale-user', 'chat', 'peer-user', { important: true });
  assert.equal(important.important, true);
  assert.ok(important.importantAt);
  updatePreference(db, 'stale-user', 'chat', 'peer-user', { hidden: true });
  assert.equal(preferenceMap(db, 'stale-user', 'chat').get('peer-user').hidden, true);
  restoreShortcut(db, 'stale-user', 'chat', 'peer-user');
  const restored = preferenceMap(db, 'stale-user', 'chat').get('peer-user');
  assert.equal(restored.hidden, false);
  assert.equal(restored.important, true);
  const readAt = "2026-08-12 12:34:56";
  updatePreference(db, 'stale-user', 'reef', 'reef_official_1', { lastReadAt: readAt, lastReadMessageId: 'reef-message-1' });
  assert.equal(preferenceMap(db, 'stale-user', 'reef').get('reef_official_1').lastReadAt, readAt);
  assert.equal(preferenceMap(db, 'stale-user', 'reef').get('reef_official_1').lastReadMessageId, 'reef-message-1');
  updatePreference(db, 'stale-user', 'reef', 'reef_official_1', { important: true });
  assert.equal(preferenceMap(db, 'stale-user', 'reef').get('reef_official_1').lastReadAt, readAt);
  assert.equal(preferenceMap(db, 'stale-user', 'reef').get('reef_official_1').lastReadMessageId, 'reef-message-1');
  assert.equal(db.prepare("SELECT created_at FROM admin_logs WHERE id = 'legacy-log'").get().created_at, '2026-08-01 18:00:00');
  db.prepare("INSERT INTO admin_logs (id) VALUES ('trigger-log')").run();
  const triggerOffsetHours = db.prepare(`
    SELECT ROUND((julianday(created_at) - julianday(datetime('now'))) * 24) AS hours
    FROM admin_logs WHERE id = 'trigger-log'
  `).get().hours;
  assert.equal(triggerOffsetHours, 8);
  db.close();
});
