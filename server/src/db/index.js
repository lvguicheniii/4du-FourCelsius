const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');
const path = require('path');

const DB_PATH = process.env.SIDU_DB_PATH
  ? path.resolve(process.env.SIDU_DB_PATH)
  : path.join(__dirname, '..', 'data', 'sidu.db');
const fs = require('fs');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('wal_autocheckpoint = 1000');
db.pragma('journal_size_limit = 67108864');

// ====== 完整建表 ======
db.exec(`

  -- ============================================================
  -- 1. 用户表
  -- ============================================================
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,          -- 用户名（登录用）
    password_hash TEXT NOT NULL,                 -- bcrypt 哈希
    nickname      TEXT NOT NULL DEFAULT '',      -- 显示昵称
    phone         TEXT DEFAULT '',               -- 手机号
    email         TEXT DEFAULT '',               -- 邮箱
    avatar        TEXT,                          -- 头像URL
    bio           TEXT DEFAULT '',               -- 个性签名
    tags          TEXT DEFAULT '[]',             -- JSON 数组：兴趣标签
    cover_image   TEXT,                           -- 个人主页封面
    age           INTEGER,                        -- 注册时选择的年龄（0-444）
    refrigerant_count INTEGER NOT NULL DEFAULT 0, -- 制冷剂库存（0-4）
    gifted_refrigerant_count INTEGER NOT NULL DEFAULT 0, -- 受赠制冷剂（纪念库存，无上限）
    refrigerant_last_claim_date TEXT,             -- 最近一次每日领取日期（北京时间）
    role          TEXT DEFAULT 'user',           -- user | admin | superadmin
    status        TEXT DEFAULT 'active',         -- active | banned | deleted
    ban_reason    TEXT DEFAULT '',               -- 封禁原因
    ban_until     TEXT,                          -- 封禁截止时间(null=永久)
    token_version INTEGER DEFAULT 0,             -- 单设备登录（每次登录递增）
    register_ip   TEXT DEFAULT '',               -- 注册IP
    last_login_ip TEXT DEFAULT '',               -- 最后登录IP
    last_login_at TEXT,                          -- 最后登录时间
    login_count   INTEGER DEFAULT 0,            -- 登录次数
    created_at    TEXT DEFAULT (datetime('now','+8 hours')),
    updated_at    TEXT DEFAULT (datetime('now','+8 hours'))
  );

  -- ============================================================
  -- 2. 登录会话表
  -- ============================================================
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    token       TEXT NOT NULL,
    device_info TEXT DEFAULT '',               -- 设备信息(JSON)
    ip_address  TEXT DEFAULT '',
    expires_at  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- ============================================================
  -- 3. 帖子表（扩展版）
  -- ============================================================
  CREATE TABLE IF NOT EXISTS posts (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    content       TEXT NOT NULL DEFAULT '',
    images        TEXT DEFAULT '[]',              -- JSON 数组
    board_id      TEXT DEFAULT 'daily',           -- 板块ID
    status        TEXT DEFAULT 'active',          -- active | pending | reported | deleted
    visibility    TEXT NOT NULL DEFAULT 'public', -- public | private
    likes_count   INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    report_count  INTEGER DEFAULT 0,              -- 被举报次数
    view_count    INTEGER DEFAULT 0,              -- 浏览量
    is_pinned     INTEGER DEFAULT 0,              -- 是否置顶
    pinned_at     TEXT,                           -- 置顶时间
    created_at    TEXT DEFAULT (datetime('now','+8 hours')),
    updated_at    TEXT DEFAULT (datetime('now','+8 hours')),
    deleted_at    TEXT,
    delete_reason TEXT DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ============================================================
  -- 4. 评论表（扩展版）
  -- ============================================================
  CREATE TABLE IF NOT EXISTS comments (
    id           TEXT PRIMARY KEY,
    post_id      TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    parent_id    TEXT,                             -- 父评论ID(支持嵌套)
    content      TEXT NOT NULL,
    status       TEXT DEFAULT 'active',            -- active | deleted
    report_count INTEGER DEFAULT 0,
    likes_count  INTEGER NOT NULL DEFAULT 0,
    refrigerant_count INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
  );

  -- ============================================================
  -- 5. 切片降温表（与评论点赞 comment_likes 完全独立）
  -- ============================================================
  CREATE TABLE IF NOT EXISTS post_cools (
    user_id    TEXT NOT NULL,
    post_id    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','+8 hours')),
    PRIMARY KEY (user_id, post_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  -- ============================================================
  -- 6. 关注表
  -- ============================================================
  CREATE TABLE IF NOT EXISTS follows (
    follower_id  TEXT NOT NULL,
    following_id TEXT NOT NULL,
    created_at   TEXT DEFAULT (datetime('now','+8 hours')),
    PRIMARY KEY (follower_id, following_id)
  );

  -- ============================================================
  -- 7. 帖子举报表
  -- ============================================================
  CREATE TABLE IF NOT EXISTS post_reports (
    id          TEXT PRIMARY KEY,
    post_id     TEXT NOT NULL,
    reporter_id TEXT,                              -- 举报人；账号彻底移除后保留匿名举报记录
    reason      TEXT NOT NULL DEFAULT 'other',    -- spam|harass|fake|violence|other
    detail      TEXT DEFAULT '',                   -- 举报说明
    status      TEXT DEFAULT 'pending',           -- pending | accepted | rejected
    handled_by  TEXT,                              -- 处理人(管理员ID)
    handle_note TEXT DEFAULT '',                   -- 处理备注
    handled_at  TEXT,
    created_at  TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ============================================================
  -- 8. 评论举报表
  -- ============================================================
  CREATE TABLE IF NOT EXISTS comment_reports (
    id          TEXT PRIMARY KEY,
    comment_id  TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    reason      TEXT NOT NULL DEFAULT 'other',
    detail      TEXT DEFAULT '',
    status      TEXT DEFAULT 'pending',
    handled_by  TEXT,
    handle_note TEXT DEFAULT '',
    handled_at  TEXT,
    created_at  TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY (reporter_id) REFERENCES users(id),
    FOREIGN KEY (handled_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS message_reports (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'other',
    detail TEXT DEFAULT '',
    context_json TEXT DEFAULT '[]',
    status TEXT DEFAULT 'pending',
    handled_by TEXT,
    handle_note TEXT DEFAULT '',
    handled_at TEXT,
    created_at TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (reporter_id) REFERENCES users(id),
    FOREIGN KEY (handled_by) REFERENCES users(id)
  );

  -- 评论点赞与切片降温严格分表存储
  CREATE TABLE IF NOT EXISTS comment_likes (
    user_id    TEXT NOT NULL,
    comment_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','+8 hours')),
    PRIMARY KEY (user_id, comment_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id);

  CREATE TABLE IF NOT EXISTS refrigerant_transfers (
    id            TEXT PRIMARY KEY,
    from_user_id  TEXT NOT NULL,
    to_user_id    TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'profile',
    related_id    TEXT DEFAULT '',
    amount        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_refrigerant_transfers_from ON refrigerant_transfers(from_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_refrigerant_transfers_to ON refrigerant_transfers(to_user_id, created_at DESC);

  -- ============================================================
  -- 9. 通知表
  -- ============================================================
  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    type        TEXT NOT NULL,                     -- like|comment|follow|system|report_result
    title       TEXT DEFAULT '',
    content     TEXT DEFAULT '',
    related_id  TEXT,                              -- 关联对象ID
    is_read     INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- ============================================================
  -- 10. 管理员操作日志
  -- ============================================================
  CREATE TABLE IF NOT EXISTS admin_logs (
    id          TEXT PRIMARY KEY,
    admin_id    TEXT NOT NULL,
    action      TEXT NOT NULL,                    -- ban_user|delete_post|handle_report|pin_post等
    target_type TEXT NOT NULL,                    -- user|post|comment|report
    target_id   TEXT NOT NULL,
    detail      TEXT DEFAULT '',
    ip_address  TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (admin_id) REFERENCES users(id)
  );

  -- ============================================================
  -- 11. 用户封禁/拉黑表
  -- ============================================================
  CREATE TABLE IF NOT EXISTS blocks (
    user_id         TEXT NOT NULL,
    blocked_user_id TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now','+8 hours')),
    PRIMARY KEY (user_id, blocked_user_id)
  );

  -- ============================================================
  -- 12. 互助隐藏表（双向拉黑）
  -- ============================================================
  CREATE TABLE IF NOT EXISTS mutual_hides (
    user_a TEXT NOT NULL,
    user_b TEXT NOT NULL,
    paired_at TEXT DEFAULT (datetime('now','+8 hours')),
    PRIMARY KEY (user_a, user_b)
  );

  CREATE TABLE IF NOT EXISTS recommendation_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT,
    session_id TEXT DEFAULT '',
    post_id    TEXT NOT NULL,
    event_type TEXT NOT NULL,
    dwell_ms   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  -- ====== 索引 ======
  CREATE INDEX IF NOT EXISTS idx_users_username   ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_phone      ON users(phone);
  CREATE INDEX IF NOT EXISTS idx_users_status     ON users(status);
  CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
  CREATE INDEX IF NOT EXISTS idx_users_created    ON users(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_user       ON posts(user_id);
  CREATE INDEX IF NOT EXISTS idx_posts_status     ON posts(status);
  CREATE INDEX IF NOT EXISTS idx_posts_time       ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_board      ON posts(board_id);
  CREATE INDEX IF NOT EXISTS idx_comments_post    ON comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_comments_user    ON comments(user_id);
  CREATE INDEX IF NOT EXISTS idx_post_cools_post  ON post_cools(post_id);
  CREATE INDEX IF NOT EXISTS idx_post_cools_user  ON post_cools(user_id);
  CREATE INDEX IF NOT EXISTS idx_post_reports_status ON post_reports(status);
  CREATE INDEX IF NOT EXISTS idx_recommendation_events_user_time ON recommendation_events(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_recommendation_events_post_type ON recommendation_events(post_id, event_type);
  CREATE INDEX IF NOT EXISTS idx_message_reports_status ON message_reports(status);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id);

  -- ============================================================
  -- 13. 私信消息表
  -- ============================================================
  CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    from_user_id  TEXT NOT NULL,
    to_user_id    TEXT NOT NULL,
    kind          TEXT DEFAULT 'text',            -- text | image | sticker
    content       TEXT NOT NULL,
    is_read       INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(from_user_id, to_user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(created_at DESC);

  -- ============================================================
  -- 14. 潜流胶囊文案库
  -- ============================================================
  CREATE TABLE IF NOT EXISTS capsule_texts (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL);

  -- ============================================================
  -- 15. 深海信标
  -- ============================================================
  CREATE TABLE IF NOT EXISTS beacons (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL,
    image       TEXT,
    created_at  TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_beacons_time ON beacons(created_at DESC);

  CREATE TABLE IF NOT EXISTS filter_words (
    id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE, level TEXT DEFAULT 'block',
    replacement TEXT DEFAULT '***', created_by TEXT, created_at TEXT DEFAULT (datetime('now','+8 hours'))
  );
  CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'snow', color TEXT NOT NULL DEFAULT '#33A9DC',
    color_dark TEXT NOT NULL DEFAULT '#7FD8F5', category TEXT NOT NULL DEFAULT '生活', is_active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 100,
    created_at TEXT DEFAULT (datetime('now','+8 hours')), updated_at TEXT DEFAULT (datetime('now','+8 hours'))
  );
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort INTEGER DEFAULT 100,
    created_at TEXT DEFAULT (datetime('now','+8 hours')), updated_at TEXT DEFAULT (datetime('now','+8 hours'))
  );
`);

