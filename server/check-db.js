const db = require('./src/db');
const u = db.prepare("SELECT id, username, nickname, phone, role FROM users WHERE username = ? OR phone = ?").get('4du', '13646985884');
console.log('4du user:', JSON.stringify(u));
const n = db.prepare("SELECT created_at FROM notifications WHERE type = ? LIMIT 3").all('welcome');
console.log('welcome times:', JSON.stringify(n.map(r => r.created_at)));
