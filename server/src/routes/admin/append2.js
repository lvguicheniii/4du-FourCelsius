const { nowCst } = require('../../lib/time');
const { reconcileDailyTopics } = require('../../lib/daily-topics');
const { getPasswordWorkStats } = require('../../lib/password-work');
const { getConcurrencyStats } = require('../../middleware/concurrency-limit');
const { getRateLimitStats } = require('../../middleware/rate-limit');
const { getRuntimeMetrics } = require('../../lib/runtime-metrics');
const { isValidPenaltyReason } = require('../../lib/penalty-reasons');

module.exports = function registerAdminAppend2(router, { adminAuth, requireSuperAdmin, db, uuid, logAdmin, deleteCommentByAdmin }) {
function broadcastCommunityConfig(req, resource, action) {
  req.app.get('ws')?.broadcast({
    type: 'community_config_changed',
    resource,
    action,
    changedAt: nowCst(),
  });
}

function publicReefPayload(body, partial = false) {
  const result = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 18) throw new Error('礁石名称需要 2 至 18 个字符');
    result.name = name;
  }
  if (!partial || body.color !== undefined) {
    const color = String(body.color || '#33A9DC').trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(color)) throw new Error('请选择有效的礁石颜色');
    result.color = color;
  }
  if (!partial || body.capacity !== undefined) {
    const capacity = Math.round(Number(body.capacity === undefined ? 444 : body.capacity));
    if (!Number.isFinite(capacity) || capacity < 2 || capacity > 444) throw new Error('人数限制需要设置为 2 至 444 人');
    result.capacity = capacity;
  }
  if (partial && body.status !== undefined) {
    const status = String(body.status);
    if (!['active', 'destroyed'].includes(status)) throw new Error('无效的礁石状态');
    result.status = status;
  }
  return result;
}

// ====== 公海礁石管理 ======
router.get('/public-reefs', adminAuth, (req, res) => {
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim();
  const where = ["r.zone='public'"];
  const params = [];
  if (status !== 'all') {
    if (!['active', 'destroyed'].includes(status)) return res.status(400).json({ error: '无效的状态筛选' });
    where.push('r.status=?');
    params.push(status);
  }
  if (search) {
    where.push('(r.name LIKE ? OR CAST(r.official_number AS TEXT) LIKE ?)');
    params.push(`%${search}%`, `%${search.replace(/^#/, '')}%`);
  }
  const ws = req.app.get('ws');
  const rooms = db.prepare(`
    SELECT r.*,
           COUNT(DISTINCT m.id) AS message_count,
           COUNT(DISTINCT m.user_id) AS speaker_count,
           MAX(m.created_at) AS last_message_at
    FROM reef_rooms r
    LEFT JOIN reef_messages m ON m.room_id=r.id
    WHERE ${where.join(' AND ')}
    GROUP BY r.id
    ORDER BY CASE r.status WHEN 'active' THEN 0 ELSE 1 END,
             r.official_number IS NULL, r.official_number, r.created_at DESC
  `).all(...params).map(room => ({
    ...room,
    current_count: ws?.getRoomPresence?.(room.id)?.length || 0,
  }));
  res.json({ rooms });
});