// ====== 种子数据 ======
// 胶囊文案库：仅首次插入
const capsuleCount = db.prepare('SELECT COUNT(*) as c FROM capsule_texts').get().c;
if (capsuleCount === 0) {
  const texts = [
    '[观测样本 #709] 溶解度: 98%',
    '不明残冰 - 距化水还剩 12 分钟',
    '[异常引力源] 坐标: 潜流 24 区',
    '一份即将失效的 25.9°C 切片',
    '临界温度警报： 结构正在瓦解',
    '[脱落的冰层] 体积评估：极小',
    '编号 M-404： 失去光源的悬浮物',
    '洋流偏移物 - 归属地无法追踪',
    '[深海沉淀物] 碳-14 同位素测定中',
    '一段低频的白噪音',
    '某种无序的乱流',
    '微弱的生物电信号',
    '一次频率为 432Hz 的震动',
    '检测到次声波回旋',
    '[声呐微光] 极度微弱的单次脉冲',
    '一段被水压拉长的回音',
    '波段异常： 带有明显的失重感',
    '水下 800 米的暗涌反馈……回音。',
    '关于某种执念',
    '无人在意的……',
    '（一段空白的记忆）',
    '沉底的第 14 个小时……',
    '被水压揉碎的半句话',
    '[无法解析的呢喃]',
    '连同叹息一起下沉',
    '只有水草知道的秘密',
    '一封没有邮戳的瓶中信',
    '[打捞物] 某人的航海日志残页',
    '一块停摆的潜水表',
    '没有坐标的求救信号',
    '从浅滩坠落的……',
  ];
  const insert = db.prepare('INSERT INTO capsule_texts (text) VALUES (?)');
  texts.forEach(t => insert.run(t));
}

