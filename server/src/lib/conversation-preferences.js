function preferenceMap(db, userId, kind) {
  const rows = db.prepare(`
    SELECT target_id,hidden,important,important_at,last_read_at,last_read_message_id,updated_at
    FROM conversation_preferences WHERE user_id=? AND kind=?
  `).all(userId, kind);
  return new Map(rows.map(row => [row.target_id, {
    hidden: !!row.hidden,
    important: !!row.important,
    importantAt: row.important_at || null,
    lastReadAt: row.last_read_at || null,
    lastReadMessageId: row.last_read_message_id || null,
    preferenceUpdatedAt: row.updated_at || null,
  }]));
}

function updatePreference(db, userId, kind, targetId, values = {}) {
  const current = db.prepare(`
    SELECT hidden,important,important_at,last_read_at,last_read_message_id FROM conversation_preferences
    WHERE user_id=? AND kind=? AND target_id=?
  `).get(userId, kind, targetId) || {};
  const hidden = values.hidden === undefined ? !!current.hidden : !!values.hidden;
  const important = values.important === undefined ? !!current.important : !!values.important;
  const now = db.prepare("SELECT datetime('now','+8 hours') AS value").get().value;
  const importantAt = important
    ? (values.important === true ? now : current.important_at || now)
    : null;
  const lastReadAt = values.lastReadAt === undefined
    ? current.last_read_at || null
    : values.lastReadAt || null;
  const lastReadMessageId = values.lastReadMessageId === undefined
    ? current.last_read_message_id || null
    : values.lastReadMessageId || null;
  db.prepare(`
    INSERT INTO conversation_preferences(user_id,kind,target_id,hidden,important,important_at,last_read_at,last_read_message_id,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,kind,target_id) DO UPDATE SET
      hidden=excluded.hidden,
      important=excluded.important,
      important_at=excluded.important_at,
      last_read_at=excluded.last_read_at,
      last_read_message_id=excluded.last_read_message_id,
      updated_at=excluded.updated_at
  `).run(userId, kind, targetId, hidden ? 1 : 0, important ? 1 : 0, importantAt, lastReadAt, lastReadMessageId, now);
  return { hidden, important, importantAt, lastReadAt, lastReadMessageId, preferenceUpdatedAt: now };
}

function restoreShortcut(db, userId, kind, targetId) {
  return updatePreference(db, userId, kind, targetId, { hidden: false });
}

module.exports = { preferenceMap, restoreShortcut, updatePreference };
