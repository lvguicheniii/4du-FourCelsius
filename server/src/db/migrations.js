const bcrypt = require('bcryptjs');

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name));
}

function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE "${table}" ADD COLUMN ${definition}`);
}

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function installLegacyBeijingTimeTrigger(db, table) {
  if (!tableExists(db, table)) return;
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql || '';
  if (!/datetime\('now'\)/.test(schema)) return;
  const timeColumns = db.prepare(`PRAGMA table_info("${table}")`).all()
    .filter((column) => /datetime\('now'\)/.test(String(column.dflt_value || '')))
    .map((column) => column.name);
  if (!timeColumns.length) return;
  const trigger = `normalize_${table}_beijing_time`;
  const when = timeColumns.map((column) => (
    `NEW."${column}" BETWEEN datetime('now','-3 seconds') AND datetime('now','+3 seconds')`
  )).join(' OR ');
  const updates = timeColumns.map((column) => (
    `"${column}" = CASE WHEN NEW."${column}" BETWEEN datetime('now','-3 seconds') AND datetime('now','+3 seconds') ` +
    `THEN datetime(NEW."${column}",'+8 hours') ELSE NEW."${column}" END`
  )).join(',\n          ');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS "${trigger}"
    AFTER INSERT ON "${table}"
    WHEN ${when}
    BEGIN
      UPDATE "${table}"
      SET ${updates}
      WHERE rowid = NEW.rowid;
    END
  `);
}