// ====== 增量迁移（幂等） ======
runMigrations(db);

// Feedback is a base business table and must also exist on older deployments.
db.exec(`CREATE TABLE IF NOT EXISTS user_feedback (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, image_url TEXT,
  status TEXT NOT NULL DEFAULT 'new', admin_note TEXT DEFAULT '',
  device_model TEXT DEFAULT '', os_version TEXT DEFAULT '', app_version TEXT DEFAULT '',
  reviewed_at TEXT, reply_content TEXT DEFAULT '', replied_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
); CREATE INDEX IF NOT EXISTS idx_user_feedback_created ON user_feedback(created_at DESC);`);
const feedbackColumns = new Set(db.prepare('PRAGMA table_info(user_feedback)').all().map(column => column.name));
if (!feedbackColumns.has('reviewed_at')) db.exec('ALTER TABLE user_feedback ADD COLUMN reviewed_at TEXT');
if (!feedbackColumns.has('reply_content')) db.exec("ALTER TABLE user_feedback ADD COLUMN reply_content TEXT DEFAULT ''");
if (!feedbackColumns.has('replied_at')) db.exec('ALTER TABLE user_feedback ADD COLUMN replied_at TEXT');
if (!feedbackColumns.has('device_model')) db.exec("ALTER TABLE user_feedback ADD COLUMN device_model TEXT DEFAULT ''");
if (!feedbackColumns.has('os_version')) db.exec("ALTER TABLE user_feedback ADD COLUMN os_version TEXT DEFAULT ''");
if (!feedbackColumns.has('app_version')) db.exec("ALTER TABLE user_feedback ADD COLUMN app_version TEXT DEFAULT ''");

