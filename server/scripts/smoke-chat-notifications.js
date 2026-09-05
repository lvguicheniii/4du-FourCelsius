const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { JWT_SECRET } = require('../src/lib/security-config');

async function main() {
  const viewer = db.prepare(`
    SELECT u.id,u.token_version,n.related_id
    FROM notifications n JOIN users u ON u.id=n.user_id
    WHERE n.type='follow' AND n.related_id IS NOT NULL AND n.related_id!=''
    ORDER BY n.created_at DESC LIMIT 1
  `).get() || db.prepare('SELECT id,token_version,NULL AS related_id FROM users ORDER BY created_at LIMIT 1').get();
  if (!viewer) throw new Error('No user is available for the smoke test');
  const peer = viewer.related_id
    ? { id: viewer.related_id }
    : db.prepare('SELECT id FROM users WHERE id!=? ORDER BY created_at LIMIT 1').get(viewer.id);
  if (!peer) throw new Error('No peer is available for the smoke test');

  const token = jwt.sign({ userId: viewer.id, tokenVersion: viewer.token_version }, JWT_SECRET, { expiresIn: '2m' });
  const headers = { Authorization: `Bearer ${token}` };
  const preferenceResponse = await fetch(`http://127.0.0.1:3001/api/chat/conversations/${encodeURIComponent(peer.id)}/preference`, { headers });
  if (!preferenceResponse.ok) throw new Error(`Preference endpoint returned ${preferenceResponse.status}`);

  const conversationsResponse = await fetch('http://127.0.0.1:3001/api/chat/conversations', { headers });
  if (!conversationsResponse.ok) throw new Error(`Conversations endpoint returned ${conversationsResponse.status}`);
  const conversations = await conversationsResponse.json();
  if (!Array.isArray(conversations)) throw new Error('Conversations endpoint did not return a list');

  const notificationsResponse = await fetch('http://127.0.0.1:3001/api/notifications?category=interaction', { headers });
  if (!notificationsResponse.ok) throw new Error(`Notifications endpoint returned ${notificationsResponse.status}`);
  const notifications = await notificationsResponse.json();
  const follow = notifications.find((item) => item.type === 'follow' && item.relatedId);
  if (follow && (!follow.actorId || !follow.actorName)) throw new Error('Follow notification actor was not hydrated');

  const migration = db.prepare('SELECT id,applied_at FROM schema_migrations WHERE id=?').get('047_follow_notification_actor');
  if (!migration) throw new Error('Follow notification actor migration is not applied');
  const followStats = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN related_id IS NOT NULL AND related_id!='' THEN 1 ELSE 0 END) AS linked
    FROM notifications WHERE type='follow'
  `).get();

  console.log(JSON.stringify({
    ok: true,
    preferenceStatus: preferenceResponse.status,
    conversationsStatus: conversationsResponse.status,
    hydratedFollow: !!follow,
    migration: migration.id,
    followNotifications: followStats,
  }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
