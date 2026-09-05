const { nowCst } = require('../../lib/time');
const { isValidPenaltyReason, normalizePenaltyReason } = require('../../lib/penalty-reasons');

module.exports = function registerModerationAdmin(router, {
  adminAuth,
  db,
  logAdmin,
  deletePostByAdmin,
  deleteCommentByAdmin,
  applyAdminMute,
  applyAdminBan,
}) {
  const punitiveActions = new Set(['delete', 'mute', 'ban', 'mute_a', 'ban_a', 'mute_b', 'ban_b']);

  function publicTask(row) {
    return {
      ...row,
      media_snapshot: safeJson(row.media_snapshot, []),
      context_snapshot: safeJson(row.context_snapshot, []),
      provider_result: safeJson(row.provider_result_json, []),
    };
  }

  function taskWithUsers(id) {
    return db.prepare(`SELECT m.*, au.nickname AS author_nickname, au.username AS author_username, au.avatar AS author_avatar,
      ru.nickname AS related_nickname, ru.username AS related_username, ru.avatar AS related_avatar,
      CASE m.target_type WHEN 'post' THEN p.status WHEN 'comment' THEN c.status WHEN 'message' THEN 'active' END AS content_status
      FROM moderation_tasks m
      JOIN users au ON au.id=m.author_id
      LEFT JOIN users ru ON ru.id=m.related_user_id
      LEFT JOIN posts p ON m.target_type='post' AND p.id=m.target_id
      LEFT JOIN comments c ON m.target_type='comment' AND c.id=m.target_id
      WHERE m.id=?`).get(id);
  }

  router.get('/moderation', adminAuth, (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const requestedStatus = ['pending', 'light', 'normal', 'violation'].includes(req.query.admin_status) ? req.query.admin_status : 'pending';
    const type = ['post', 'comment', 'message'].includes(req.query.target_type) ? req.query.target_type : '';
    const search = String(req.query.search || '').trim();
    const where = [];
    const params = [];
    if (requestedStatus === 'light') {
      where.push("m.admin_status='pending'", 'm.light_violation=1', "m.target_type='message'");
    } else {
      where.push('m.admin_status=?');
      params.push(requestedStatus);
      if (requestedStatus === 'pending') where.push('m.light_violation=0');
    }
    if (type) { where.push('m.target_type=?'); params.push(type); }
    if (search) {
      where.push('(m.author_id LIKE ? OR m.related_user_id LIKE ? OR au.nickname LIKE ? OR au.username LIKE ? OR ru.nickname LIKE ? OR ru.username LIKE ?)');
      params.push(...Array(6).fill(`%${search}%`));
    }
    const clause = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS c FROM moderation_tasks m JOIN users au ON au.id=m.author_id LEFT JOIN users ru ON ru.id=m.related_user_id WHERE ${clause}`).get(...params).c;
    const rows = db.prepare(`SELECT m.*,au.nickname AS author_nickname,au.username AS author_username,au.avatar AS author_avatar,
      ru.nickname AS related_nickname,ru.username AS related_username,ru.avatar AS related_avatar,
      CASE m.target_type WHEN 'post' THEN p.status WHEN 'comment' THEN c.status WHEN 'message' THEN 'active' END AS content_status
      FROM moderation_tasks m JOIN users au ON au.id=m.author_id
      LEFT JOIN users ru ON ru.id=m.related_user_id
      LEFT JOIN posts p ON m.target_type='post' AND p.id=m.target_id
      LEFT JOIN comments c ON m.target_type='comment' AND c.id=m.target_id
      WHERE ${clause} ORDER BY m.created_at DESC,m.risk_score DESC,m.id DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    res.json({ tasks: rows.map(publicTask), total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  });

  router.get('/moderation/:id', adminAuth, (req, res) => {
    const task = taskWithUsers(req.params.id);
    if (!task) return res.status(404).json({ error: '审核任务不存在' });
    res.json({ task: publicTask(task) });
  });

  router.put('/moderation/:id', adminAuth, (req, res) => {
    const task = taskWithUsers(req.params.id);
    if (!task) return res.status(404).json({ error: '审核任务不存在' });
    if (task.admin_status !== 'pending') return res.status(409).json({ error: '该审核任务已经处理过了' });
    const action = String(req.body?.action || '').trim();
    const note = normalizePenaltyReason(req.body?.note);
    const now = nowCst();

    if (action === 'light') {
      if (task.target_type !== 'message') return res.status(400).json({ error: '轻度违规仅用于私信二审' });
      db.prepare(`UPDATE moderation_tasks SET light_violation=1,light_note=?,light_marked_by=?,light_marked_at=?,
        handle_action='light',handle_note=?,updated_at=? WHERE id=?`)
        .run(note, req.adminId, now, note, now, task.id);
      logAdmin(req.adminId, 'moderation_light', 'message', task.target_id, note || '标记为轻度违规，暂不处罚并继续观察', req.ip);
      return res.json({ ok: true, action: 'light' });
    }

    if (punitiveActions.has(action) && !isValidPenaltyReason(note)) {
      return res.status(400).json({ error: '请选择标准违规原因；选择“其他”时必须填写补充说明' });
    }
    if (action === 'normal') {
      db.prepare("UPDATE moderation_tasks SET status='passed',admin_status='normal',light_violation=0,handled_by=?,handled_at=?,handle_action=?,handle_note=?,updated_at=? WHERE id=?")
        .run(req.adminId, now, action, note, now, task.id);
      logAdmin(req.adminId, 'moderation_normal', task.target_type, task.target_id, note || '管理员判定正常', req.ip);
      return res.json({ ok: true });
    }

    const isMessage = task.target_type === 'message';
    const allowed = isMessage ? ['mute_a', 'ban_a', 'mute_b', 'ban_b'] : ['delete', 'mute', 'ban'];
    if (!allowed.includes(action)) return res.status(400).json({ error: '当前内容类型不支持该处理方式' });
    let targetId = task.author_id;
    if (isMessage && action.endsWith('_b')) targetId = task.related_user_id;
    if (!targetId) return res.status(400).json({ error: '私信接收方不存在，无法执行该处罚' });
    const target = db.prepare('SELECT id,nickname,role FROM users WHERE id=?').get(targetId);
    if (!target) return res.status(404).json({ error: '处罚目标不存在' });
    if (['admin', 'reviewer', 'superadmin', 'app_admin'].includes(target.role)) return res.status(403).json({ error: '不能通过内容审核处罚管理人员账号' });

    let punishmentResult = { ok: true };
    if (action === 'delete') {
      const deleted = task.target_type === 'post'
        ? deletePostByAdmin(task.target_id, note, req.adminId, req.ip, req)
        : deleteCommentByAdmin(task.target_id, note, req.adminId, req.ip, req);
      if (!deleted) return res.status(404).json({ error: '待删除内容不存在' });
    } else if (action === 'mute' || action.startsWith('mute_')) {
      punishmentResult = applyAdminMute(req, targetId, { hours: req.body?.hours, reason: note });
    } else if (action === 'ban' || action.startsWith('ban_')) {
      punishmentResult = applyAdminBan(req, targetId, { days: req.body?.days, reason: note });
    }
    if (punishmentResult.error) return res.status(400).json({ error: punishmentResult.error });

    db.prepare("UPDATE moderation_tasks SET status='passed',admin_status='violation',light_violation=0,handled_by=?,handled_at=?,handle_action=?,handle_note=?,updated_at=? WHERE id=?")
      .run(req.adminId, now, action, note, now, task.id);
    logAdmin(req.adminId, `moderation_${action}`, task.target_type, task.target_id, `${note}；目标用户 ${targetId}`, req.ip);
    res.json({ ...punishmentResult, targetId, action });
  });
};

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