// 反馈数据属于基础业务表，始终确保存在，避免旧部署跳过新迁移时缺表。
db.exec(`CREATE TABLE IF NOT EXISTS user_feedback (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, image_url TEXT,
  status TEXT NOT NULL DEFAULT 'new', admin_note TEXT DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
); CREATE INDEX IF NOT EXISTS idx_user_feedback_created ON user_feedback(created_at DESC);`);
const quickCheck = db.pragma('quick_check')[0]?.quick_check;
if (quickCheck !== 'ok') {
  throw new Error(`SQLite quick check failed: ${quickCheck}`);
}

// ====== 处罚申诉（幂等） ======
db.exec(`
  CREATE TABLE IF NOT EXISTS appeals (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    notification_id TEXT NOT NULL,
    appeal_type     TEXT NOT NULL,
    target_id       TEXT DEFAULT '',
    reason          TEXT NOT NULL,
    status          TEXT DEFAULT 'pending',
    decision        TEXT DEFAULT '',
    handle_note     TEXT DEFAULT '',
    handled_by      TEXT,
    handled_at      TEXT,
    created_at      TEXT DEFAULT (datetime('now','+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
    FOREIGN KEY (handled_by) REFERENCES users(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_appeals_notification ON appeals(notification_id);
  CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals(user_id, created_at DESC);
`);

// ====== 数据库触发器：自动更新统计 ======
// 评论插入时更新 posts.comments_count
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_comment_insert
  AFTER INSERT ON comments
  WHEN NEW.status = 'active'
  BEGIN
    UPDATE posts SET comments_count = comments_count + 1, updated_at = datetime('now','+8 hours') WHERE id = NEW.post_id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_comment_delete
  AFTER UPDATE ON comments
  WHEN OLD.status = 'active' AND NEW.status = 'deleted'
  BEGIN
    UPDATE posts SET comments_count = MAX(0, comments_count - 1) WHERE id = NEW.post_id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_comment_restore
  AFTER UPDATE ON comments
  WHEN OLD.status = 'deleted' AND NEW.status = 'active'
  BEGIN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  END;
`);

module.exports = db;