router.get('/public-reef-applications', adminAuth, (req, res) => {
  const status = String(req.query.status || 'pending');
  if (!['pending', 'reviewed', 'all'].includes(status)) return res.status(400).json({ error: '无效的申请状态' });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 20;
  const where = status === 'all' ? '' : 'WHERE a.status=?';
  const params = status === 'all' ? [] : [status];
  const total = db.prepare(`SELECT COUNT(*) AS count FROM public_reef_applications a ${where}`).get(...params).count;
  const rows = db.prepare(`
    SELECT a.id,a.user_id,a.reef_name,a.reason,a.status,a.reviewed_at,a.created_at,
           u.nickname,u.username,u.avatar,u.gender,u.created_at AS user_created_at,
           reviewer.nickname AS reviewer_nickname,reviewer.username AS reviewer_username
    FROM public_reef_applications a
    JOIN users u ON u.id=a.user_id
    LEFT JOIN users reviewer ON reviewer.id=a.reviewed_by
    ${where}
    ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, (page - 1) * limit);
  res.json({
    applications: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

router.put('/public-reef-applications/:id/review', adminAuth, (req, res) => {
  const application = db.prepare('SELECT * FROM public_reef_applications WHERE id=?').get(req.params.id);
  if (!application) return res.status(404).json({ error: '申请不存在' });
  if (application.status === 'reviewed') return res.json({ ok: true, alreadyReviewed: true });
  const reviewedAt = nowCst();
  const reviewed = db.transaction(() => {
    const update = db.prepare(`
      UPDATE public_reef_applications
      SET status='reviewed',reviewed_by=?,reviewed_at=?
      WHERE id=? AND status='pending'
    `).run(req.adminId, reviewedAt, application.id);
    if (!update.changes) return false;
    db.prepare(`
      INSERT INTO notifications(id,user_id,category,type,title,content,related_id,created_at)
      VALUES (?,?,'system','public_reef_application_reviewed','公海礁石申请已查看',?,?,?)
    `).run(
      uuid(),
      application.user_id,
      `您提交的【${application.reef_name}】公海礁石申请，已被肆度官方管理团队查看。`,
      application.id,
      reviewedAt,
    );
    return true;
  })();
  if (!reviewed) return res.json({ ok: true, alreadyReviewed: true });
  logAdmin(req.adminId, 'review_public_reef_application', 'public_reef_application', application.id, `查看新增公海礁石申请：${application.reef_name}`, req.ip);
  res.json({ ok: true });
});

router.post('/public-reefs', adminAuth, (req, res) => {
  let values;
  try { values = publicReefPayload(req.body || {}); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const nextNumber = db.prepare("SELECT COALESCE(MAX(official_number),0)+1 AS value FROM reef_rooms WHERE zone='public'").get().value;
  const id = `reef_official_${uuid()}`;
  db.prepare(`
    INSERT INTO reef_rooms(id,zone,official_number,name,color,capacity,duration_hours,expires_at,owner_id,status,created_at)
    VALUES (?,'public',?,?,?,?,0,NULL,NULL,'active',?)
  `).run(id, nextNumber, values.name, values.color, values.capacity, nowCst());
  logAdmin(req.adminId, 'create_public_reef', 'reef', id, `创建公海礁石 #${nextNumber} ${values.name}，人数上限 ${values.capacity}`, req.ip);
  req.app.get('ws')?.broadcast({ type: 'reef_room_updated', roomId: id, action: 'created' });
  res.status(201).json({ ok: true, id, number: nextNumber });
});

router.put('/public-reefs/:id', adminAuth, (req, res) => {
  const room = db.prepare("SELECT * FROM reef_rooms WHERE id=? AND zone='public'").get(req.params.id);
  if (!room) return res.status(404).json({ error: '公海礁石不存在' });
  let values;
  try { values = publicReefPayload(req.body || {}, true); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (!Object.keys(values).length) return res.status(400).json({ error: '没有可更新的设置' });
  const next = { ...room, ...values };
  db.prepare(`
    UPDATE reef_rooms
    SET name=?,color=?,capacity=?,status=?,destroyed_at=?
    WHERE id=? AND zone='public'
  `).run(
    next.name,
    next.color,
    next.capacity,
    next.status,
    next.status === 'destroyed' ? (room.destroyed_at || nowCst()) : null,
    room.id,
  );
  logAdmin(req.adminId, 'update_public_reef', 'reef', room.id, `更新公海礁石 #${room.official_number} ${next.name}`, req.ip);
  req.app.get('ws')?.broadcast({ type: 'reef_room_updated', roomId: room.id, action: next.status === 'active' ? 'updated' : 'destroyed' });
  res.json({ ok: true });
});

router.delete('/public-reefs/:id', adminAuth, (req, res) => {
  const room = db.prepare("SELECT * FROM reef_rooms WHERE id=? AND zone='public'").get(req.params.id);
  if (!room) return res.status(404).json({ error: '公海礁石不存在' });
  if (room.status !== 'destroyed') {
    db.prepare("UPDATE reef_rooms SET status='destroyed',destroyed_at=? WHERE id=?").run(nowCst(), room.id);
    logAdmin(req.adminId, 'delete_public_reef', 'reef', room.id, `下架公海礁石 #${room.official_number} ${room.name}，历史消息保留`, req.ip);
    req.app.get('ws')?.broadcast({ type: 'reef_room_updated', roomId: room.id, action: 'destroyed' });
  }
  res.json({ ok: true, preserved: true });
});

// ====== 功能灰度与每日话题 ======
router.get('/operations', adminAuth, (req, res) => {
  reconcileDailyTopics(db);
  res.json({
    flags: db.prepare('SELECT * FROM feature_flags ORDER BY key').all(),
    themes: db.prepare('SELECT * FROM daily_themes ORDER BY theme_date DESC LIMIT 60').all(),
  });
});

router.get('/daily-themes', adminAuth, (req, res) => {
  reconcileDailyTopics(db);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 10;
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM daily_themes').get()?.count || 0);
  const themes = db.prepare('SELECT * FROM daily_themes ORDER BY theme_date DESC LIMIT ? OFFSET ?')
    .all(limit, (page - 1) * limit);
  res.json({ themes, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

router.put('/feature-flags/:key', adminAuth, requireSuperAdmin, (req, res) => {
  const enabled = req.body.enabled === true || req.body.enabled === 1 ? 1 : 0;
  const rollout = Math.max(0, Math.min(100, parseInt(req.body.rolloutPercent, 10) || 0));
  const result = db.prepare(`
    UPDATE feature_flags SET enabled=?,rollout_percent=?,updated_by=?,updated_at=datetime('now','+8 hours')
    WHERE key=?
  `).run(enabled, rollout, req.adminId, req.params.key);
  if (!result.changes) return res.status(404).json({ error: '功能开关不存在' });
  broadcastCommunityConfig(req, 'feature_flags', 'updated');
  res.json({ ok:true });
});

router.post('/daily-themes', adminAuth, (req, res) => {
  const title = String(req.body.title || '').trim().replace(/^#/, '');
  const themeDate = String(req.body.themeDate || '').trim();
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(themeDate)) {
    return res.status(400).json({ error: '请完整填写每日话题和日期' });
  }
  const id = `theme_${require('uuid').v4()}`;
  db.prepare(`
    INSERT INTO daily_themes(id,title,prompt,theme_date,status,created_by)
    VALUES (?,?, '', ?, CASE
      WHEN ? = date('now','+8 hours') THEN 'active'
      WHEN ? > date('now','+8 hours') THEN 'pending'
      ELSE 'expired'
    END, ?)
    ON CONFLICT(theme_date) DO UPDATE SET
      title=excluded.title,prompt='',status=excluded.status,created_by=excluded.created_by
  `).run(id, title.slice(0, 40), themeDate, themeDate, themeDate, req.adminId);
  broadcastCommunityConfig(req, 'daily_theme', 'updated');
  res.json({ ok:true });
});

router.put('/daily-themes/:id', adminAuth, (req, res) => {
  const title = String(req.body.title || '').trim().replace(/^#/, '');
  if (!title) return res.status(400).json({ error: '每日话题内容不能为空' });
  if (title.length > 40) return res.status(400).json({ error: '每日话题最多40个字' });
  const theme = db.prepare('SELECT id,title,theme_date FROM daily_themes WHERE id=?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: '每日话题不存在' });
  db.prepare('UPDATE daily_themes SET title=?,created_by=? WHERE id=?')
    .run(title, req.adminId, theme.id);
  logAdmin(req.adminId, 'update_daily_theme', 'daily_theme', theme.id, `${theme.theme_date}：#${theme.title} → #${title}`, req.ip);
  broadcastCommunityConfig(req, 'daily_theme', 'updated');
  res.json({ ok:true });
});

router.delete('/daily-themes/:id', adminAuth, (req, res) => {
  db.prepare("UPDATE daily_themes SET status='disabled' WHERE id=?").run(req.params.id);
  broadcastCommunityConfig(req, 'daily_theme', 'disabled');
  res.json({ ok:true });
});
// ====== 数据库浏览器 ======
router.get('/db/tables', adminAuth, requireSuperAdmin, (req, res) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  res.json(tables.map(t => {
    const cnt = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get().c;
    return { name: t.name, rows: cnt };
  }));
});

router.get('/db/table/:name', adminAuth, requireSuperAdmin, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_]/g, '');
  const blockedTables = new Set(['sessions', 'web_sessions', 'device_push_tokens', 'login_throttles', 'security_rate_buckets', 'idempotency_requests', 'captcha_challenges', 'sms_verification_codes']);
  if (blockedTables.has(name)) return res.status(403).json({ error: '该安全表禁止通过数据库浏览器读取' });
  try {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
    const page = parseInt(req.query.page)||1, limit=50, offset=(page-1)*limit;
    const total = db.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get().c;
    const sensitiveColumn = /^(?:password_hash|security_answer|token|token_hash|secret|secret_id|secret_key|register_ip|last_login_ip|ip_address)$/i;
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid DESC LIMIT ${limit} OFFSET ${offset}`).all()
      .map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sensitiveColumn.test(key) && value ? '[已隐藏]' : value])));
    res.json({ columns: cols.map(c=>c.name), rows, total, page, totalPages: Math.ceil(total/limit) });
  } catch(e) { res.json({ error: e.message }); }
});

// ====== 敏感词管理 ======
router.get('/filter-words', adminAuth, (req, res) => {
  const words = db.prepare('SELECT * FROM filter_words ORDER BY created_at DESC').all();
  res.json(words);
});

router.post('/filter-words', adminAuth, (req, res) => {
  const word = String(req.body.word || '').trim();
  const replacement = String(req.body.replacement || '');
  if (!word || !replacement) return res.status(400).json({error:'敏感词和替代词不能为空'});
  const id = require('uuid').v4();
  db.prepare('INSERT INTO filter_words (id,word,replacement,level,created_by) VALUES (?,?,?,?,?)')
    .run(id,word,replacement,'replace',req.adminId);
  res.json({ok:true,id});
});

router.put('/filter-words/:id', adminAuth, (req, res) => {
  const word = String(req.body.word || '').trim();
  const replacement = String(req.body.replacement || '');
  if (!word || !replacement) return res.status(400).json({error:'敏感词和替代词不能为空'});
  db.prepare("UPDATE filter_words SET word=?, replacement=?, level='replace' WHERE id=?")
    .run(word,replacement,req.params.id);
  res.json({ok:true});
});

router.delete('/filter-words/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM filter_words WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

// ====== 评论审核 ======
router.get('/comments', adminAuth, (req, res) => {
  const page=parseInt(req.query.page)||1, limit=30, offset=(page-1)*limit;
  const total = db.prepare('SELECT COUNT(*) as c FROM comments').get().c;
  const comments = db.prepare(`SELECT c.*, u.nickname as uname, p.content as pcontent FROM comments c LEFT JOIN users u ON c.user_id=u.id LEFT JOIN posts p ON c.post_id=p.id ORDER BY c.created_at DESC LIMIT ${limit} OFFSET ${offset}`).all();
  res.json({comments,total,page,totalPages:Math.ceil(total/limit)});
});

router.put('/comments/:id/status', adminAuth, (req, res) => {
  const status = req.body.status || 'deleted';
  if (status === 'deleted') {
    const reason = String(req.body.reason || '').trim();
    if (!isValidPenaltyReason(reason)) return res.status(400).json({ error: '请选择标准违规原因；选择“其他”时必须填写补充说明' });
    if (!deleteCommentByAdmin(req.params.id, reason, req.adminId, req.ip, req)) return res.status(404).json({ error: '评论不存在' });
    return res.json({ ok: true });
  }
  db.prepare('UPDATE comments SET status=? WHERE id=?').run(status,req.params.id);
  res.json({ok:true});
});

// ====== 标签管理 ======
router.get('/tags', adminAuth, (req, res) => {
  const cats = db.prepare('SELECT * FROM tag_categories ORDER BY sort ASC').all();
  const tags = db.prepare('SELECT t.*, tc.name as cat_name FROM tags t LEFT JOIN tag_categories tc ON t.category_id=tc.id ORDER BY tc.sort, t.name').all();
  res.json({ categories: cats, tags });
});

router.post('/tags', adminAuth, (req, res) => {
  const { name, categoryId } = req.body;
  if (!name) return res.status(400).json({error:'请输入标签名'});
  db.prepare('INSERT INTO tags (id,name,category_id) VALUES (?,?,?)').run(require('uuid').v4(),name,categoryId||null);
  res.json({ok:true});
});

router.delete('/tags/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM tags WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

// ====== 冰格和话题 ======
router.get('/community-config', adminAuth, (req, res) => {
  res.json({
    boards: db.prepare(`SELECT * FROM boards ORDER BY CASE category WHEN '情绪' THEN 1 WHEN '共鸣' THEN 2 WHEN '兴趣' THEN 3 WHEN '生活' THEN 4 WHEN '404' THEN 5 ELSE 6 END,sort,name`).all(),
    topics: db.prepare('SELECT * FROM topics ORDER BY sort,name').all(),
  });
});

router.post('/boards', adminAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  const icon = String(req.body.icon || 'snow');
  const color = String(req.body.color || '#33A9DC');
  const category = ['情绪','共鸣','兴趣','生活','404'].includes(req.body.category) ? req.body.category : '生活';
  if (!name) return res.status(400).json({error:'请输入冰格名称'});
  const id = 'b_' + require('uuid').v4();
  const colorDark = String(req.body.colorDark || lightenColor(color, 35));
  db.prepare('INSERT INTO boards(id,name,description,icon,color,color_dark,category,sort) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,name,'',icon,color,colorDark,category,Number(req.body.sort)||100);
  broadcastCommunityConfig(req, 'boards', 'created');
  res.json({ok:true,id});
});

router.put('/boards/reorder', adminAuth, (req, res) => {
  const placements = Array.isArray(req.body.placements) ? req.body.placements : [];
  const categories = new Set(['情绪','共鸣','兴趣','生活','404']);
  const existing = new Set(db.prepare("SELECT id FROM boards WHERE id NOT IN ('free','announce')").all().map(row => row.id));
  const seen = new Set();
  for (const item of placements) {
    if (!item || !existing.has(String(item.id)) || seen.has(String(item.id)) || !categories.has(String(item.category))) {
      return res.status(400).json({ error: '冰格排序数据无效' });
    }
    seen.add(String(item.id));
  }
  if (seen.size !== existing.size) return res.status(400).json({ error: '冰格排序数据不完整，请刷新后重试' });
  const update = db.prepare("UPDATE boards SET category=?,sort=?,updated_at=datetime('now','+8 hours') WHERE id=?");
  db.transaction(() => placements.forEach(item => update.run(String(item.category), Number(item.sort) || 0, String(item.id))))();
  broadcastCommunityConfig(req, 'boards', 'reordered');
  res.json({ ok: true });
});

router.put('/boards/:id', adminAuth, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id=?').get(req.params.id);
  if (!board) return res.status(404).json({error:'冰格不存在'});
  const color = String(req.body.color || board.color);
  const category = ['情绪','共鸣','兴趣','生活','404','系统'].includes(req.body.category) ? req.body.category : board.category;
  const active = req.body.active === undefined ? Number(board.is_active) : (req.body.active ? 1 : 0);
  db.prepare("UPDATE boards SET name=?,color=?,color_dark=?,category=?,is_active=?,updated_at=datetime('now','+8 hours') WHERE id=?")
    .run(String(req.body.name||board.name).trim(),color,String(req.body.colorDark||lightenColor(color,35)),category,active,req.params.id);
  broadcastCommunityConfig(req, 'boards', 'updated');
  res.json({ok:true});
});

router.delete('/boards/:id', adminAuth, (req, res) => {
  if (['free','announce'].includes(req.params.id)) return res.status(400).json({error:'系统冰格不能删除'});
  db.prepare('DELETE FROM boards WHERE id=?').run(req.params.id);
  broadcastCommunityConfig(req, 'boards', 'deleted');
  res.json({ok:true});
});

router.post('/topics', adminAuth, (req, res) => {
  let name=String(req.body.name||'').trim(); if(name&&!name.startsWith('#'))name='#'+name;
  if(!name)return res.status(400).json({error:'请输入话题'});
  const id='topic_'+require('uuid').v4();
  db.prepare('INSERT INTO topics(id,name,sort) VALUES(?,?,?)').run(id,name,Number(req.body.sort)||100);
  broadcastCommunityConfig(req, 'topics', 'created');
  res.json({ok:true,id});
});
router.put('/topics/:id', adminAuth, (req,res)=>{
  let name=String(req.body.name||'').trim();if(name&&!name.startsWith('#'))name='#'+name;
  if(!name)return res.status(400).json({error:'请输入话题'});
  db.prepare("UPDATE topics SET name=?,sort=?,updated_at=datetime('now','+8 hours') WHERE id=?").run(name,Number(req.body.sort)||100,req.params.id);
  broadcastCommunityConfig(req, 'topics', 'updated');
  res.json({ok:true});
});
router.delete('/topics/:id', adminAuth, (req,res)=>{
  db.prepare('DELETE FROM topics WHERE id=?').run(req.params.id);
  broadcastCommunityConfig(req, 'topics', 'deleted');
  res.json({ok:true});
});

// ====== 系统健康 ======
function cpuTimes() {
  return require('os').cpus().reduce((total, cpu) => {
    Object.values(cpu.times).forEach((value) => { total.total += value; });
    total.idle += cpu.times.idle;
    return total;
  }, { idle: 0, total: 0 });
}

function sampleCpuUsage(delay = 120) {
  const start = cpuTimes();
  return new Promise((resolve) => setTimeout(() => {
    const end = cpuTimes();
    const total = end.total - start.total;
    const idle = end.idle - start.idle;
    resolve(total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 1000) / 10)) : 0);
  }, delay));
}

router.get('/health', adminAuth, async (req, res) => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const startedAt = process.hrtime.bigint();
  const processMemory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const cpuUsage = await sampleCpuUsage();
  const dbPath = path.join(__dirname, '../../data/sidu.db');
  const dbStat = fs.statSync(dbPath);
  const walPath = `${dbPath}-wal`;
  const walStat = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
  const dbModifiedAt = new Date(Math.max(dbStat.mtimeMs, walStat?.mtimeMs || 0));
  const quickCheck = db.pragma('quick_check', { simple: true });
  let disk = null;
  try {
    const stat = fs.statfsSync(path.parse(dbPath).root);
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    disk = {
      totalBytes: total,
      usedBytes: total - free,
      freeBytes: free,
      usedPercent: total ? Math.round(((total - free) / total) * 1000) / 10 : 0,
    };
  } catch {}
  let backup = null;
  let operations = null;
  try {
    const backupDir = path.resolve(__dirname, '../../../backups');
    const files = fs.readdirSync(backupDir)
      .filter((name) => /^sidu-.*\.db$/.test(name))
      .map((name) => ({ name, stat: fs.statSync(path.join(backupDir, name)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    if (files[0]) backup = { name: files[0].name, time: files[0].stat.mtime.toISOString(), sizeBytes: files[0].stat.size };
    const operationsPath = path.join(backupDir, 'ops-health-state.json');
    if (fs.existsSync(operationsPath)) operations = JSON.parse(fs.readFileSync(operationsPath, 'utf8'));
  } catch {}
  res.json({
    status: quickCheck === 'ok' ? 'healthy' : 'degraded',
    serverTime: require('../../lib/time').nowCst(),
    timezone: 'Asia/Shanghai',
    responseMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6 * 10) / 10,
    uptime: Math.floor(process.uptime()),
    hostUptime: Math.floor(os.uptime()),
    cpu: { usage: cpuUsage, cores: os.cpus().length, model: os.cpus()[0]?.model || '-' },
    load: os.loadavg().map((value) => Number(value.toFixed(2))),
    memory: {
      usedBytes: usedMemory,
      totalBytes: totalMemory,
      usedPercent: totalMemory ? Math.round(usedMemory / totalMemory * 1000) / 10 : 0,
      processRssBytes: processMemory.rss,
      heapUsedBytes: processMemory.heapUsed,
    },
    disk,
    database: {
      status: quickCheck,
      sizeBytes: dbStat.size,
      walBytes: walStat?.size || 0,
      storageBytes: dbStat.size + (walStat?.size || 0),
      modifiedAt: dbModifiedAt.toISOString(),
    },
    backup,
    online: req.app.get('ws')?.getOnlineCount?.() || 0,
    pressure: {
      password: getPasswordWorkStats(),
      concurrency: getConcurrencyStats(),
      rateLimits: getRateLimitStats(),
      websocket: req.app.get('ws')?.getPressureStats?.() || null,
      uploads: req.app.get('uploadPressure')?.() || null,
    },
    runtime: getRuntimeMetrics(),
    operations,
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    hostname: os.hostname(),
    node: process.version,
    environment: process.env.NODE_ENV || 'development',
    processId: process.pid,
    pm2Name: process.env.name || process.env.pm_id || '-',
  });
});

// ====== 管理员管理 ======
router.get('/admins', adminAuth, requireSuperAdmin, (req, res) => {
  const admins = db.prepare("SELECT id,username,nickname,role,status,created_at FROM users WHERE role IN ('admin','reviewer','superadmin','app_admin') ORDER BY created_at DESC").all();
  res.json(admins);
});

router.post('/admins', adminAuth, requireSuperAdmin, (req, res) => {
  const adminUser = db.prepare('SELECT role FROM users WHERE id=?').get(req.adminId);
  if (adminUser?.role !== 'superadmin') return res.status(403).json({error:'仅超级管理员可操作'});
  const { username, password, nickname } = req.body;
  const role = req.body.role === 'superadmin' ? 'superadmin' : 'reviewer';
  if (!username||!password) return res.status(400).json({error:'用户名和密码不能为空'});
  if (password.length < 12) return res.status(400).json({error:'管理员密码至少12位'});
  const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (existing) return res.status(409).json({error:'用户名已存在'});
  const id = require('uuid').v4();
  const hash = require('bcryptjs').hashSync(password,10);
  db.prepare('INSERT INTO users (id,username,password_hash,nickname,role,status) VALUES (?,?,?,?,?,?)').run(id,username,hash,nickname||username,role,'active');
  res.json({ok:true,id});
});

router.put('/admins/:id/role', adminAuth, requireSuperAdmin, (req, res) => {
  const role = String(req.body.role || '');
  if (!['superadmin','reviewer','app_admin','user'].includes(role)) return res.status(400).json({error:'无效的管理角色'});
  const target = db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({error:'用户不存在'});
  if (target.id === req.adminId && role !== 'superadmin') return res.status(400).json({error:'不能降低当前登录超级管理员自己的权限'});
  if (target.role === 'superadmin' && role !== 'superadmin') {
    const count = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='superadmin'").get().c;
    if (count <= 1) return res.status(400).json({error:'必须至少保留一名后台超级管理员'});
  }
  db.prepare('UPDATE users SET role=?,token_version=token_version+1 WHERE id=?').run(role, target.id);
  res.json({ok:true});
});

router.delete('/admins/:id', adminAuth, requireSuperAdmin, (req, res) => {
  const adminUser = db.prepare('SELECT role FROM users WHERE id=?').get(req.adminId);
  if (adminUser?.role !== 'superadmin') return res.status(403).json({error:'仅超级管理员可操作'});
  const target = db.prepare('SELECT role FROM users WHERE id=?').get(req.params.id);
  if (target?.role === 'superadmin') return res.status(403).json({error:'不能删除超级管理员'});
  db.prepare("UPDATE users SET role='user' WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

// ====== 建表（敏感词、标签） ======
db.exec(`
  CREATE TABLE IF NOT EXISTS filter_words (
    id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE, level TEXT DEFAULT 'block',
    created_by TEXT, created_at TEXT DEFAULT (datetime('now','+8 hours'))
  );
  CREATE TABLE IF NOT EXISTS tag_categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','+8 hours'))
  );
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category_id TEXT,
    created_at TEXT DEFAULT (datetime('now','+8 hours'))
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
function lightenColor(hex, amount) {
  const raw=hex.replace('#',''); if(!/^[0-9a-f]{6}$/i.test(raw))return '#7FD8F5';
  const n=parseInt(raw,16),mix=c=>Math.round(c+(255-c)*amount/100);
  return '#'+[mix(n>>16),mix((n>>8)&255),mix(n&255)].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
}
const boardSeeds = [
  ['b1','NOW','cafe-outline','#7C6CF2','#AAA0FF'],['b2','科技','hardware-chip-outline','#20BFA9','#67DDCD'],
  ['b3','美食','restaurant-outline','#FF8A5C','#FFB08F'],['b4','游戏','game-controller-outline','#F062A6','#F79BC7'],
  ['b5','旅行','airplane-outline','#3D9BFF','#78BAFF'],['b6','阅读','book-outline','#27C6BE','#70DED9'],
  ['b15','电影','film-outline','#7586E8','#A3AFF4'],['b7','宠物','paw-outline','#FF9F43','#FFC273'],
  ['b8','健身','barbell-outline','#32C878','#76E1A5'],['b9','职场','briefcase-outline','#4B9FEF','#83BDF4'],
  ['b10','校园','school-outline','#5C7CFA','#92A7FF'],['b11','音乐','musical-notes-outline','#EC65B7','#F29BCF'],
  ['b12','摄影','camera-outline','#9B6DF2','#BDA0F7'],['b13','树洞','heart-half-outline','#36B6E8','#79D2F2'],
  ['b14','家居','home-outline','#F4B942','#F8D27E'],['free','游离态','square-outline','#90B0C8','#B0C8D8'],
  ['announce','公告','megaphone','#F7B731','#FED330'],
  ['board_love','恋爱','heart-outline','#FF6B9A','#FF9ABA'],['board_wallpaper','壁纸','images-outline','#6485FF','#96AAFF'],
  ['board_rant','吐槽','chatbox-ellipses-outline','#FF7A59','#FFA38D'],['board_tv','追剧','tv-outline','#9A6DF0','#BE9CF5'],
  ['board_secret','秘密','lock-closed-outline','#5D8DEF','#8FB1F5'],['board_idol','爱豆','star-outline','#F5B82E','#F9D36F'],
  ['board_lonely','孤独','moon-outline','#6F8FEA','#9EB3F2'],['board_anime','二次元','sparkles-outline','#25BFD3','#70D8E5'],
  ['board_worries','烦恼','rainy-outline','#7890F0','#A5B5F5'],
  ['board_tipsy','微醺','wine-outline','#D9689A','#E99ABD'],['board_painting','绘画','color-palette-outline','#32BE83','#78D8AB'],
  ['board_crush','暗恋','rose-outline','#EF5D91','#F493B5'],['board_feedback','肆度反馈','megaphone-outline','#2DB9C8','#75D4DD'],
  ['board_ex','Ex','heart-dislike-outline','#7188DE','#A0B0EA'],['board_abstract','抽象','shapes-outline','#8C68F5','#B29BF8'],
  ['board_lovewins','LoveWins','heart-circle-outline','#FF5F7E','#FF93A8'],['board_joy','喜','happy-outline','#FF9D3D','#FFC077'],
  ['board_silly','沙雕','fish-outline','#2BB8C9','#73D2DC'],['board_angry','怒','emoticon-angry-outline','#FF625F','#FF9794'],
  ['board_flirt','可撩','chatbubbles-outline','#F36EA5','#F79DC2'],['board_sorrow','哀','sad-outline','#7287E8','#A0AFF1'],
  ['board_selfie','自拍','camera-reverse-outline','#B46DE8','#CE9DF0'],['board_fun','乐','emoticon-lol-outline','#F2BC32','#F7D574'],
  ['board_help','求助','help-buoy-outline','#438FEF','#7DB5F5'],['board_down','丧','cloud-outline','#7596D8','#A2B8E5'],
  ['board_memes','表情包','happy-outline','#65BE4D','#98D588'],['board_numb','麻了','pulse-outline','#A875E0','#C59DEA'],
  ['board_slacking','摸鱼','fish-outline','#2EB89F','#74D2C1'],
  ['board_ootd','OOTD','shirt-outline','#F06A9B','#F7A4C2'],
  ['board_sleep','睡觉','bed-outline','#6D8FE8','#A5BAF4'],
  ['board_cycling','骑行','bicycle-outline','#22B98A','#72D9B5']
];
const boardSeedCategories = {
  b1:'情绪',board_joy:'情绪',board_angry:'情绪',board_sorrow:'情绪',board_fun:'情绪',board_rant:'情绪',board_secret:'情绪',board_lonely:'情绪',board_worries:'情绪',board_tipsy:'情绪',board_crush:'情绪',board_down:'情绪',
  board_selfie:'共鸣',board_love:'共鸣',board_idol:'共鸣',board_flirt:'共鸣',board_help:'共鸣',b13:'共鸣',
  board_wallpaper:'兴趣',board_tv:'兴趣',board_anime:'兴趣',b12:'兴趣',b11:'兴趣',board_painting:'兴趣',board_abstract:'兴趣',board_silly:'兴趣',board_memes:'兴趣',b4:'兴趣',b15:'兴趣',b6:'兴趣',
  b2:'生活',b3:'生活',b5:'生活',b7:'生活',b8:'生活',b9:'生活',b10:'生活',b14:'生活',board_slacking:'生活',board_ootd:'生活',board_sleep:'生活',board_cycling:'生活',
  board_numb:'404',board_ex:'404',board_lovewins:'404',board_feedback:'404',free:'系统',announce:'系统'
};
const insertBoard=db.prepare('INSERT OR IGNORE INTO boards(id,name,icon,color,color_dark,category,sort) VALUES(?,?,?,?,?,?,?)');
boardSeeds.forEach((b,i)=>insertBoard.run(...b,boardSeedCategories[b[0]]||'生活',i));
const topicSeeds=['#社交断电','#允许自己融化','#无意义漂浮','#低能量预警','#一次静音的崩溃','#情绪回收站','#潜流打捞局','#4°C避难所','#寻找同频','#今日水压偏高','#人类观察日志','#光合作用记录','#深夜白噪音','#毫无用处的冷知识','#路灯下的影子','#强制下线','#精神离职','#做一棵树'];
const insertTopic=db.prepare('INSERT OR IGNORE INTO topics(id,name,sort) VALUES(?,?,?)');
topicSeeds.forEach((name,i)=>insertTopic.run('topic_seed_'+i,name,i));
};