const migrations = [
  {
    id: '001_user_profile_columns',
    up(db) {
      addColumn(db, 'users', "gender TEXT DEFAULT ''");
      addColumn(db, 'users', 'deleted_at TEXT');
      addColumn(db, 'users', "security_question TEXT DEFAULT ''");
      addColumn(db, 'users', "security_answer TEXT DEFAULT ''");
      addColumn(db, 'users', 'muted_until TEXT');
      addColumn(db, 'users', "imei TEXT DEFAULT ''");
      addColumn(db, 'users', 'age INTEGER');
    },
  },
  {
    id: '002_notification_category',
    up(db) { addColumn(db, 'notifications', "category TEXT DEFAULT 'system'"); },
  },
  {
    id: '003_message_report_context',
    up(db) { addColumn(db, 'message_reports', "context_json TEXT DEFAULT '[]'"); },
  },
  {
    id: '004_filter_word_replacement',
    up(db) { addColumn(db, 'filter_words', "replacement TEXT DEFAULT '***'"); },
  },
  {
    id: '005_message_read_state',
    up(db) {
      addColumn(db, 'messages', 'is_read INTEGER DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(to_user_id, from_user_id, is_read)');
    },
  },
  {
    id: '006_legacy_beijing_time_defaults',
    up(db) {
      // admin_logs historically relied exclusively on its UTC default, so every
      // existing row can be corrected safely and exactly once.
      if (tableExists(db, 'admin_logs')) {
        db.prepare("UPDATE admin_logs SET created_at = datetime(created_at,'+8 hours')").run();
      }
      // SQLite cannot ALTER a column default in place. These compatibility
      // triggers protect old production tables until they are rebuilt, while
      // fresh tables (whose defaults already use +8 hours) need no trigger.
      [
        'admin_logs', 'beacons', 'blocks', 'boards', 'comment_reports',
        'filter_words', 'follows', 'likes', 'message_reports', 'messages',
        'mutual_hides', 'notifications', 'post_reports', 'posts', 'sessions',
        'tag_categories', 'tags', 'topics', 'users',
      ].forEach((table) => installLegacyBeijingTimeTrigger(db, table));
    },
  },
  {
    id: '007_sync_generated_usernames',
    up(db) {
      const userColumns = columns(db, 'users');
      if (!userColumns.has('username') || !userColumns.has('phone')) return;
      db.prepare(`
        UPDATE users AS current
        SET username = 'user_' || phone
        WHERE length(username) = 16
          AND substr(username, 1, 5) = 'user_'
          AND substr(username, 6) NOT GLOB '*[^0-9]*'
          AND length(phone) = 11
          AND username != 'user_' || phone
          AND NOT EXISTS (
            SELECT 1 FROM users AS other
            WHERE other.username = 'user_' || current.phone AND other.id != current.id
          )
      `).run();
    },
  },
  {
    id: '008_refrigerant_and_comment_likes',
    up(db) {
      addColumn(db, 'users', 'refrigerant_count INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'users', 'refrigerant_last_claim_date TEXT');
      if (tableExists(db, 'comments')) {
        addColumn(db, 'comments', 'likes_count INTEGER NOT NULL DEFAULT 0');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS comment_likes (
          user_id TEXT NOT NULL,
          comment_id TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (user_id, comment_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id);
        CREATE TABLE IF NOT EXISTS refrigerant_transfers (
          id TEXT PRIMARY KEY,
          from_user_id TEXT NOT NULL,
          to_user_id TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'profile',
          related_id TEXT DEFAULT '',
          amount INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (from_user_id) REFERENCES users(id),
          FOREIGN KEY (to_user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_refrigerant_transfers_from ON refrigerant_transfers(from_user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_refrigerant_transfers_to ON refrigerant_transfers(to_user_id, created_at DESC);
      `);
    },
  },
  {
    id: '009_separate_post_cools_from_comment_likes',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS post_cools (
          user_id TEXT NOT NULL,
          post_id TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (user_id, post_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_post_cools_post ON post_cools(post_id);
        CREATE INDEX IF NOT EXISTS idx_post_cools_user ON post_cools(user_id);
      `);
      if (tableExists(db, 'likes')) {
        db.prepare(`
          INSERT OR IGNORE INTO post_cools (user_id, post_id, created_at)
          SELECT user_id, post_id, created_at FROM likes
        `).run();
      }
    },
  },
  {
    id: '010_comment_refrigerant_and_test_inventory',
    up(db) {
      if (tableExists(db, 'comments')) {
        addColumn(db, 'comments', 'refrigerant_count INTEGER NOT NULL DEFAULT 0');
      }
      // 开发期测试库存；正式上线前由后续迁移恢复产品上限。
      db.prepare('UPDATE users SET refrigerant_count = 99').run();
    },
  },
  {
    id: '011_recommendation_foundation',
    up(db) {
      if (tableExists(db, 'posts')) {
        addColumn(db, 'posts', "visibility TEXT NOT NULL DEFAULT 'public'");
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS recommendation_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          session_id TEXT DEFAULT '',
          post_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          dwell_ms INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_recommendation_events_user_time
          ON recommendation_events(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_recommendation_events_post_type
          ON recommendation_events(post_id, event_type);
      `);
    },
  },
  {
    id: '012_product_operations',
    up(db) {
      if (tableExists(db, 'posts')) {
        addColumn(db, 'posts', 'refrigerant_count INTEGER NOT NULL DEFAULT 0');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS feature_flags (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          description TEXT DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          rollout_percent INTEGER NOT NULL DEFAULT 100,
          updated_by TEXT,
          updated_at TEXT DEFAULT (datetime('now','+8 hours'))
        );
        CREATE TABLE IF NOT EXISTS daily_themes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          prompt TEXT NOT NULL,
          theme_date TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active',
          created_by TEXT,
          created_at TEXT DEFAULT (datetime('now','+8 hours'))
        );
        CREATE INDEX IF NOT EXISTS idx_daily_themes_date ON daily_themes(theme_date DESC);
        CREATE TABLE IF NOT EXISTS device_push_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          platform TEXT NOT NULL DEFAULT 'unknown',
          enabled INTEGER NOT NULL DEFAULT 1,
          last_seen_at TEXT DEFAULT (datetime('now','+8 hours')),
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON device_push_tokens(user_id, enabled);
        CREATE TABLE IF NOT EXISTS post_refrigerant_boosts (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_post_refrigerant_boosts_active ON post_refrigerant_boosts(post_id, expires_at);
      `);
      const insertFlag = db.prepare(`
        INSERT OR IGNORE INTO feature_flags(key,label,description,enabled,rollout_percent)
        VALUES (?,?,?,?,?)
      `);
      [
        ['offline_push', '系统离线推送', 'App 在后台或退出后发送系统通知', 1, 100],
        ['daily_theme', '每日话题', '在制备页展示当天自动发布的每日话题', 1, 100],
        ['refrigerant_boost', '制冷剂推荐加权', '给切片使用制冷剂后短期提升推荐权重', 1, 100],
        ['qianliu_gender', '潜流域性别匹配', '按男性或女性筛选失温切片和信标', 1, 100],
      ].forEach((row) => insertFlag.run(...row));
    },
  },
  {
    id: '013_daily_topic_scheduling',
    up(db) {
      db.prepare(`
        UPDATE feature_flags
        SET label='每日话题', description='在制备页展示当天自动发布的每日话题'
        WHERE key='daily_theme'
      `).run();
      db.prepare(`
        UPDATE daily_themes
        SET status = CASE
          WHEN theme_date = date('now','+8 hours') THEN 'active'
          WHEN theme_date > date('now','+8 hours') THEN 'scheduled'
          ELSE 'expired'
        END
        WHERE status != 'disabled'
      `).run();
    },
  },
  {
    id: '014_daily_topic_pending_status',
    up(db) {
      db.prepare("UPDATE daily_themes SET status='pending' WHERE status='scheduled'").run();
    },
  },
  {
    id: '015_hidden_reef_group_chat',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reef_rooms (
          id TEXT PRIMARY KEY,
          zone TEXT NOT NULL CHECK(zone IN ('public','private')),
          official_number INTEGER UNIQUE,
          name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#33A9DC',
          capacity INTEGER NOT NULL DEFAULT 50,
          owner_id TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reef_rooms_zone ON reef_rooms(zone,status,official_number,created_at);
        CREATE TABLE IF NOT EXISTS reef_messages (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          content TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'text',
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (room_id) REFERENCES reef_rooms(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_reef_messages_room_time ON reef_messages(room_id,created_at DESC,id DESC);
      `);
      const insert = db.prepare(`
        INSERT OR IGNORE INTO reef_rooms(id,zone,official_number,name,color,capacity)
        VALUES (?,?,?,?,?,?)
      `);
      [
        ['reef_official_1', 'public', 1, '四度观测站', '#33A9DC', 100],
        ['reef_official_2', 'public', 2, '深夜白噪音', '#6C7EE1', 80],
        ['reef_official_3', 'public', 3, '低能量漂流所', '#36A78C', 80],
        ['reef_official_4', 'public', 4, '无意义电台', '#B277D1', 60],
      ].forEach(row => insert.run(...row));
    },
  },
  {
    id: '016_entropy_calibration_system',
    up(db) {
      addColumn(db, 'users', 'calibration_value INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'users', 'invalid_report_count INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'users', 'report_cooldown_until TEXT');
      addColumn(db, 'users', 'entropy_lv4_earned INTEGER NOT NULL DEFAULT 0');
      ['post_reports', 'comment_reports', 'message_reports'].forEach((table) => {
        if (!tableExists(db, table)) return;
        addColumn(db, table, 'calibration_processed INTEGER NOT NULL DEFAULT 0');
        addColumn(db, table, 'calibration_delta INTEGER NOT NULL DEFAULT 0');
      });
      if (tableExists(db, 'post_reports')) {
        db.exec('CREATE INDEX IF NOT EXISTS idx_post_reports_target_time ON post_reports(post_id, created_at, id)');
      }
      if (tableExists(db, 'comment_reports')) {
        db.exec('CREATE INDEX IF NOT EXISTS idx_comment_reports_target_time ON comment_reports(comment_id, created_at, id)');
      }
      if (tableExists(db, 'message_reports')) {
        const reportColumns = columns(db, 'message_reports');
        if (reportColumns.has('message_id') && reportColumns.has('created_at')) {
          db.exec('CREATE INDEX IF NOT EXISTS idx_message_reports_target_time ON message_reports(message_id, created_at, id)');
        }
      }
    },
  },
  {
    id: '017_reef_lifecycle',
    up(db) {
      addColumn(db, 'reef_rooms', 'duration_hours INTEGER NOT NULL DEFAULT 24');
      addColumn(db, 'reef_rooms', 'expires_at TEXT');
      addColumn(db, 'reef_rooms', 'retention_notice_sent_at TEXT');
      addColumn(db, 'reef_rooms', 'retention_extended_at TEXT');
      addColumn(db, 'reef_rooms', 'destroyed_at TEXT');
      db.exec(`
        CREATE TABLE IF NOT EXISTS reef_members (
          room_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          first_joined_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          last_joined_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (room_id, user_id),
          FOREIGN KEY (room_id) REFERENCES reef_rooms(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_reef_members_room ON reef_members(room_id,first_joined_at);
        CREATE TABLE IF NOT EXISTS reef_retention_votes (
          room_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          vote TEXT NOT NULL CHECK(vote IN ('yes','no')),
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (room_id, user_id),
          FOREIGN KEY (room_id) REFERENCES reef_rooms(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_reef_retention_yes ON reef_retention_votes(room_id,vote);
      `);
      db.prepare("UPDATE reef_rooms SET capacity=444, duration_hours=0, expires_at=NULL WHERE zone='public'").run();
      db.prepare(`
        UPDATE reef_rooms
        SET expires_at = datetime(created_at, '+' || duration_hours || ' hours')
        WHERE zone='private' AND expires_at IS NULL
      `).run();
      const notificationColumns = columns(db, 'notifications');
      if (notificationColumns.has('content')) {
        db.prepare("UPDATE notifications SET content=replace(content,'校准值','熵减值') WHERE instr(content,'校准值') > 0").run();
        if (notificationColumns.has('type')) {
          db.prepare(`
            UPDATE notifications
            SET content=trim(replace(content,'[肆度观测站广播]',''))
            WHERE type='entropy_reward' AND instr(content,'肆度观测站广播') > 0
          `).run();
        }
      }
    },
  },
  {
    id: 'fix_admin_push_timezone_v1',
    up(db) {
      // Legacy migration retained for databases that already recorded this repair.
      // New writes use the shared Beijing-time convention and must not be shifted twice.
      db.prepare("UPDATE notifications SET category='system' WHERE type='system' AND (category IS NULL OR category='')").run();
    },
  },
  {
    id: '018_reef_shared_posts',
    up(db) {
      addColumn(db, 'posts', 'reef_room_id TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_posts_reef_room ON posts(reef_room_id)');
    },
  },
  {
    id: '019_conversation_preferences',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_preferences (
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('chat','reef')),
          target_id TEXT NOT NULL,
          hidden INTEGER NOT NULL DEFAULT 0,
          important INTEGER NOT NULL DEFAULT 0,
          important_at TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (user_id, kind, target_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_conversation_preferences_user_important
          ON conversation_preferences(user_id,important,important_at DESC);
      `);
    },
  },
  {
    id: '020_user_last_online',
    up(db) {
      addColumn(db, 'users', 'last_online_at TEXT');
      const userColumns = columns(db, 'users');
      const fallbackColumns = ['last_login_at', 'created_at'].filter(name => userColumns.has(name));
      const fallback = fallbackColumns.length
        ? `COALESCE(${fallbackColumns.join(', ')}, datetime('now','+8 hours'))`
        : "datetime('now','+8 hours')";
      db.exec(`UPDATE users SET last_online_at=${fallback} WHERE last_online_at IS NULL`);
    },
  },
  {
    id: '021_reef_retention_notification_format',
    up(db) {
      if (!tableExists(db, 'notifications')) return;
      const notificationColumns = columns(db, 'notifications');
      if (!notificationColumns.has('type') || !notificationColumns.has('content')) return;
      const marker = '礁石已创建超过4个小时';
      db.prepare(`
        UPDATE notifications
        SET content = '【' || substr(content, 1, instr(content, ?) - 1) || '】' || substr(content, instr(content, ?))
        WHERE type = 'reef_retention_vote'
          AND content NOT LIKE '【%'
          AND instr(content, ?) > 1
      `).run(marker, marker, marker);
    },
  },
  {
    id: '022_reef_message_reports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reef_message_reports (
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
          calibration_processed INTEGER NOT NULL DEFAULT 0,
          calibration_delta INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (message_id) REFERENCES reef_messages(id) ON DELETE CASCADE,
          FOREIGN KEY (reporter_id) REFERENCES users(id),
          FOREIGN KEY (handled_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_reef_message_reports_status
          ON reef_message_reports(status,created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reef_message_reports_message
          ON reef_message_reports(message_id,reporter_id);
      `);
    },
  },
  {
    id: '023_media_video_support',
    up(db) {
      addColumn(db, 'posts', 'video_url TEXT');
      addColumn(db, 'posts', 'video_poster TEXT');
      addColumn(db, 'posts', 'video_duration_ms INTEGER');
      db.exec(`
        CREATE TABLE IF NOT EXISTS media_assets (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          context_type TEXT NOT NULL,
          media_type TEXT NOT NULL,
          original_url TEXT,
          playback_url TEXT,
          still_url TEXT,
          motion_url TEXT,
          poster_url TEXT,
          mime_type TEXT,
          width INTEGER,
          height INTEGER,
          duration_ms INTEGER,
          size_bytes INTEGER,
          status TEXT NOT NULL DEFAULT 'ready',
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (owner_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_media_assets_owner ON media_assets(owner_id,created_at DESC);
      `);
    },
  },
  {
    id: '024_media_relationships',
    up(db) {
      addColumn(db, 'posts', 'video_media_id TEXT');
      addColumn(db, 'messages', 'media_id TEXT');
      addColumn(db, 'reef_messages', 'media_id TEXT');
      if (tableExists(db, 'media_assets')) {
        db.exec('CREATE INDEX IF NOT EXISTS idx_media_assets_context ON media_assets(context_type,media_type,status)');
      }
    },
  },
  {
    id: '025_post_media_type',
    up(db) {
      addColumn(db, 'posts', 'video_media_type TEXT');
      db.exec(`
        UPDATE posts
        SET video_media_type = (
          SELECT media_type FROM media_assets
          WHERE media_assets.id = posts.video_media_id
        )
        WHERE video_media_id IS NOT NULL AND (video_media_type IS NULL OR video_media_type = '')
      `);
    },
  },
  {
    id: '026_private_message_actions',
    up(db) {
      addColumn(db, 'messages', 'recalled_at TEXT');
      db.exec(`
        CREATE TABLE IF NOT EXISTS message_user_hides (
          message_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (message_id,user_id),
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_message_user_hides_user ON message_user_hides(user_id,message_id);
      `);
    },
  },
  {
    id: '027_reef_reports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reef_reports (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          reporter_id TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT 'other',
          detail TEXT DEFAULT '',
          context_json TEXT DEFAULT '[]',
          status TEXT DEFAULT 'pending',
          handled_by TEXT,
          handle_note TEXT DEFAULT '',
          handled_at TEXT,
          calibration_processed INTEGER NOT NULL DEFAULT 0,
          calibration_delta INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (room_id) REFERENCES reef_rooms(id),
          FOREIGN KEY (reporter_id) REFERENCES users(id),
          FOREIGN KEY (handled_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_reef_reports_status ON reef_reports(status,created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reef_reports_room ON reef_reports(room_id,reporter_id);
      `);
    },
  },
  {
    id: '028_post_live_photos',
    up(db) {
      addColumn(db, 'posts', 'live_photos TEXT DEFAULT \'[]\'');
    },
  },
  {
    id: '029_reef_destroyed_title',
    up(db) {
      if (!tableExists(db, 'notifications')) return;
      const notificationColumns = columns(db, 'notifications');
      if (!notificationColumns.has('title') || !notificationColumns.has('type')) return;
      db.prepare(`
        UPDATE notifications
        SET title='礁石' || title
        WHERE type='reef_destroyed' AND title LIKE '【%'
      `).run();
    },
  },
  {
    id: '030_achievements',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS achievement_definitions (
          key TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          hint TEXT NOT NULL,
          condition_text TEXT NOT NULL,
          is_hidden INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
        );
        CREATE TABLE IF NOT EXISTS user_achievements (
          user_id TEXT NOT NULL,
          achievement_key TEXT NOT NULL,
          unlocked_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          trigger_count INTEGER NOT NULL DEFAULT 1,
          last_triggered_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (user_id,achievement_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (achievement_key) REFERENCES achievement_definitions(key)
        );
        CREATE TABLE IF NOT EXISTS achievement_counters (
          user_id TEXT NOT NULL,
          counter_key TEXT NOT NULL,
          value INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (user_id,counter_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS achievement_events (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          achievement_key TEXT NOT NULL,
          name_snapshot TEXT NOT NULL,
          hint_snapshot TEXT NOT NULL,
          displayed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (achievement_key) REFERENCES achievement_definitions(key)
        );
        CREATE TABLE IF NOT EXISTS achievement_trigger_refs (
          user_id TEXT NOT NULL,
          achievement_key TEXT NOT NULL,
          trigger_ref TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (user_id,achievement_key,trigger_ref),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (achievement_key) REFERENCES achievement_definitions(key)
        );
        CREATE INDEX IF NOT EXISTS idx_achievement_events_pending
          ON achievement_events(user_id,displayed_at,created_at);
        CREATE INDEX IF NOT EXISTS idx_user_achievements_time
          ON user_achievements(user_id,unlocked_at DESC);
      `);

      const definitions = [
        ['absolute_zero','绝对零度','你非常擅长将情绪藏入深海。','累计使用10次【制冷剂】（不论是对自己的切片还是对他人的切片）'],
        ['deep_hibernation','深度休眠','感谢你拔掉网线，在现实世界好好生活。','累计48小时未打开app'],
        ['resonant_echo','同频回声','在 4°C 的水下，两束波长终于重合。','第一次在共振模式下遇到其他人的信标'],
        ['brief_current','短暂的洋流','相聚有时，散场亦是常态。','自己创建的礁石因为不满投票人数，首次被摧毁'],
        ['first_alarm','第一声警报','肆度观测站感谢你的付出，这片海域更加洁净了！','第一次成功提交异常标记，并获得【熵减值】。'],
        ['sonar_short_circuit','声呐短路','你的探测仪进水了，建议晾干后再来。','熵减值因误报被扣除至负数'],
        ['sentient_cable','海底光缆成精','万花丛中过，片叶不沾身。','在潜流域内连续探出了44次失温切片，却没有点击一次【查看完整切片】（退出潜流域则重新开始计算）'],
        ['words_unsaid','欲说还休','却道天凉好个秋。','在发布界面打字超过50个字，然后退出了发布页面。'],
        ['r600a','R600a','你亲手剥离了热量，现在切片将被更多人看见','第一次使用制冷剂'],
        ['active_cooling','主动降温','人与人相互认可，世界因此而美好。','第一次给别人的切片降温（即点赞）'],
        ['make_ripples','制造涟漪','在寂静的 4°C 水域里，多了一道因你而起的微小波纹。','第一次评论别人的切片'],
        ['abyss_dive','深渊潜行','即使是光在这里也会被吞没。','第一次点进潜流域页面'],
        ['ground_state','触及基态','欢迎踏足这片永恒冻土！','第一次点进永冻层页面'],
        ['hz52_broadcast','52赫兹的广播','信号已沉入暗流。寻找同频的波长，需要一点运气和极大的耐心。','第一次投放深海信标'],
        ['slice_salvage','切片打捞','在这个无人知晓的坐标，你稳稳接住了一颗下坠的灵魂。','第一次打捞起一份失温切片'],
        ['prepare_slice','制备切片','情绪已被封装脱水，就让它顺着洋流去吧。','第一次发布切片'],
        ['lay_cable','铺设光缆','在茫茫暗流中，你们为彼此铺设了一条私密的海底通讯专线。','第一次私信别人'],
        ['pelican_town_local','鹈鹕镇老乡','星露谷永远有下一个春天，你也是。','第一次触发注册登录页的像素鸡彩蛋（连续点击logo的那个彩蛋）'],
      ];
      const insert = db.prepare(`
        INSERT OR IGNORE INTO achievement_definitions(key,name,hint,condition_text,sort_order)
        VALUES (?,?,?,?,?)
      `);
      definitions.forEach((item, index) => insert.run(...item, index));
    },
  },
  {
    id: '031_refrigerant_achievement_split',
    up(db) {
      db.prepare(`
        INSERT OR IGNORE INTO achievement_definitions(key,name,hint,condition_text,sort_order)
        VALUES ('hand_fragrance','手留余香','你传递了一瓶制冷剂，但这份静谧的余寒仍停留在你掌心。','第一次赠予其他用户一瓶制冷剂',20)
      `).run();
      db.prepare(`
        UPDATE achievement_definitions
        SET condition_text='第一次对自己或他人的切片使用制冷剂'
        WHERE key='r600a'
      `).run();
    },
  },
  {
    id: '032_slice_boxes_and_daily_post_refrigerant',
    up(db) {
      addColumn(db, 'posts', 'slice_box_id TEXT');
      db.exec(`
        CREATE TABLE IF NOT EXISTS slice_boxes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_slice_boxes_user
          ON slice_boxes(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_posts_slice_box
          ON posts(slice_box_id);
        CREATE TABLE IF NOT EXISTS post_refrigerant_daily_uses (
          post_id TEXT NOT NULL,
          use_date TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (post_id, use_date),
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: '033_expand_board_catalog',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      db.prepare(`
        UPDATE boards
        SET name='NOW', updated_at=datetime('now','+8 hours')
        WHERE name='闲聊'
          AND NOT EXISTS (SELECT 1 FROM boards WHERE name='NOW')
      `).run();

      // “摄影”和“音乐”已是现有冰格，故不重复插入。
      const newBoards = [
        ['board_love', '恋爱', 'heart-outline', '#F28DB2'],
        ['board_wallpaper', '壁纸', 'images-outline', '#7187D8'],
        ['board_rant', '吐槽', 'chatbox-ellipses-outline', '#E17A2F'],
        ['board_tv', '追剧', 'tv-outline', '#8854D0'],
        ['board_secret', '秘密', 'lock-closed-outline', '#5B8DB8'],
        ['board_idol', '爱豆', 'star-outline', '#F39ABD'],
        ['board_lonely', '孤独', 'moon-outline', '#64748B'],
        ['board_anime', '二次元', 'sparkles-outline', '#8B5CF6'],
        ['board_happy', '开心', 'happy-outline', '#F59E0B'],
        ['board_worries', '烦恼', 'rainy-outline', '#6B7C93'],
        ['board_tipsy', '微醺', 'wine-outline', '#B76E79'],
        ['board_painting', '绘画', 'color-palette-outline', '#D977B7'],
        ['board_crush', '暗恋', 'rose-outline', '#DB7093'],
        ['board_feedback', '肆度反馈', 'megaphone-outline', '#33A9DC'],
        ['board_ex', 'Ex', 'heart-dislike-outline', '#7C8797'],
        ['board_abstract', '抽象', 'shapes-outline', '#6D5BD0'],
        ['board_lovewins', 'LoveWins', 'heart-circle-outline', '#E35D9F'],
        ['board_joy', '喜', 'sunny-outline', '#E9A23B'],
        ['board_silly', '沙雕', 'fish-outline', '#22A6B3'],
        ['board_angry', '怒', 'flame-outline', '#E05260'],
        ['board_flirt', '可撩', 'chatbubbles-outline', '#EF72A6'],
        ['board_sorrow', '哀', 'sad-outline', '#6D7F9B'],
        ['board_selfie', '自拍', 'camera-reverse-outline', '#A66DD4'],
        ['board_fun', '乐', 'musical-note-outline', '#F2A65A'],
        ['board_help', '求助', 'help-buoy-outline', '#3A9CC9'],
        ['board_down', '丧', 'cloud-outline', '#697586'],
        ['board_memes', '表情包', 'happy-outline', '#F08C46'],
        ['board_numb', '麻了', 'pulse-outline', '#778899'],
        ['board_slacking', '摸鱼', 'fish-outline', '#35A7A0'],
      ];
      const insert = db.prepare(`
        INSERT OR IGNORE INTO boards(id,name,description,icon,color,color_dark,sort)
        VALUES (?,?,?,?,?,?,?)
      `);
      newBoards.forEach((board, index) => insert.run(
        board[0], board[1], '', board[2], board[3], board[3], 17 + index,
      ));
    },
  },
  {
    id: '034_diversify_new_board_colors',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      const colors = [
        ['board_love', '#FF5C8A', '#FF91AF'],
        ['board_wallpaper', '#536DFE', '#8B9BFF'],
        ['board_rant', '#FF7043', '#FF9E7E'],
        ['board_tv', '#7E57C2', '#A98AD8'],
        ['board_secret', '#263238', '#60717A'],
        ['board_idol', '#FFD600', '#FFE65B'],
        ['board_lonely', '#455A64', '#7C8F98'],
        ['board_anime', '#00B8D4', '#5ED5E5'],
        ['board_happy', '#FFB300', '#FFD05A'],
        ['board_worries', '#5C6BC0', '#929CDA'],
        ['board_tipsy', '#8E244D', '#BA6684'],
        ['board_painting', '#00A86B', '#58C79A'],
        ['board_crush', '#D81B60', '#EA6F9A'],
        ['board_feedback', '#0097A7', '#55BBC5'],
        ['board_ex', '#37474F', '#718188'],
        ['board_abstract', '#651FFF', '#9A6BFF'],
        ['board_lovewins', '#FF1744', '#FF718C'],
        ['board_joy', '#F57C00', '#F8AD55'],
        ['board_silly', '#00ACC1', '#59CAD7'],
        ['board_angry', '#D50000', '#E85E5E'],
        ['board_flirt', '#F06292', '#F59BB9'],
        ['board_sorrow', '#3949AB', '#7783C9'],
        ['board_selfie', '#AB47BC', '#C981D3'],
        ['board_fun', '#FDD835', '#FFE875'],
        ['board_help', '#1976D2', '#67A5E2'],
        ['board_down', '#546E7A', '#899CA5'],
        ['board_memes', '#76C043', '#A4D77E'],
        ['board_numb', '#795548', '#A4887E'],
        ['board_slacking', '#00897B', '#57B5AB'],
      ];
      const update = db.prepare(`
        UPDATE boards
        SET color=?, color_dark=?, updated_at=datetime('now','+8 hours')
        WHERE id=?
      `);
      colors.forEach(([id, color, colorDark]) => update.run(color, colorDark, id));
    },
  },
  {
    id: '035_brighten_board_colors',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      // 仅更新主题色；图标字段保持不变。
      const colors = [
        ['b1', '#7C6CF2', '#AAA0FF'], ['b2', '#20BFA9', '#67DDCD'],
        ['b3', '#FF8A5C', '#FFB08F'], ['b4', '#F062A6', '#F79BC7'],
        ['b5', '#3D9BFF', '#78BAFF'], ['b6', '#27C6BE', '#70DED9'],
        ['b15', '#7586E8', '#A3AFF4'], ['b7', '#FF9F43', '#FFC273'],
        ['b8', '#32C878', '#76E1A5'], ['b9', '#4B9FEF', '#83BDF4'],
        ['b10', '#5C7CFA', '#92A7FF'], ['b11', '#EC65B7', '#F29BCF'],
        ['b12', '#9B6DF2', '#BDA0F7'], ['b13', '#36B6E8', '#79D2F2'],
        ['b14', '#F4B942', '#F8D27E'],
        ['board_love', '#FF6B9A', '#FF9ABA'], ['board_wallpaper', '#6485FF', '#96AAFF'],
        ['board_rant', '#FF7A59', '#FFA38D'], ['board_tv', '#9A6DF0', '#BE9CF5'],
        ['board_secret', '#5D8DEF', '#8FB1F5'], ['board_idol', '#F5B82E', '#F9D36F'],
        ['board_lonely', '#6F8FEA', '#9EB3F2'], ['board_anime', '#25BFD3', '#70D8E5'],
        ['board_happy', '#FFB52E', '#FFD273'], ['board_worries', '#7890F0', '#A5B5F5'],
        ['board_tipsy', '#D9689A', '#E99ABD'], ['board_painting', '#32BE83', '#78D8AB'],
        ['board_crush', '#EF5D91', '#F493B5'], ['board_feedback', '#2DB9C8', '#75D4DD'],
        ['board_ex', '#7188DE', '#A0B0EA'], ['board_abstract', '#8C68F5', '#B29BF8'],
        ['board_lovewins', '#FF5F7E', '#FF93A8'], ['board_joy', '#FF9D3D', '#FFC077'],
        ['board_silly', '#2BB8C9', '#73D2DC'], ['board_angry', '#FF625F', '#FF9794'],
        ['board_flirt', '#F36EA5', '#F79DC2'], ['board_sorrow', '#7287E8', '#A0AFF1'],
        ['board_selfie', '#B46DE8', '#CE9DF0'], ['board_fun', '#F2BC32', '#F7D574'],
        ['board_help', '#438FEF', '#7DB5F5'], ['board_down', '#7596D8', '#A2B8E5'],
        ['board_memes', '#65BE4D', '#98D588'], ['board_numb', '#A875E0', '#C59DEA'],
        ['board_slacking', '#2EB89F', '#74D2C1'],
      ];
      const update = db.prepare(`
        UPDATE boards
        SET color=?, color_dark=?, updated_at=datetime('now','+8 hours')
        WHERE id=?
      `);
      colors.forEach(([id, color, colorDark]) => update.run(color, colorDark, id));
    },
  },
  {
    id: '036_unify_board_outline_icons',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      const icons = [
        ['b1', 'cafe-outline'], ['b2', 'hardware-chip-outline'],
        ['b3', 'restaurant-outline'], ['b4', 'game-controller-outline'],
        ['b5', 'airplane-outline'], ['b6', 'book-outline'],
        ['b15', 'film-outline'], ['b7', 'paw-outline'],
        ['b8', 'barbell-outline'], ['b9', 'briefcase-outline'],
        ['b10', 'school-outline'], ['b11', 'musical-notes-outline'],
        ['b12', 'camera-outline'], ['b13', 'heart-half-outline'],
        ['b14', 'home-outline'], ['board_fun', 'emoticon-lol-outline'],
      ];
      const update = db.prepare(`
        UPDATE boards
        SET icon=?, updated_at=datetime('now','+8 hours')
        WHERE id=?
      `);
      icons.forEach(([id, icon]) => update.run(icon, id));
    },
  },
  {
    id: '037_board_categories',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      addColumn(db, 'boards', "category TEXT NOT NULL DEFAULT '生活'");
      const placements = [
        ['b1', '情绪', 0], ['board_joy', '情绪', 1], ['board_angry', '情绪', 2],
        ['board_sorrow', '情绪', 3], ['board_fun', '情绪', 4], ['board_rant', '情绪', 5],
        ['board_secret', '情绪', 6], ['board_lonely', '情绪', 7], ['board_happy', '情绪', 8],
        ['board_worries', '情绪', 9], ['board_tipsy', '情绪', 10], ['board_crush', '情绪', 11],
        ['board_down', '情绪', 12],
        ['board_selfie', '共鸣', 0], ['board_love', '共鸣', 1], ['board_idol', '共鸣', 2],
        ['board_flirt', '共鸣', 3], ['board_help', '共鸣', 4], ['b13', '共鸣', 5],
        ['board_wallpaper', '兴趣', 0], ['board_tv', '兴趣', 1], ['board_anime', '兴趣', 2],
        ['b12', '兴趣', 3], ['b11', '兴趣', 4], ['board_painting', '兴趣', 5],
        ['board_abstract', '兴趣', 6], ['board_silly', '兴趣', 7], ['board_memes', '兴趣', 8],
        ['b4', '兴趣', 9], ['b15', '兴趣', 10], ['b6', '兴趣', 11],
        ['b2', '生活', 0], ['b3', '生活', 1], ['b5', '生活', 2], ['b7', '生活', 3],
        ['b8', '生活', 4], ['b9', '生活', 5], ['b10', '生活', 6], ['b14', '生活', 7],
        ['board_slacking', '生活', 8],
        ['board_numb', '404', 0], ['board_ex', '404', 1],
        ['board_lovewins', '404', 2], ['board_feedback', '404', 3],
        ['free', '系统', 0], ['announce', '系统', 1],
      ];
      const update = db.prepare("UPDATE boards SET category=?,sort=?,updated_at=datetime('now','+8 hours') WHERE id=?");
      placements.forEach(([id, category, sort]) => update.run(category, sort, id));
    },
  },
  {
    id: '038_merge_happy_board_into_joy',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      if (tableExists(db, 'posts') && columns(db, 'posts').has('board_id')) {
        db.prepare("UPDATE posts SET board_id='board_joy' WHERE board_id='board_happy'").run();
      }
      db.prepare("UPDATE boards SET icon='happy-outline',updated_at=datetime('now','+8 hours') WHERE id='board_joy'").run();
      db.prepare("UPDATE boards SET icon='emoticon-angry-outline',updated_at=datetime('now','+8 hours') WHERE id='board_angry'").run();
      db.prepare("DELETE FROM boards WHERE id='board_happy'").run();
    },
  },
  {
    id: '039_board_shelf_status',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      addColumn(db, 'boards', 'is_active INTEGER NOT NULL DEFAULT 1');
    },
  },
  {
    id: '040_idempotency_and_counter_repair',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS idempotency_requests (
          user_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          request_key TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending',
          response_status INTEGER,
          response_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (user_id, scope, request_key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_idempotency_requests_updated
          ON idempotency_requests(updated_at);
      `);
      if (tableExists(db, 'posts') && tableExists(db, 'comments') && columns(db, 'posts').has('comments_count')) {
        db.prepare(`
          UPDATE posts
          SET comments_count = (
            SELECT COUNT(*) FROM comments
            WHERE comments.post_id = posts.id AND comments.status = 'active'
          )
        `).run();
      }
    },
  },
  {
    id: '041_hot_path_composite_indexes',
    up(db) {
      if (tableExists(db, 'posts')) {
        const postColumns = columns(db, 'posts');
        if (postColumns.has('status') && postColumns.has('created_at')) {
          db.exec('CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts(status, created_at DESC)');
        }
      }
      if (tableExists(db, 'comments')) {
        const commentColumns = columns(db, 'comments');
        if (commentColumns.has('post_id') && commentColumns.has('status') && commentColumns.has('created_at')) {
          db.exec('CREATE INDEX IF NOT EXISTS idx_comments_post_status_created ON comments(post_id, status, created_at ASC, id ASC)');
        }
      }
      if (tableExists(db, 'notifications')) {
        const notificationColumns = columns(db, 'notifications');
        if (notificationColumns.has('user_id') && notificationColumns.has('is_read') && notificationColumns.has('created_at')) {
          db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id, is_read, created_at DESC)');
        }
      }
      if (tableExists(db, 'messages')) {
        const messageColumns = columns(db, 'messages');
        if (messageColumns.has('from_user_id') && messageColumns.has('to_user_id') && messageColumns.has('created_at')) {
          db.exec('CREATE INDEX IF NOT EXISTS idx_messages_pair_created ON messages(from_user_id, to_user_id, created_at DESC, id DESC)');
        }
      }
    },
  },
  {
    id: '042_persistent_login_throttles',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS login_throttles (
          scope TEXT NOT NULL,
          subject_hash TEXT NOT NULL,
          failure_count INTEGER NOT NULL DEFAULT 0,
          window_started_at INTEGER NOT NULL,
          blocked_until INTEGER,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (scope, subject_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_login_throttles_updated
          ON login_throttles(updated_at);
      `);
    },
  },
  {
    id: '043_hash_security_answers',
    up(db) {
      if (!tableExists(db, 'users') || !columns(db, 'users').has('security_answer')) return;
      const answers = db.prepare(`
        SELECT id, security_answer
        FROM users
        WHERE security_answer IS NOT NULL AND TRIM(security_answer) != ''
      `).all();
      const update = db.prepare('UPDATE users SET security_answer = ? WHERE id = ?');
      answers.forEach((user) => {
        if (/^\$2[aby]\$\d{2}\$/.test(user.security_answer)) return;
        update.run(bcrypt.hashSync(String(user.security_answer), 10), user.id);
      });
    },
  },
  {
    id: '044_video_media_feature_flag',
    up(db) {
      db.prepare(`
        INSERT OR IGNORE INTO feature_flags(key,label,description,enabled,rollout_percent)
        VALUES ('video_media','视频与实况照片','控制 App 发布、私信和礁石中的视频及实况照片上传；关闭后历史内容仍可查看',0,0)
      `).run();
    },
  },
  {
    id: '045_split_video_from_live_photos',
    up(db) {
      db.prepare(`
        INSERT OR IGNORE INTO feature_flags(key,label,description,enabled,rollout_percent)
        SELECT 'video_upload','普通视频','控制 App 发布、私信和礁石中的普通视频上传；不影响实况照片和历史视频查看',enabled,rollout_percent
        FROM feature_flags WHERE key='video_media'
      `).run();
      db.prepare(`
        INSERT OR IGNORE INTO feature_flags(key,label,description,enabled,rollout_percent)
        VALUES ('video_upload','普通视频','控制 App 发布、私信和礁石中的普通视频上传；不影响实况照片和历史视频查看',0,0)
      `).run();
      db.prepare("DELETE FROM feature_flags WHERE key='video_media'").run();
    },
  },
  {
    id: '046_achievement_notification_title',
    up(db) {
      if (!tableExists(db, 'notifications')) return;
      const notificationColumns = columns(db, 'notifications');
      if (!notificationColumns.has('type') || !notificationColumns.has('title')) return;
      db.prepare(`
        UPDATE notifications
        SET title = CASE
          WHEN title LIKE '航行日志 · %'
            THEN '航行日志解锁：' || substr(title, length('航行日志 · ') + 1)
          WHEN title NOT LIKE '航行日志解锁：%'
            THEN '航行日志解锁：' || COALESCE(NULLIF(title,''),'未知成就')
          ELSE title
        END
        WHERE type='achievement'
      `).run();
    },
  },
  {
    id: '047_follow_notification_actor',
    up(db) {
      if (!tableExists(db, 'notifications') || !tableExists(db, 'follows')) return;
      const notificationColumns = columns(db, 'notifications');
      if (!notificationColumns.has('related_id') || !notificationColumns.has('created_at')) return;
      db.prepare(`
        UPDATE notifications
        SET related_id = (
          SELECT f.follower_id
          FROM follows f
          WHERE f.following_id=notifications.user_id
            AND f.created_at<=datetime(notifications.created_at,'+1 minute')
          ORDER BY f.created_at DESC
          LIMIT 1
        )
        WHERE type='follow' AND (related_id IS NULL OR related_id='')
      `).run();
    },
  },
  {
    id: '048_post_thumbnails',
    up(db) {
      if (!tableExists(db, 'posts')) return;
      const postColumns = columns(db, 'posts');
      addColumn(db, 'posts', "thumbnails TEXT DEFAULT '[]'");
      if (postColumns.has('images')) {
        db.prepare(`
          UPDATE posts
          SET thumbnails=COALESCE(NULLIF(images,''),'[]')
          WHERE thumbnails IS NULL OR thumbnails='' OR thumbnails='[]'
        `).run();
      }
    },
  },
  {
    id: '049_tencent_content_moderation',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS moderation_tasks (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL CHECK (target_type IN ('post','comment','message')),
          target_id TEXT NOT NULL,
          author_id TEXT NOT NULL,
          related_user_id TEXT,
          content_snapshot TEXT NOT NULL DEFAULT '',
          media_snapshot TEXT NOT NULL DEFAULT '[]',
          content_hash TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued'
            CHECK (status IN ('queued','processing','passed','needs_review','failed')),
          provider TEXT NOT NULL DEFAULT 'tencent_cloud',
          risk_label TEXT NOT NULL DEFAULT '',
          risk_score INTEGER NOT NULL DEFAULT 0,
          provider_result_json TEXT NOT NULL DEFAULT '[]',
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          next_attempt_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          checked_at TEXT,
          admin_status TEXT NOT NULL DEFAULT 'pending'
            CHECK (admin_status IN ('pending','normal','violation')),
          handled_by TEXT,
          handled_at TEXT,
          handle_action TEXT NOT NULL DEFAULT '',
          handle_note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          UNIQUE (target_type, target_id),
          FOREIGN KEY (author_id) REFERENCES users(id),
          FOREIGN KEY (related_user_id) REFERENCES users(id),
          FOREIGN KEY (handled_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_moderation_tasks_queue
          ON moderation_tasks(status, next_attempt_at, created_at);
        CREATE INDEX IF NOT EXISTS idx_moderation_tasks_review
          ON moderation_tasks(admin_status, status, risk_score DESC, created_at);
        CREATE INDEX IF NOT EXISTS idx_moderation_tasks_author
          ON moderation_tasks(author_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS moderation_result_cache (
          unit_type TEXT NOT NULL CHECK (unit_type IN ('text','image')),
          content_hash TEXT NOT NULL,
          suggestion TEXT NOT NULL DEFAULT 'Pass',
          risk_label TEXT NOT NULL DEFAULT 'Normal',
          risk_score INTEGER NOT NULL DEFAULT 0,
          result_json TEXT NOT NULL DEFAULT '{}',
          checked_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (unit_type, content_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_moderation_cache_checked
          ON moderation_result_cache(checked_at);
      `);
    },
  },
  {
    id: '050_moderation_context_and_comment_stickers',
    up(db) {
      if (tableExists(db, 'moderation_tasks')) {
        addColumn(db, 'moderation_tasks', "context_snapshot TEXT NOT NULL DEFAULT '[]'");
      }
      if (tableExists(db, 'comments')) {
        addColumn(db, 'comments', "kind TEXT NOT NULL DEFAULT 'text'");
        addColumn(db, 'comments', "media_url TEXT NOT NULL DEFAULT ''");
      }
    },
  },
  {
    id: '051_moderation_light_violation',
    up(db) {
      if (!tableExists(db, 'moderation_tasks')) return;
      addColumn(db, 'moderation_tasks', 'light_violation INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'moderation_tasks', "light_note TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'moderation_tasks', 'light_marked_by TEXT');
      addColumn(db, 'moderation_tasks', 'light_marked_at TEXT');
      db.exec(`CREATE INDEX IF NOT EXISTS idx_moderation_tasks_light
        ON moderation_tasks(light_violation, admin_status, created_at)`);
    },
  },
  {
    id: '052_app_releases',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_releases (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL CHECK (platform IN ('android')),
          version_code INTEGER NOT NULL CHECK (version_code > 0),
          version_name TEXT NOT NULL,
          runtime_version TEXT NOT NULL DEFAULT '',
          apk_url TEXT NOT NULL,
          file_size INTEGER NOT NULL DEFAULT 0,
          md5 TEXT NOT NULL DEFAULT '',
          sha256 TEXT NOT NULL DEFAULT '',
          release_notes TEXT NOT NULL DEFAULT '',
          mandatory INTEGER NOT NULL DEFAULT 0 CHECK (mandatory IN (0,1)),
          is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          published_at TEXT,
          UNIQUE (platform, version_code),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_app_releases_latest
          ON app_releases(platform, is_active, version_code DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_app_releases_one_active
          ON app_releases(platform) WHERE is_active=1;
      `);
    },
  },
  {
    id: '053_refrigerant_cold_tank',
    up(db) {
      addColumn(db, 'users', 'gifted_refrigerant_count INTEGER NOT NULL DEFAULT 0');
      // Development temporarily granted 99/999 bottles in the spendable pool.
      // Restore the product limit without converting test inventory into gifts.
      db.prepare(`
        UPDATE users
        SET refrigerant_count = CASE
          WHEN COALESCE(refrigerant_count, 0) < 0 THEN 0
          WHEN refrigerant_count > 4 THEN 4
          ELSE refrigerant_count
        END
      `).run();
    },
  },
  {
    id: '054_frost_shells',
    up(db) {
      if (tableExists(db, 'users')) {
        addColumn(db, 'users', 'fragile_frost_shell_count INTEGER NOT NULL DEFAULT 0');
        addColumn(db, 'users', 'eternal_frost_shell_count INTEGER NOT NULL DEFAULT 0');
        addColumn(db, 'users', 'frost_shell_online_seconds INTEGER NOT NULL DEFAULT 0');
        addColumn(db, 'users', 'frost_shell_online_progress_date TEXT');
        addColumn(db, 'users', 'frost_shell_daily_claim_date TEXT');
        db.prepare(`
          UPDATE users
          SET eternal_frost_shell_count = COALESCE(gifted_refrigerant_count, 0)
        `).run();
      }
      if (tableExists(db, 'comments')) {
        addColumn(db, 'comments', 'frost_shell_count INTEGER NOT NULL DEFAULT 0');
        db.prepare(`
          UPDATE comments
          SET frost_shell_count = refrigerant_count
          WHERE COALESCE(refrigerant_count, 0) > 0
        `).run();
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS frost_shell_transfers (
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
        CREATE INDEX IF NOT EXISTS idx_frost_shell_transfers_from
          ON frost_shell_transfers(from_user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_frost_shell_transfers_to
          ON frost_shell_transfers(to_user_id, created_at DESC);
      `);
      if (tableExists(db, 'achievement_definitions')) {
        db.prepare(`
          UPDATE achievement_definitions
          SET hint = '你非常擅长将情绪藏入深海。',
              condition_text = '累计使用10次【制冷剂】（不论是对自己的切片还是对他人的切片）'
          WHERE key = 'absolute_zero'
        `).run();
        db.prepare(`
          UPDATE achievement_definitions
          SET hint = '你传递了一枚脆弱浮霜贝，但这份友好的涟漪仍留在你心里。',
              condition_text = '第一次通过个人主页、私信或评论入口成功赠予其他用户 1 枚脆弱浮霜贝'
          WHERE key = 'hand_fragrance'
        `).run();
        db.prepare(`
          UPDATE achievement_definitions
          SET hint = '信号已沉入暗流。寻找同频的波长，需要一点运气和极大的耐心。',
              condition_text = '累计为陌生人的切片赠予 50 枚脆弱浮霜贝'
          WHERE key = 'deep_sea_lantern'
        `).run();
      }
    },
  },
  {
    id: '055_frost_shell_gift_rules',
    up(db) {
      if (tableExists(db, 'achievement_definitions')) {
        db.prepare(`
          UPDATE achievement_definitions
          SET hint = replace(hint, '脆弱的浮霜贝', '脆弱浮霜贝'),
              condition_text = replace(condition_text, '脆弱的浮霜贝', '脆弱浮霜贝')
          WHERE hint LIKE '%脆弱的浮霜贝%' OR condition_text LIKE '%脆弱的浮霜贝%'
        `).run();
      }
    },
  },
  {
    id: '056_remove_retired_achievements',
    up(db) {
      const retired = ['unknown_current', 'deep_sea_lantern'];
      if (tableExists(db, 'achievement_events')) {
        db.prepare(`DELETE FROM achievement_events WHERE achievement_key IN (?,?)`).run(...retired);
      }
      if (tableExists(db, 'achievement_trigger_refs')) {
        db.prepare(`DELETE FROM achievement_trigger_refs WHERE achievement_key IN (?,?)`).run(...retired);
      }
      if (tableExists(db, 'user_achievements')) {
        db.prepare(`DELETE FROM user_achievements WHERE achievement_key IN (?,?)`).run(...retired);
      }
      if (tableExists(db, 'achievement_counters')) {
        db.prepare(`DELETE FROM achievement_counters WHERE counter_key='stranger_frost_shell_gifts'`).run();
      }
      if (tableExists(db, 'notifications') && columns(db, 'notifications').has('related_id')) {
        db.prepare(`DELETE FROM notifications WHERE type='achievement' AND related_id IN (?,?)`).run(...retired);
      }
      if (tableExists(db, 'achievement_definitions')) {
        db.prepare(`DELETE FROM achievement_definitions WHERE key IN (?,?)`).run(...retired);
      }
    },
  },
  {
    id: '057_reef_read_state',
    up(db) {
      if (!tableExists(db, 'conversation_preferences')) return;
      addColumn(db, 'conversation_preferences', 'last_read_at TEXT');
      addColumn(db, 'conversation_preferences', 'last_read_message_id TEXT');
    },
  },
  {
    id: '058_app_update_logs',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_update_logs (
          id TEXT PRIMARY KEY,
          stage TEXT NOT NULL DEFAULT 'development' CHECK (stage IN ('development','production')),
          platform TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('android','ios','all')),
          version_name TEXT NOT NULL UNIQUE,
          update_id TEXT UNIQUE,
          runtime_version TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          release_notes TEXT NOT NULL DEFAULT '',
          release_date TEXT NOT NULL,
          is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1)),
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (created_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_app_update_logs_date
          ON app_update_logs(is_visible, release_date DESC, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_app_update_logs_update
          ON app_update_logs(update_id);
      `);

      const seed = db.prepare(`
        INSERT OR IGNORE INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'all', ?, '', ?, ?, ?, 1)
      `);
      const history = [
        ['DEV-001','项目启航','完成 App 初始工程、基础页面与视觉方向。','2026-07-18'],
        ['DEV-002','服务端与云存储接入','建立服务端、管理后台、真实数据库、腾讯云 COS 与验证码注册。','2026-07-19'],
        ['DEV-003','私信与图片体验','加入私信图片查看器、键盘滚动、内容可见性和图标优化。','2026-07-20'],
        ['DEV-004','真实 API 全面联调','App 全面接入真实 API，完善游客拦截、退出登录与 EAS 构建。','2026-07-21'],
        ['DEV-005','注册与上传流程','完善注册流程、数字 UID、COS 上传与多项稳定性修复。','2026-07-22'],
        ['DEV-006','后台与社区 UI 迭代','重构管理后台并升级 App 社区页面和交互。','2026-07-23'],
        ['DEV-007','通知和潜流域','私信服务端化，加入通知系统、潜流域和永冻层入口。','2026-07-24'],
        ['DEV-008','温度与媒体查看','统一 UTC+8，完善温度条、缩略图、图片查看器和计数同步。','2026-07-25'],
        ['DEV-009','实时聊天基础','加入 WebSocket 事件队列、轮询兜底、表情包持久化和聊天键盘优化。','2026-07-26'],
        ['DEV-010','社区体验整理','集中修复社区浏览、个人资料与消息交互问题。','2026-07-27'],
        ['DEV-011','性别与每日话题','统一跨设备性别标签，完善每日话题状态、入口和历史话题浏览。','2026-07-28'],
        ['DEV-012','潜流双模式','加入潜流域双模式、深海信标、官方账号、单设备登录和账号处罚。','2026-07-29'],
        ['DEV-013','媒体浏览性能','优化图片缩放、左右切换、浮霜带分页动画和潜流域计数一致性。','2026-07-30'],
        ['DEV-014','隐海礁原型','建立隐海礁、公海与领海、礁石卡片及聊天室基础结构。','2026-07-31'],
        ['DEV-015','数据安全与恢复','恢复 7 月末迭代成果，加固数据库备份与灾难恢复。','2026-08-01'],
        ['DEV-016','礁石实时聊天','完善礁石实时消息、成员头像、存续许可与私人礁石创建规则。','2026-08-02'],
        ['DEV-017','消息快捷入口','加入礁石消息卡片、收藏与置顶、切片内分享礁石卡片。','2026-08-03'],
        ['DEV-018','后台与 App 综合优化','同步 App、管理后台与服务端的功能和体验改进。','2026-08-04'],
        ['DEV-019','熵减举报体系','建立熵减值、称号阶梯、举报奖励与误报惩罚机制。','2026-08-05'],
        ['DEV-020','审核与申诉流程','完善管理后台举报快照、处罚理由、申诉处理及账号状态展示。','2026-08-06'],
        ['DEV-021','成就、礁石与富媒体','加入成就系统、礁石群聊及图片、实况照片等富媒体流程。','2026-08-07'],
        ['DEV-022','实况照片体验','优化实况照片多选、查看器、长按播放、九宫格和媒体拖动排序。','2026-08-08'],
        ['DEV-023','稳定性与安全加固','完善社区功能，强化运行时稳定性、鉴权、WebSocket 和服务器安全。','2026-08-09'],
        ['DEV-024','开屏与体验优化','同步开屏、稳定性、安全策略和多项交互优化。','2026-08-10'],
        ['DEV-025','云端 Android 构建','建立 GitHub Actions Android 构建、签名和 App 在线更新模块。','2026-08-11'],
        ['DEV-026','生产 OTA 与社区修复','上线生产 OTA 并发缓存和浮霜贝体系；修复降温同步、礁石键盘、聊天时间与切片即时删除。','2026-08-12'],
      ];
      history.forEach(([version, title, notes, date], index) => {
        seed.run(`update-log-seed-${String(index + 1).padStart(3, '0')}`, version, title, notes, date);
      });
      db.prepare(`
        UPDATE app_update_logs
        SET update_id='019ff5f7-b76c-716b-b545-533faec1b5ab',
            runtime_version='1.0.2', platform='android'
        WHERE version_name='DEV-026'
      `).run();
    },
  },
  {
    id: '059_update_log_dev_027',
    up(db) {
      db.prepare(`
        INSERT OR IGNORE INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, '1.0.2', ?, ?, ?, 1)
      `).run(
        'update-log-seed-027',
        'DEV-027',
        '这次用起来更顺手了',
        '贝壳规则里的四条说明现在排得更整齐，一眼就能看懂。\n贝壳和脆弱浮霜贝换成了更简洁的图标，看起来没那么复杂。\n评论区的表情包现在也能长按了，可以预览、移到最前或删除。',
        '2026-08-12',
      );
    },
  },
  {
    id: '060_bind_update_log_dev_027',
    up(db) {
      db.prepare(`
        UPDATE app_update_logs
        SET update_id=?, runtime_version='1.0.2', platform='android',
            updated_at=datetime('now','+8 hours')
        WHERE version_name='DEV-027'
      `).run('019ff69c-332e-7b23-8cce-2e9aa6e75342');
    },
  },
  {
    id: '061_refresh_update_log_dev_027',
    up(db) {
      db.prepare(`
        UPDATE app_update_logs
        SET title=?, release_notes=?, release_date='2026-08-12',
            update_id='019ff69c-332e-7b23-8cce-2e9aa6e75342',
            runtime_version='1.0.2', platform='android', is_visible=1,
            updated_at=datetime('now','+8 hours')
        WHERE version_name='DEV-027'
      `).run(
        '这次用起来更顺手了',
        '贝壳规则里的四条说明现在排得更整齐，一眼就能看懂。\n贝壳和脆弱浮霜贝换成了更简洁的图标，看起来没那么复杂。\n评论区的表情包现在也能长按了，可以预览、移到最前或删除。',
      );
    },
  },
  {
    id: '062_update_log_dev_028',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, ?, '1.0.2', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-028',
        'DEV-028',
        '019ff8ca-d40e-7fbf-b9c4-60e24befdb82',
        '评论和贝壳规则都顺手多了',
        '自己发出的评论现在可以长按删除，不会再看到举报和拉黑自己的选项。\n评论删除后会立刻从页面消失，评论数量也会马上同步。\n贝壳规则的四条说明重新收紧了间距，第二条和第三条不再莫名断开。',
        '2026-08-13',
      );
    },
  },
  {
    id: '063_update_log_dev_029',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, ?, '1.0.2', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-029',
        'DEV-029',
        '019ff8d8-d8d4-7e0c-bcf5-9cabca6a143e',
        '排版舒服了，选择也会被记住',
        '贝壳规则恢复了舒服的文字行距，四条规则之间则保持一样的整体间隔。\n礁石存续许可现在会记住你的选择，再次打开时会直接告诉你选择了是或否。\n每个人只能为同一份存续许可选择一次，做出选择后不能反复修改。',
        '2026-08-13',
      );
    },
  },
  {
    id: '064_update_log_dev_030',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, ?, '1.0.2', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-030',
        'DEV-030',
        '019ff8ed-758d-75ed-a6ea-b05c61655827',
        '检查更新更快更稳了',
        '检查更新现在会先从国内服务器快速确认，已经是最新版时不用再绕远路等待。\n遇到更新服务偶尔不稳定时，等待时间会更短，也不会连续重试很久。\n下一版安装包会把更新下载也切到国内中转，多台设备一起更新会更稳。',
        '2026-08-13',
      );
    },
  },
  {
    id: '065_update_log_dev_031',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, ?, '1.0.2', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-031',
        'DEV-031',
        '019ff969-3b7c-7953-94cd-b2805e322d5f',
        '协议和隐私页面的公司信息更新了',
        '协议与隐私页面中的公司主体名称已更新为 NOESIS，查看法律文件时会看到最新信息。',
        '2026-08-13',
      );
    },
  },
  {
    id: '066_report_handle_actions',
    up(db) {
      for (const table of ['post_reports', 'comment_reports', 'message_reports', 'reef_message_reports', 'reef_reports']) {
        addColumn(db, table, "handle_action TEXT NOT NULL DEFAULT ''");
      }
    },
  },
  {
    id: '067_management_roles',
    up(db) {
      db.prepare("UPDATE users SET role='reviewer' WHERE role='admin'").run();
    },
  },
  {
    id: '068_reconcile_post_comment_counts',
    up(db) {
      db.prepare(`
        UPDATE posts
        SET comments_count = (
          SELECT COUNT(*)
          FROM comments
          WHERE comments.post_id = posts.id AND comments.status = 'active'
        )
      `).run();
    },
  },
  {
    id: '069_update_log_dev_032',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, ?, '1.0.2', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-032',
        'DEV-032',
        '01a01750-3c0f-7d22-bdd3-5ee16985b4ef',
        '管理能力补齐，稳定性全面加固',
        '管理后台新增完整的管理人员体系：后台超级管理员、后台审核员和 APP 管理员可以分别分配，创建管理账户和调整已有账户角色也统一集中管理。赋予 APP 管理员时会先通过 UID 搜索并展示头像、昵称、用户名与 UID，核对无误后才能确认。\nAPP 管理员现在可以在 App 内长按切片进入特殊选项，按照与后台一致的理由和时长执行删除切片、禁言或封禁；所有处置都会写入通知与管理日志。\n腾讯云二审和后台消息记录现在可以还原显示文字、图片、视频、实况照片及切片或评论来源，不再把媒体内容显示成一串链接。申诉处理补充了违规图片记录，举报、二审和申诉卡片统一显示明确的处置结果。\n礁石管理补齐了完整的摧毁联动：被确认违规的礁石会通知创建者和所有发言用户，相关切片仍保留礁石卡片并显示“该礁石已被摧毁”，同时关闭被摧毁礁石的概览入口。新创建的礁石会按最新消息规则排到消息页前方。\n管理后台顶部新增数据刷新按钮，可以重新获取举报、审核等内容而不刷新整个浏览器页面；听取反馈的 UID 搜索和管理页面的内容排序也完成了整理。\n私信与礁石在弱网、重连和媒体上传时更加稳定，迟到的旧数据不会覆盖刚发送或刚收到的消息；上传失败的媒体会安全回到待发送区域。\n评论数量已经按照真实有效评论完成校准，消息未读状态和排序经过完整检查。制冷剂现在严格遵守每份切片每天只能使用一瓶的规则，并进一步加强了媒体归属校验、重复提交保护、权限边界和管理处置事务。',
        '2026-08-14',
      );
    },
  },
  {
    id: '070_expand_update_log_dev_032',
    up(db) {
      db.prepare(`
        UPDATE app_update_logs
        SET title=?, release_notes=?, updated_at=datetime('now','+8 hours')
        WHERE version_name='DEV-032'
      `).run(
        '管理能力补齐，稳定性全面加固',
        '管理后台新增完整的管理人员体系：后台超级管理员、后台审核员和 APP 管理员可以分别分配，创建管理账户和调整已有账户角色也统一集中管理。赋予 APP 管理员时会先通过 UID 搜索并展示头像、昵称、用户名与 UID，核对无误后才能确认。\nAPP 管理员现在可以在 App 内长按切片进入特殊选项，按照与后台一致的理由和时长执行删除切片、禁言或封禁；所有处置都会写入通知与管理日志。\n腾讯云二审和后台消息记录现在可以还原显示文字、图片、视频、实况照片及切片或评论来源，不再把媒体内容显示成一串链接。申诉处理补充了违规图片记录，举报、二审和申诉卡片统一显示明确的处置结果。\n礁石管理补齐了完整的摧毁联动：被确认违规的礁石会通知创建者和所有发言用户，相关切片仍保留礁石卡片并显示“该礁石已被摧毁”，同时关闭被摧毁礁石的概览入口。新创建的礁石会按最新消息规则排到消息页前方。\n管理后台顶部新增数据刷新按钮，可以重新获取举报、审核等内容而不刷新整个浏览器页面；听取反馈的 UID 搜索和管理页面的内容排序也完成了整理。\n私信与礁石在弱网、重连和媒体上传时更加稳定，迟到的旧数据不会覆盖刚发送或刚收到的消息；上传失败的媒体会安全回到待发送区域。\n评论数量已经按照真实有效评论完成校准，消息未读状态和排序经过完整检查。制冷剂现在严格遵守每份切片每天只能使用一瓶的规则，并进一步加强了媒体归属校验、重复提交保护、权限边界和管理处置事务。',
      );
    },
  },
  {
    id: '071_simplify_update_log_dev_032',
    up(db) {
      db.prepare(`
        UPDATE app_update_logs
        SET title=?, release_notes=?, updated_at=datetime('now','+8 hours')
        WHERE version_name='DEV-032'
      `).run(
        '管理能力补齐，稳定性全面加固',
        '管理后台新增管理人员角色分工，并支持在 App 内进行内容处置。\n审核、举报和申诉页面完善了媒体展示与处置结果。\n礁石被摧毁后的通知、卡片状态和消息排序更加准确。\n修复聊天、媒体上传、评论计数和制冷剂规则等稳定性问题。',
      );
    },
  },
  {
    id: '072_fragile_frost_shell_storage_limit',
    up(db) {
      db.prepare(`
        UPDATE users
        SET fragile_frost_shell_count = 4
        WHERE fragile_frost_shell_count > 4
      `).run();
    },
  },
  {
    id: '073_remove_known_default_security_answers',
    up(db) {
      if (!tableExists(db, 'users')) return;
      const userColumns = columns(db, 'users');
      if (!userColumns.has('security_answer') || !userColumns.has('security_question')) return;

      const users = db.prepare(`
        SELECT id, security_answer
        FROM users
        WHERE security_answer IS NOT NULL AND TRIM(security_answer) != ''
      `).all();
      const clearAnswer = db.prepare(`
        UPDATE users
        SET security_question = '', security_answer = ''
        WHERE id = ?
      `);
      for (const user of users) {
        const stored = String(user.security_answer || '');
        let isKnownDefault = stored === '123456';
        if (!isKnownDefault && /^\$2[aby]\$\d{2}\$/.test(stored)) {
          try {
            isKnownDefault = bcrypt.compareSync('123456', stored);
          } catch {
            isKnownDefault = false;
          }
        }
        if (isKnownDefault) clearAnswer.run(user.id);
      }
    },
  },
  {
    id: '074_update_log_dev_033',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'all', ?, '1.0.2', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-033',
        'DEV-033',
        '安全与备份体系进一步完善',
        '加强账户登录、会话、管理后台和重要接口的安全保护。\n完善服务器健康检查、日志管理、自动备份与恢复校验。\n数据库和用户媒体文件增加异地备份与历史版本保护。\n脆弱浮霜贝存储上限调整为 4 枚，并优化贝壳图标与资料编辑体验。',
        '2026-08-16',
      );
    },
  },
  {
    id: '075_preserve_anonymous_post_reports',
    up(db) {
      if (!tableExists(db, 'post_reports')) return;
      const reportColumns = columns(db, 'post_reports');
      const required = [
        'id', 'post_id', 'reporter_id', 'reason', 'detail', 'status', 'handled_by',
        'handle_note', 'handled_at', 'created_at', 'calibration_processed',
        'calibration_delta', 'handle_action',
      ];
      if (required.some(column => !reportColumns.has(column))) return;

      db.exec(`
        CREATE TABLE post_reports_v075 (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL,
          reporter_id TEXT,
          reason TEXT NOT NULL DEFAULT 'other',
          detail TEXT DEFAULT '',
          status TEXT DEFAULT 'pending',
          handled_by TEXT,
          handle_note TEXT DEFAULT '',
          handled_at TEXT,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          calibration_processed INTEGER NOT NULL DEFAULT 0,
          calibration_delta INTEGER NOT NULL DEFAULT 0,
          handle_action TEXT NOT NULL DEFAULT '',
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL
        );

        INSERT INTO post_reports_v075 (
          id, post_id, reporter_id, reason, detail, status, handled_by,
          handle_note, handled_at, created_at, calibration_processed,
          calibration_delta, handle_action
        )
        SELECT
          report.id,
          report.post_id,
          CASE WHEN reporter.id IS NULL THEN NULL ELSE report.reporter_id END,
          report.reason,
          report.detail,
          report.status,
          CASE WHEN handler.id IS NULL THEN NULL ELSE report.handled_by END,
          report.handle_note,
          report.handled_at,
          report.created_at,
          report.calibration_processed,
          report.calibration_delta,
          report.handle_action
        FROM post_reports report
        LEFT JOIN users reporter ON reporter.id = report.reporter_id
        LEFT JOIN users handler ON handler.id = report.handled_by;

        DROP TABLE post_reports;
        ALTER TABLE post_reports_v075 RENAME TO post_reports;
        CREATE INDEX idx_post_reports_status ON post_reports(status);
        CREATE INDEX idx_post_reports_target_time ON post_reports(post_id, created_at, id);
      `);
    },
  },
  {
    id: '076_update_log_dev_034',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'all', ?, '1.0.2', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-034',
        'DEV-034',
        '安全与恢复能力持续加固',
        '服务器改为非 root 密钥运维，并收紧生产代码文件权限。\n新增数据库恢复演练与备份校验，修复历史举报记录的外键异常。\n更新 App 依赖，并加入 GitHub 安全检查与凭据扫描。',
        '2026-08-16',
      );
    },
  },
  {
    id: '077_update_log_dev_035',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'all', ?, '1.0.3', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-035',
        'DEV-035',
        '稳定性与会话体验优化',
        '优化登录状态保存和断线重连。\n修复私信、资料、通知等页面快速切换时的数据错位。\n加强账户切换隔离，并更新 Expo 兼容依赖。',
        '2026-08-23',
      );
    },
  },
  {
    id: '078_web_sessions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS web_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
          expires_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id, expires_at);
      `);
    },
  },
  {
    id: '079_update_log_dev_036',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'all', ?, '1.0.3', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-036',
        'DEV-036',
        '网页社区端开始运行',
        '新增与 App 实时同步的网页社区端。\n支持浏览、发布、评论、私信、礁石、通知和个人主页等主要功能。\n实况照片在网页端以静态封面展示，App 和管理后台保持原有运行方式。',
        '2026-08-23',
      );
    },
  },
  {
    id: '080_update_log_dev_037',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'all', ?, '1.0.3', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-037',
        'DEV-037',
        '网页社区体验继续完善',
        '网页消息、礁石和个人主页体验进一步与 App 对齐。\n支持私信与礁石快捷操作、实时在线人数、Emoji 和表情包。\n完善公海与领海、私人礁石创建和编辑资料功能。',
        '2026-08-23',
      );
    },
  },
  {
    id: '081_update_log_dev_038',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'all', ?, '1.0.3', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-038',
        'DEV-038',
        '网页社区用起来更顺手了',
        '网页端现在能更及时地收到私信提醒，聊天图片、表情包和消息发送也更自然。\n浮霜带支持连续浏览和快速回到顶部，个人主页、通知与礁石信息显示得更完整。\n制备切片时，冰格、话题、领海礁石和字数提示更加清楚，也可以取消冰格并发布游离态切片。',
        '2026-08-25',
      );
    },
  },
  {
    id: '082_rename_anime_board',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      db.prepare(`
        UPDATE boards
        SET name='二次元', updated_at=datetime('now','+8 hours')
        WHERE id='board_anime'
      `).run();
    },
  },
  {
    id: '083_update_log_dev_039',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, '1.0.3', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-039',
        'DEV-039',
        '切片浏览和个人主页更顺手了',
        '单张图片现在会完整显示，浏览切片时更容易看清全部内容。\n点击切片上的头像或昵称，可以直接进入对方主页。\n他人主页的私信和关注按钮移到屏幕底部，操作更方便。\n航行日志和成就提醒换上了新的奖章图标，并统一了“二次元”冰格名称。',
        '2026-08-27',
      );
    },
  },
  {
    id: '084_bind_update_log_dev_039',
    up(db) {
      db.prepare(`
        UPDATE app_update_logs
        SET update_id=?, runtime_version='1.0.3', platform='android',
            updated_at=datetime('now','+8 hours')
        WHERE version_name='DEV-039'
      `).run('01a0425d-aee6-7940-84ab-3d75bc936614');
    },
  },
  {
    id: '085_update_log_dev_040',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'all', ?, '1.0.3', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-040',
        'DEV-040',
        '网页里的肆度，更完整了',
        '新增肆度首页和顶部导航，可以更自然地了解浮霜带、冰格、隐海礁与同频相遇。\n网页社区的个人主页、航行日志、规则说明、头像和性别标识进一步与 App 对齐。\n优化单张图片、话题、评论、霜迹和消息入口，浏览与交流更顺手。',
        '2026-08-27',
      );
    },
  },
  {
    id: '086_update_log_dev_042',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, ?, '1.0.5', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-042',
        'DEV-042',
        '01a043c4-36f2-7376-ba42-17b9cc3dcd9c',
        '图片和动态照片使用同一个入口',
        '制备切片时，普通照片和动态照片现在通过同一个图片按钮选择。\n修复动态照片处理失败的问题，动态内容可以被正常保留。',
        '2026-08-27',
      );
    },
  },
  {
    id: '087_update_log_dev_043',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, ?, '1.0.5', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-043',
        'DEV-043',
        '01a043d9-3873-71b0-bb95-d79eec919288',
        '实况照片显示更自然了',
        '实况照片换上了新的透明圆环标识，不再带黑色背景。\n单张实况照片会按照原始比例完整显示，不再裁切或出现白边。',
        '2026-08-27',
      );
    },
  },
  {
    id: '088_update_log_dev_044',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, ?, '1.0.5', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-044',
        'DEV-044',
        '01a043ef-5771-7f1a-b0f2-6ffa90fa6f2f',
        '实况照片制备和混合图片显示优化',
        '修复制备切片时实况照片缩略图无法显示的问题。\n切片包含两张及以上图片时，普通图片和实况照片现在统一使用九宫格布局。',
        '2026-08-27',
      );
    },
  },
  {
    id: '089_update_log_dev_045',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'android', ?, ?, '1.0.5', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-045',
        'DEV-045',
        '01a04407-92e1-76ec-9122-7c445943ad31',
        '普通图片与实况照片可以连续查看了',
        '切片同时包含普通图片和实况照片时，现在可以在查看器中左右滑动连续浏览。\n普通图片的缩放和实况照片的播放操作保持不变。',
        '2026-08-28',
      );
    },
  },
  {
    id: '090_hide_operations_alerts_from_users',
    up(db) {
      if (!tableExists(db, 'notifications')) return;
      if (!columns(db, 'notifications').has('title')) return;
      db.prepare("DELETE FROM notifications WHERE title IN ('系统运维告警','系统运维恢复')").run();
    },
  },
  {
    id: '091_public_reef_applications',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS public_reef_applications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          reef_name TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed')),
          reviewed_by TEXT,
          reviewed_at TEXT,
          created_at TEXT DEFAULT (datetime('now','+8 hours')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_public_reef_applications_status_time
          ON public_reef_applications(status,created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_public_reef_applications_user_time
          ON public_reef_applications(user_id,created_at DESC);
      `);
    },
  },
  {
    id: '092_security_rate_and_upload_quotas',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS security_rate_buckets (
          scope TEXT NOT NULL,
          subject TEXT NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0,
          reset_at INTEGER NOT NULL,
          updated_at TEXT DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (scope,subject)
        );
        CREATE INDEX IF NOT EXISTS idx_security_rate_buckets_reset
          ON security_rate_buckets(reset_at);

        CREATE TABLE IF NOT EXISTS media_upload_daily_usage (
          user_id TEXT NOT NULL,
          usage_date TEXT NOT NULL,
          file_count INTEGER NOT NULL DEFAULT 0,
          byte_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT DEFAULT (datetime('now','+8 hours')),
          PRIMARY KEY (user_id,usage_date),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_media_upload_daily_usage_date
          ON media_upload_daily_usage(usage_date);

        DELETE FROM recommendation_events
        WHERE created_at < datetime('now','+8 hours','-90 days');
        DELETE FROM recommendation_events
        WHERE user_id IS NOT NULL AND session_id != '' AND id NOT IN (
          SELECT MIN(id) FROM recommendation_events
          WHERE user_id IS NOT NULL AND session_id != ''
          GROUP BY user_id,session_id,post_id,event_type
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_events_session_dedupe
          ON recommendation_events(user_id,session_id,post_id,event_type)
          WHERE user_id IS NOT NULL AND session_id != '';
        CREATE TRIGGER IF NOT EXISTS trg_recommendation_events_retention
        AFTER INSERT ON recommendation_events
        WHEN NEW.id % 1000 = 0
        BEGIN
          DELETE FROM recommendation_events
          WHERE created_at < datetime('now','+8 hours','-90 days');
        END;
      `);
    },
  },
  {
    id: '093_update_log_dev_058',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'development', 'all', ?, NULL, '1.0.8', ?, ?, ?, 1)
        ON CONFLICT(version_name) DO UPDATE SET
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          platform=excluded.platform,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-seed-058',
        'DEV-058',
        '双端质感、网页地址与管理体验全面优化',
        'iOS 26+ 与 Android 的液态玻璃导航、标题、按钮和交互反馈进一步统一，提升清晰度、流畅度与日夜模式表现。\n修复通知间距、聊天返回白屏、切片盒误触、他人主页状态、隐海礁滚动条等多项双端体验问题。\n官网启用更清晰的 /community、/home、/about 地址，旧链接仍可自动兼容。\n管理后台整合公海礁石申请，完善真实公历选择器、每日话题分页和用户头像显示，并完成服务器与部署安全加固。',
        '2026-08-30',
      );
    },
  },
  {
    id: '094_update_log_2026_08_31',
    up(db) {
      const title = '更新体验、浏览稳定性与网页社区全面优化';
      const releaseNotes = [
        'App 新增冷启动更新自检，在线更新下载完成后会在 App 内自动重载，并在返回后展示本次更新说明。',
        '修复 Android 在线更新后偶发退回桌面或页面空白的问题，恢复浮霜带四频道左右滑动，并优化下拉刷新位置、隐海礁布局和悬浮标题显示。',
        '网页社区完善夜间渐变与顶部栏衔接；发布切片成功后会直接进入浮霜带“最新”，新切片可立即在最新列表中看到。',
      ].join('\n');
      db.prepare(`
        UPDATE app_update_logs
        SET is_visible=0,updated_at=datetime('now','+8 hours')
        WHERE release_date='2026-08-31'
          AND version_name!='DEV-066-android'
      `).run();
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'production', 'android', ?, ?, '1.0.11', ?, ?, '2026-08-31', 1)
        ON CONFLICT(version_name) DO UPDATE SET
          stage='production',
          platform='android',
          update_id=excluded.update_id,
          runtime_version=excluded.runtime_version,
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-2026-08-31',
        'DEV-066-android',
        'd7cf8e3f-caac-4bfe-b385-36c107227474',
        title,
        releaseNotes,
      );
    },
  },
  {
    id: '095_sms_verification_and_captcha',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS captcha_challenges (
          id TEXT PRIMARY KEY,
          purpose TEXT NOT NULL CHECK(purpose IN ('register','password_change','password_reset')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verifying','verified','used','rejected')),
          created_at_ms INTEGER NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          verified_at_ms INTEGER,
          used_at_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_captcha_challenges_expiry
          ON captcha_challenges(expires_at_ms);

        CREATE TABLE IF NOT EXISTS sms_verification_codes (
          id TEXT PRIMARY KEY,
          phone_hash TEXT NOT NULL,
          purpose TEXT NOT NULL CHECK(purpose IN ('register','password_change','password_reset')),
          status TEXT NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','active','consumed','superseded')),
          code_hash TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at_ms INTEGER NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          consumed_at_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sms_verification_lookup
          ON sms_verification_codes(phone_hash,purpose,status,created_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_sms_verification_expiry
          ON sms_verification_codes(expires_at_ms);
      `);
    },
  },
  {
    id: '096_life_boards_ootd_sleep_cycling',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      const firstSort = Number(db.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS next_sort FROM boards WHERE category='生活' AND id NOT IN ('board_ootd','board_sleep','board_cycling')").get()?.next_sort) || 0;
      const boards = [
        ['board_ootd', 'OOTD', '', 'shirt-outline', '#F06A9B', '#F7A4C2', '生活', firstSort],
        ['board_sleep', '睡觉', '', 'bed-outline', '#6D8FE8', '#A5BAF4', '生活', firstSort + 1],
        ['board_cycling', '骑行', '', 'bicycle-outline', '#22B98A', '#72D9B5', '生活', firstSort + 2],
      ];
      const insert = db.prepare(`
        INSERT OR IGNORE INTO boards(id,name,description,icon,color,color_dark,category,sort)
        VALUES (?,?,?,?,?,?,?,?)
      `);
      boards.forEach(board => insert.run(...board));
      const update = db.prepare("UPDATE boards SET name=?,icon=?,color=?,color_dark=?,category=?,sort=?,updated_at=datetime('now','+8 hours') WHERE id=?");
      boards.forEach(([id, name, _description, icon, color, colorDark, category, sort]) => update.run(name, icon, color, colorDark, category, sort, id));
    },
  },
  {
    id: '097_redraw_ootd_sleep_board_icons',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      db.prepare("UPDATE boards SET icon='ootd-outline',updated_at=datetime('now','+8 hours') WHERE id='board_ootd'").run();
      db.prepare("UPDATE boards SET icon='zzz-outline',updated_at=datetime('now','+8 hours') WHERE id='board_sleep'").run();
    },
  },
  {
    id: '098_keep_board_icon_keys_backward_compatible',
    up(db) {
      if (!tableExists(db, 'boards')) return;
      db.prepare("UPDATE boards SET icon='shirt-outline',updated_at=datetime('now','+8 hours') WHERE id='board_ootd'").run();
      db.prepare("UPDATE boards SET icon='bed-outline',updated_at=datetime('now','+8 hours') WHERE id='board_sleep'").run();
    },
  },
  {
    id: '099_reef_mentions_and_notification_metadata',
    up(db) {
      if (tableExists(db, 'notifications')) addColumn(db, 'notifications', "metadata_json TEXT NOT NULL DEFAULT '{}'");
      if (tableExists(db, 'reef_messages')) {
        db.exec('CREATE INDEX IF NOT EXISTS idx_reef_messages_room_user ON reef_messages(room_id,user_id,created_at DESC)');
      }
    },
  },
  {
    id: '100_update_log_native_1_1',
    up(db) {
      db.prepare(`
        INSERT INTO app_update_logs
          (id,stage,platform,version_name,update_id,runtime_version,title,release_notes,release_date,is_visible)
        VALUES (?, 'production', 'android', ?, NULL, '1.1', ?, ?, '2026-09-05', 1)
        ON CONFLICT(version_name) DO UPDATE SET
          stage='production',
          platform='android',
          update_id=NULL,
          runtime_version='1.1',
          title=excluded.title,
          release_notes=excluded.release_notes,
          release_date=excluded.release_date,
          is_visible=1,
          updated_at=datetime('now','+8 hours')
      `).run(
        'update-log-native-1-1',
        '1.1',
        '稳定性与社区互动体验优化',
        [
          '稳定性优化，减少闪退几率',
          '优化发送按钮的视觉效果',
          '开放关注和粉丝列表的查看功能',
          '生活板块新增冰格：OOTD，睡觉，骑行',
          '新增复制评论功能',
          '优化切片加载中bug',
          '输入框图片按钮优化',
          '礁石新增@功能',
          '优化网页端系统通知和互动通知的图标效果',
        ].join('\n'),
      );
    },
  },
];

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now','+8 hours'))
    )
  `);
  const applied = db.prepare('SELECT id FROM schema_migrations').all();
  const appliedIds = new Set(applied.map(row => row.id));
  const record = db.prepare("INSERT INTO schema_migrations(id,applied_at) VALUES (?,datetime('now','+8 hours'))");
  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;
    db.transaction(() => {
      migration.up(db);
      record.run(migration.id);
    })();
  }
}

module.exports = { runMigrations };
