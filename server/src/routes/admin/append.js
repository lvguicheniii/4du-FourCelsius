const lastPushAt = new Map();
const { sendPushToUser, sendPushMessages } = require('../../lib/push');
const { isFeatureEnabled } = require('../../lib/feature-flags');

module.exports = function registerAdminAppend(router, { adminAuth, db, uuid, logAdmin }) {
// 用户详情
router.get('/users/:id/detail', adminAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({error:'用户不存在'});
  const posts = db.prepare('SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.params.id);
  const likes = db.prepare('SELECT COUNT(*) as c FROM post_cools WHERE user_id=?').get(req.params.id).c;
  const flwing = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id=?').get(req.params.id).c;
  const flwers = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id=?').get(req.params.id).c;
  res.json({
    user: { id:u.id, username:u.username, nickname:u.nickname, phone:u.phone, email:u.email, avatar:u.avatar, bio:u.bio, role:u.role, status:u.status, ban_reason:u.ban_reason, register_ip:u.register_ip, last_login_ip:u.last_login_ip, last_login_at:u.last_login_at, login_count:u.login_count, created_at:u.created_at },
    stats: { posts:posts.length, likes, following:flwing, followers:flwers },
    activity: posts.slice(0,10).map(p=>({ id:p.id, content:p.content, images:JSON.parse(p.images||'[]'), likes:p.likes_count, comments:p.comments_count, status:p.status, created_at:p.created_at }))
  });
});

// 通知推送
router.post('/notify', adminAuth, (req, res) => {
  const target = String(req.body.target || '');
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  const userId = String(req.body.userId || '').trim();
  if (!['all', 'single'].includes(target)) return res.status(400).json({error:'无效的推送范围'});
  if (!title || !content) return res.status(400).json({error:'标题和内容不能为空'});
  if (title.length > 80 || content.length > 2000) return res.status(400).json({error:'标题或内容过长'});
  if (target === 'all' && req.adminRole !== 'superadmin') return res.status(403).json({error:'全员推送需要超级管理员权限'});
  const now = Date.now();
  if (now - (lastPushAt.get(req.adminId) || 0) < 10_000) {
    return res.status(429).json({error:'推送过于频繁，请稍后再试'});
  }
  lastPushAt.set(req.adminId, now);
  let delivered = 0;
  if (target==='all') {
    const users = db.prepare("SELECT id FROM users WHERE status='active' AND role NOT IN ('admin','reviewer','superadmin')").all();
    const stmt = db.prepare("INSERT INTO notifications (id,user_id,category,type,title,content,related_id,created_at) VALUES (?,?,?,?,?,?,?,datetime('now','+8 hours'))");
    const tx = db.transaction(()=>{ users.forEach(u=>{ stmt.run(uuid(),u.id,'system','system',title,content,''); }); });
    tx();
    delivered = users.length;
    req.app.get('ws')?.broadcast({ type:'notification', category:'system', notificationType:'system', title, content });
    const tokens = db.prepare("SELECT user_id,token FROM device_push_tokens WHERE enabled=1").all();
    void sendPushMessages(tokens.filter(({user_id}) => isFeatureEnabled('offline_push', user_id)).map(({token}) => ({ to:token, sound:'default', title, body:content, data:{type:'system'}, channelId:'sidu-social' })));
  } else if (target==='single' && userId) {
    const recipient = db.prepare("SELECT id FROM users WHERE id=? AND status!='deleted'").get(userId);
    if (!recipient) return res.status(404).json({error:'接收用户不存在'});
    db.prepare("INSERT INTO notifications (id,user_id,category,type,title,content,related_id,created_at) VALUES (?,?,?,?,?,?,?,datetime('now','+8 hours'))").run(uuid(),userId,'system','system',title,content,'');
    delivered = 1;
    req.app.get('ws')?.send(userId, { type:'notification', category:'system', notificationType:'system', title, content });
    sendPushToUser(userId, { title, body:content, data:{type:'system'} });
  } else {
    return res.status(400).json({error:'请选择接收用户'});
  }
  logAdmin(req.adminId, 'push_notification', 'notification', target === 'all' ? 'all' : userId, `标题: ${title}; 送达: ${delivered}`, req.ip);
  res.json({ok:true, delivered});
});

// 通知列表
router.get('/notifications', adminAuth, (req, res) => {
  const page=parseInt(req.query.page)||1, limit=20, offset=(page-1)*limit;
  const items=db.prepare('SELECT title,content,created_at FROM notifications WHERE type=? ORDER BY created_at DESC LIMIT ? OFFSET ?').all('system',limit,offset);
  const total=db.prepare('SELECT COUNT(*) as c FROM notifications WHERE type=?').get('system').c;
  res.json({items,total,page,totalPages:Math.ceil(total/limit)});
});

// 趋势数据
router.get('/trends', adminAuth, (req, res) => {
  const days=[],up=[],pp=[];
  for (let i=29;i>=0;i--) {
    const d=new Date(Date.now() + 8 * 3600 * 1000); d.setUTCDate(d.getUTCDate()-i);
    const ds=d.toISOString().slice(0,10);
    days.push(ds.slice(5));
    up.push(db.prepare('SELECT COUNT(*) as c FROM users WHERE date(created_at)=?').get(ds).c);
    pp.push(db.prepare('SELECT COUNT(*) as c FROM posts WHERE date(created_at)=?').get(ds).c);
  }
  res.json({days,up,pp});
});
};
