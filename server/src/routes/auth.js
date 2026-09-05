const { Router } = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { parseCst } = require('../lib/time');
const { claimDailyRefrigerant } = require('../lib/refrigerant');
const { getFrostShellState } = require('../lib/frost-shell');
const { getEntropyState } = require('../lib/entropy');
const { auth, optionalAuth } = require('../middleware/auth');
const { triggerAchievement } = require('../lib/achievements');
const { getRequestIp, getUserIpRegion } = require('../lib/ip-region');
const { JWT_SECRET } = require('../lib/security-config');
const { checkLoginThrottle, recordLoginFailure, clearLoginFailures } = require('../lib/login-throttle');
const { hashPassword, comparePassword } = require('../lib/password-work');
const { asyncRoute } = require('../lib/async-route');
const { rateLimit } = require('../middleware/rate-limit');
const { persistentRateLimit } = require('../middleware/persistent-rate-limit');
const { isOwnedMediaUrl } = require('../lib/media-ownership');
const {
  createCaptchaChallenge,
  markCaptchaChallengeUsed,
  normalizePurpose: normalizeCaptchaPurpose,
  renderCaptchaLaunchPage,
  verifyCaptchaProof,
  getPublicCaptchaConfig,
} = require('../lib/tencent-captcha');
const {
  normalizePhone,
  phoneSubject,
  sendVerificationCode,
  verifyAndConsumeCode,
} = require('../lib/sms-verification');
const {
  fixedVerificationCode,
  usesFixedVerificationCode,
  verifyFixedVerificationCode,
} = require('../lib/registration-verification');

const router = Router();
const USER_IP_POLICY = { maxFailures: 50, windowMs: 15 * 60 * 1000, blockMs: 15 * 60 * 1000 };
const USER_ACCOUNT_POLICY = { maxFailures: 10, windowMs: 15 * 60 * 1000, blockMs: 15 * 60 * 1000 };
const registrationLimit = persistentRateLimit({
  scope: 'auth.register',
  limit: 5,
  windowMs: 60 * 60 * 1000,
  subject: req => getRequestIp(req) || 'unknown',
  message: '该网络注册请求过多，请稍后再试',
});
const loginAttemptLimit = rateLimit({ scope: 'auth.login', limit: 60, windowMs: 60 * 1000 });
const sensitiveAccountLimit = rateLimit({
  scope: 'auth.sensitive-account-change',
  limit: 10,
  windowMs: 15 * 60 * 1000,
  message: '安全验证尝试过多，请稍后再试',
});
const passwordRecoveryLimit = persistentRateLimit({
  scope: 'auth.password-recovery',
  limit: 5,
  windowMs: 60 * 60 * 1000,
  subject: req => phoneSubjectSafe(req.body?.phone),
  message: '找回密码请求过多，请稍后再试',
});
const captchaChallengeLimit = persistentRateLimit({
  scope: 'auth.captcha-challenge',
  limit: 30,
  windowMs: 60 * 60 * 1000,
  subject: req => getRequestIp(req) || 'unknown',
  message: '安全验证请求过多，请稍后再试',
});
const sendCodeIpLimit = persistentRateLimit({
  scope: 'auth.sms-send.ip',
  limit: 10,
  windowMs: 60 * 60 * 1000,
  subject: req => getRequestIp(req) || 'unknown',
  message: '该网络发送短信过多，请稍后再试',
});
const sendCodePhoneLimit = persistentRateLimit({
  scope: 'auth.sms-send.phone',
  limit: 5,
  windowMs: 60 * 60 * 1000,
  subject: req => phoneSubjectSafe(req.body?.phone),
  message: '该手机号发送短信过多，请稍后再试',
});

function phoneSubjectSafe(phone) {
  try { return phoneSubject(phone); }
  catch { return 'invalid-phone'; }
}

function createUserToken(userId, tokenVersion) {
  return jwt.sign({ userId, tokenVersion, purpose: 'user' }, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: 'sidu-api',
    audience: 'sidu-app',
    expiresIn: '30d',
  });
}

async function hashSecurityAnswer(answer) {
  const value = String(answer || '');
  return value ? hashPassword(value, 10) : '';
}

function userLoginSubjects(req, username) {
  return [
    { scope: 'user_ip', subject: getRequestIp(req) || 'unknown', policy: USER_IP_POLICY },
    { scope: 'user_account', subject: String(username || '').trim(), policy: USER_ACCOUNT_POLICY },
  ];
}

function generateUid() {
  // 生成 7 位唯一数字 UID，永不重复
  for (let i = 0; i < 100; i++) {
    const uid = String(crypto.randomInt(1000000, 10000000)); // 7位数字
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
    if (!exists) return uid;
  }
  throw new Error('无法生成唯一UID');
}

function textLength(value) {
  return Array.from(String(value || '')).length;
}

router.post('/captcha/challenge', captchaChallengeLimit, asyncRoute(async (req, res) => {
  const purpose = normalizeCaptchaPurpose(req.body?.purpose);
  if (usesFixedVerificationCode()) {
    return res.status(409).json({
      error: '当前使用固定验证码，无需进行图片验证',
      code: 'FIXED_VERIFICATION_ENABLED',
      purpose,
    });
  }
  const challenge = createCaptchaChallenge(purpose);
  const origin = `${req.protocol}://${req.get('host')}`;
  const redirectUri = String(req.body?.client || '') === 'web' ? `${req.protocol}://${req.get('host')}/captcha-result` : 'communityapp://captcha-result';
  const params = new URLSearchParams({ redirect_uri: redirectUri });
  const response = {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    redirectUri,
    launchUrl: `${origin}/api/auth/captcha/launch/${encodeURIComponent(challenge.id)}?${params}`,
  };
  if (String(req.body?.client || '') === 'web') Object.assign(response, getPublicCaptchaConfig());
  res.json(response);
}));

router.get('/captcha/launch/:id', (req, res, next) => {
  try {
    const html = renderCaptchaLaunchPage({
      challengeId: req.params.id,
      redirectUri: req.query.redirect_uri,
    });
    res.set({
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': [
        "default-src 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'",
        "script-src 'unsafe-inline' https://turing.captcha.qcloud.com https:",
        "style-src 'unsafe-inline'",
        "img-src data: https:",
        "connect-src https:",
        "frame-src https:",
      ].join('; '),
    });
    res.send(html);
  } catch (error) {
    next(error);
  }
});

router.post('/send-code', optionalAuth, sendCodeIpLimit, asyncRoute(async (req, res, next) => {
  const purpose = normalizeCaptchaPurpose(req.body?.purpose);
  let phone = normalizePhone(req.body?.phone);
  if (purpose === 'password_change') {
    if (!req.userId) return res.status(401).json({ error: '请先登录' });
    const current = db.prepare("SELECT phone FROM users WHERE id=? AND status!='deleted'").get(req.userId);
    if (!current?.phone) return res.status(400).json({ error: '当前账号未绑定手机号' });
    if (phone !== current.phone) return res.status(400).json({ error: '手机号与当前账号不一致' });
    phone = current.phone;
  }

  if (usesFixedVerificationCode()) {
    req.body.phone = phone;
    return sendCodePhoneLimit(req, res, next);
  }

  await verifyCaptchaProof({
    challengeId: req.body?.captcha?.challengeId,
    purpose,
    ticket: req.body?.captcha?.ticket,
    randstr: req.body?.captcha?.randstr,
    userIp: getRequestIp(req),
  });

  req.body.phone = phone;
  sendCodePhoneLimit(req, res, next);
}), asyncRoute(async (req, res) => {
  const purpose = normalizeCaptchaPurpose(req.body?.purpose);
  const phone = normalizePhone(req.body?.phone);

  if (purpose === 'register') {
    const existing = db.prepare("SELECT id FROM users WHERE phone=? AND status!='deleted'").get(phone);
    if (existing) return res.status(409).json({ error: '该手机号已注册，请前往登录界面' });
  }
  if (usesFixedVerificationCode()) {
    return res.json({ ok: true, mode: 'fixed', fixedCode: fixedVerificationCode() });
  }
  if (purpose === 'password_reset') {
    const existing = db.prepare("SELECT id FROM users WHERE phone=? AND status!='deleted'").get(phone);
    if (!existing) {
      markCaptchaChallengeUsed(req.body?.captcha?.challengeId);
      return res.json({ ok: true, cooldownSeconds: 60, expiresInSeconds: 300 });
    }
  }

  const result = await sendVerificationCode({ phone, purpose });
  markCaptchaChallengeUsed(req.body?.captcha?.challengeId);
  res.json(result);
}));

// 注册
router.post('/register', registrationLimit, asyncRoute(async (req, res) => {
  const { username, password, phone, code, nickname, avatar, gender, security_question, security_answer, age } = req.body;
  const normalizedAge = age === undefined ? 18 : age;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (textLength(username) < 2 || textLength(username) > 20) {
    return res.status(400).json({ error: '用户名需要 2-20 个字符' });
  }
  if (password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: '密码需要 10-128 位' });
  }
  if (nickname !== undefined && (typeof nickname !== 'string' || !nickname.trim() || textLength(nickname.trim()) > 20)) {
    return res.status(400).json({ error: '昵称不能为空且不能超过 20 个字符' });
  }
  if (typeof phone !== 'string' || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: '手机号格式错误' });
  }
  if (security_question !== undefined && (typeof security_question !== 'string' || textLength(security_question) > 100)) {
    return res.status(400).json({ error: '安全问题不能超过 100 个字符' });
  }
  if (security_answer !== undefined && (typeof security_answer !== 'string' || textLength(security_answer) > 200)) {
    return res.status(400).json({ error: '安全问题答案不能超过 200 个字符' });
  }
  if (!Number.isInteger(normalizedAge) || normalizedAge < 0 || normalizedAge > 444) {
    return res.status(400).json({ error: '年龄必须是 0 到 444 之间的整数' });
  }

  // 检查手机号是否已注册
  if (phone) {
    const phoneExist = db.prepare('SELECT id FROM users WHERE phone = ? AND status != ?').get(phone, 'deleted');
    if (phoneExist) {
      return res.status(409).json({ error: '该手机号已注册，请前往登录界面' });
    }
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: '用户名已被注册' });
  }

  if (usesFixedVerificationCode()) verifyFixedVerificationCode(code);
  else verifyAndConsumeCode({ phone, purpose: 'register', code });

  const id = generateUid();
  const [hash, securityAnswerHash] = await Promise.all([
    hashPassword(password, 10),
    hashSecurityAnswer(security_answer),
  ]);
  const nick = nickname?.trim() || username;

  const registerIp = getRequestIp(req);
  try {
    db.prepare('INSERT INTO users (id, username, password_hash, nickname, phone, avatar, gender, age, security_question, security_answer, register_ip, last_login_ip, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime(\'now\',\'+8 hours\'))')
      .run(id, username, hash, nick, phone || '', avatar || null, gender || '', normalizedAge, security_question || '', securityAnswerHash, registerIp, registerIp);
  } catch (error) {
    if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: '用户名已被注册' });
    }
    throw error;
  }
  const refrigerant = claimDailyRefrigerant(id);
  const shells = getFrostShellState(db, id);

  // 欢迎通知
  db.prepare(`INSERT INTO notifications (id, user_id, category, type, title, content, related_id, created_at) VALUES (?,?,?,?,?,?,?,datetime('now','+8 hours'))`)
    .run(require('uuid').v4(), id, 'system', 'welcome', '欢迎来到肆度', `凡真实的人生，皆为相遇。
在这里，你可以随时制备切片，将此刻的情绪抛入「浮霜带」。
若无人问津，切片会随时间缓慢升温融化，最终沉降至幽暗的「潜流域」。请不要对下沉感到焦虑——那不是社交的失败，只是情绪脱离了喧嚣的公域，回归了深海的宁静。
你也可以主动「封装」一枚信标投入渊底，在最深的水下，等待一次同频的「共振」。
想与人围坐交谈时，可以进入「隐海礁」：在公海的礁石里遇见陌生的声音，或在领海创建一座私人礁石，留出一处有期限、也更安静的交流空间。
祝你在 4°C，获得平静。`, '');

  const token = createUserToken(id, 0);
  res.json({
    token,
    user: {
      id,
      username,
      nickname: nick,
      avatar: avatar || null,
      bio: '',
      tags: [],
      gender: gender || null,
      age: normalizedAge,
      refrigerant_count: refrigerant.count,
      gifted_refrigerant_count: 0,
      fragile_frost_shell_count: shells.fragileCount,
      eternal_frost_shell_count: shells.eternalCount,
    }
  });
}));

// 登录
router.post('/login', loginAttemptLimit, asyncRoute(async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length > 100 || password.length > 128) return res.status(400).json({ error: '登录信息长度超限' });

  const throttleSubjects = userLoginSubjects(req, username);
  const blocked = throttleSubjects
    .map((item) => checkLoginThrottle(db, item.scope, item.subject, item.policy))
    .find((result) => !result.allowed);
  if (blocked) {
    res.set('Retry-After', String(blocked.retryAfterSeconds));
    return res.status(429).json({ error: '登录尝试过多，请稍后再试', retryAfterSeconds: blocked.retryAfterSeconds });
  }

  const user = db.prepare('SELECT * FROM users WHERE (username = ? OR phone = ?)').get(username, username);
  if (!user) {
    throttleSubjects.forEach((item) => recordLoginFailure(db, item.scope, item.subject, item.policy));
    return res.status(401).json({ error: '手机号未注册' });
  }
  if (!await comparePassword(password, user.password_hash)) {
    throttleSubjects.forEach((item) => recordLoginFailure(db, item.scope, item.subject, item.policy));
    return res.status(401).json({ error: '密码错误' });
  }
  throttleSubjects.forEach((item) => clearLoginFailures(db, item.scope, item.subject));
  if (user.status === 'deleted') {
    return res.status(403).json({ error: '该账号已被注销' });
  }
  if (user.status === 'banned' && user.ban_until && parseCst(user.ban_until)?.getTime() <= Date.now()) {
    db.prepare("UPDATE users SET status = 'active', ban_reason = '', ban_until = NULL WHERE id = ?").run(user.id);
    user.status = 'active';
    user.ban_reason = '';
    user.ban_until = null;
  }
  if (user.muted_until && parseCst(user.muted_until)?.getTime() <= Date.now()) {
    db.prepare('UPDATE users SET muted_until = NULL WHERE id = ?').run(user.id);
    user.muted_until = null;
  }

  const lastActiveAt = user.last_online_at || user.last_login_at;
  const wasAwayFor48Hours = !!lastActiveAt
    && Date.now() - (parseCst(lastActiveAt)?.getTime() || Date.now()) >= 48 * 60 * 60 * 1000;

  // 递增 token_version + 更新登录记录
  const newVersion = (user.token_version || 0) + 1;
  db.prepare("UPDATE users SET token_version = ?, last_login_at = datetime('now','+8 hours'), last_login_ip = ?, login_count = login_count + 1 WHERE id = ?")
    .run(newVersion, getRequestIp(req), user.id);
  const refrigerant = claimDailyRefrigerant(user.id);
  const shells = getFrostShellState(db, user.id);
  if (wasAwayFor48Hours) triggerAchievement(db, user.id, 'deep_hibernation');

  const token = createUserToken(user.id, newVersion);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname || user.username,
      avatar: user.avatar,
      bio: user.bio,
      tags: JSON.parse(user.tags || '[]'),
      gender: user.gender || null,
      age: user.age,
      refrigerant_count: refrigerant.count,
      gifted_refrigerant_count: Number(user.gifted_refrigerant_count) || 0,
      fragile_frost_shell_count: shells.fragileCount,
      eternal_frost_shell_count: shells.eternalCount,
      role: user.role || 'user',
      status: user.status || 'active',
      ban_reason: user.ban_reason || '',
      ban_until: user.ban_until || null,
      muted_until: user.muted_until || null,
    }
  });
}));

// 网页端使用独立可撤销会话，不递增 App 的单设备 token_version。
router.post('/web-login', loginAttemptLimit, asyncRoute(async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length > 100 || password.length > 128) return res.status(400).json({ error: '登录信息长度超限' });

  const throttleSubjects = userLoginSubjects(req, username);
  const blocked = throttleSubjects
    .map((item) => checkLoginThrottle(db, item.scope, item.subject, item.policy))
    .find((result) => !result.allowed);
  if (blocked) {
    res.set('Retry-After', String(blocked.retryAfterSeconds));
    return res.status(429).json({ error: '登录尝试过多，请稍后再试', retryAfterSeconds: blocked.retryAfterSeconds });
  }

  const user = db.prepare('SELECT * FROM users WHERE (username = ? OR phone = ?)').get(username, username);
  if (!user || !await comparePassword(password, user.password_hash)) {
    throttleSubjects.forEach((item) => recordLoginFailure(db, item.scope, item.subject, item.policy));
    return res.status(401).json({ error: user ? '密码错误' : '手机号未注册' });
  }
  throttleSubjects.forEach((item) => clearLoginFailures(db, item.scope, item.subject));
  if (user.status === 'deleted') return res.status(403).json({ error: '该账号已被注销' });
  if (user.status === 'banned' && (!user.ban_until || (parseCst(user.ban_until)?.getTime() || 0) > Date.now())) {
    return res.status(403).json({ error: '账号已被封禁', banned: true, banUntil: user.ban_until || null });
  }

  const token = `sidu_web_${crypto.randomBytes(32).toString('base64url')}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = db.prepare("SELECT datetime('now','+30 days','+8 hours') AS value").get().value;
  db.transaction(() => {
    db.prepare("DELETE FROM web_sessions WHERE datetime(expires_at) <= datetime('now','+8 hours')").run();
    db.prepare('INSERT INTO web_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(tokenHash, user.id, expiresAt);
    db.prepare(`
      DELETE FROM web_sessions
      WHERE user_id = ? AND token_hash NOT IN (
        SELECT token_hash FROM web_sessions
        WHERE user_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 5
      )
    `).run(user.id, user.id);
    db.prepare("UPDATE users SET last_login_at=datetime('now','+8 hours'), last_login_ip=?, login_count=login_count+1 WHERE id=?")
      .run(getRequestIp(req), user.id);
  })();
  const refrigerant = claimDailyRefrigerant(user.id);
  const shells = getFrostShellState(db, user.id);
  res.json({
    token,
    expiresAt,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname || user.username,
      avatar: user.avatar,
      bio: user.bio,
      tags: JSON.parse(user.tags || '[]'),
      gender: user.gender || null,
      age: user.age,
      refrigerant_count: refrigerant.count,
      gifted_refrigerant_count: Number(user.gifted_refrigerant_count) || 0,
      fragile_frost_shell_count: shells.fragileCount,
      eternal_frost_shell_count: shells.eternalCount,
      role: user.role || 'user',
      status: user.status || 'active',
      muted_until: user.muted_until || null,
    },
  });
}));

router.post('/web-logout', auth, (req, res) => {
  if (req.webSessionHash) db.prepare('DELETE FROM web_sessions WHERE token_hash = ?').run(req.webSessionHash);
  res.json({ ok: true });
});

// 获取当前用户
router.get('/me', auth, (req, res) => {
  const dailyRefrigerant = claimDailyRefrigerant(req.userId);
  const shells = getFrostShellState(db, req.userId);
  const currentIp = getRequestIp(req);
  if (currentIp) {
    db.prepare('UPDATE users SET last_login_ip = ? WHERE id = ? AND COALESCE(last_login_ip, \'\') != ?')
      .run(currentIp, req.userId, currentIp);
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND status != ?').get(req.userId, 'deleted');
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(req.userId).c;
  const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(req.userId).c;
  const postCount = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(req.userId).c;

  res.json({
    id: user.id,
    username: user.username,
    nickname: user.nickname || user.username,
    avatar: user.avatar,
    bio: user.bio,
    tags: JSON.parse(user.tags || '[]'),
    cover_image: user.cover_image,
    gender: user.gender || null,
    age: user.age,
    refrigerant_count: dailyRefrigerant.count,
    gifted_refrigerant_count: Number(user.gifted_refrigerant_count) || 0,
    fragile_frost_shell_count: shells.fragileCount,
    eternal_frost_shell_count: shells.eternalCount,
    refrigerant_daily_granted: dailyRefrigerant.granted,
    phone: user.phone || '',
    security_question: user.security_question || '',
    role: user.role || 'user',
    status: user.status || 'active',
    ban_reason: user.ban_reason || '',
    ban_until: user.ban_until || null,
    muted_until: user.muted_until || null,
    entropy: getEntropyState(user),
    ipRegion: getUserIpRegion(user),
    stats: {
      posts: postCount,
      following: followingCount,
      followers: followerCount,
      refrigerant: dailyRefrigerant.count,
    },
  });
});

// 更新个人资料
router.put('/profile', auth, (req, res) => {
  const { nickname, bio, tags, avatar, cover_image, age } = req.body;
  const updates = {};
  if (nickname !== undefined) {
    const value = typeof nickname === 'string' ? nickname.trim() : '';
    if (!value || textLength(value) > 20) return res.status(400).json({ error: '昵称不能为空且不能超过 20 个字符' });
    updates.nickname = value;
  }
  if (bio !== undefined) {
    if (typeof bio !== 'string' || textLength(bio) > 500) return res.status(400).json({ error: '个人简介不能超过 500 个字符' });
    updates.bio = bio.trim();
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > 20) return res.status(400).json({ error: '个性标签格式错误或数量过多' });
    const normalizedTags = tags.map(tag => typeof tag === 'string' ? tag.trim() : '');
    if (normalizedTags.some(tag => !tag || textLength(tag) > 20)) return res.status(400).json({ error: '每个个性标签需为 1-20 个字符' });
    updates.tags = JSON.stringify([...new Set(normalizedTags)]);
  }
  if (avatar !== undefined) {
    if (avatar === null || avatar === '') updates.avatar = null;
    else if (!isOwnedMediaUrl(avatar, req.userId, req)) return res.status(400).json({ error: '头像文件无效，请重新上传' });
    else updates.avatar = String(avatar);
  }
  if (cover_image !== undefined) {
    if (cover_image === null || cover_image === '') updates.cover_image = null;
    else if (!isOwnedMediaUrl(cover_image, req.userId, req)) return res.status(400).json({ error: '背景图文件无效，请重新上传' });
    else updates.cover_image = String(cover_image);
  }
  if (age !== undefined) {
    if (!Number.isInteger(age) || age < 0 || age > 444) {
      return res.status(400).json({ error: '年龄必须是 0 到 444 之间的整数' });
    }
    updates.age = age;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: '没有需要更新的字段' });
  }

  const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...values, req.userId);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({
    id: user.id,
    username: user.username,
    nickname: user.nickname || user.username,
    avatar: user.avatar,
    bio: user.bio,
    tags: JSON.parse(user.tags || '[]'),
    gender: user.gender || null,
    age: user.age,
  });
});

// 获取用户公开信息
router.get('/profile/:id', optionalAuth, (req, res) => {
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) {
    user = db.prepare('SELECT * FROM users WHERE username = ? OR nickname = ?').get(req.params.id, req.params.id);
  }
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 已注销用户返回精简信息
  if (user.status === 'deleted') {
    return res.json({
      id: user.id,
      deleted: true,
      nickname: '已注销',
      username: 'deleted',
      bio: '该用户已注销账号',
      avatar: null,
      tags: [],
    });
  }

  const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(user.id).c;
  const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(user.id).c;
  const postCount = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(user.id).c;
  const following = !!req.userId && !!db.prepare(
    'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
  ).get(req.userId, user.id);
  const followedBy = !!req.userId && !!db.prepare(
    'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
  ).get(user.id, req.userId);
  const blocked = !!req.userId && !!db.prepare(
    'SELECT 1 FROM blocks WHERE user_id = ? AND blocked_user_id = ?',
  ).get(req.userId, user.id);
  const blockedBy = !!req.userId && !!db.prepare(
    'SELECT 1 FROM blocks WHERE user_id = ? AND blocked_user_id = ?',
  ).get(user.id, req.userId);

  res.json({
    id: user.id,
    username: user.username,
    nickname: user.nickname || user.username,
    avatar: user.avatar,
    bio: user.bio,
    tags: JSON.parse(user.tags || '[]'),
    cover_image: user.cover_image,
    gender: user.gender || null,
    age: user.age,
    status: user.status || 'active',
    muted_until: user.muted_until || null,
    entropy: getEntropyState(user),
    ipRegion: getUserIpRegion(user),
    following,
    followedBy,
    mutuallyFollowing: following && followedBy,
    blocked,
    blockedBy,
    stats: { posts: postCount, following: followingCount, followers: followerCount },
  });
});

// 注销账号：保留社区内容的引用完整性，但不可逆匿名化账号身份信息。
router.delete('/account', auth, sensitiveAccountLimit, asyncRoute(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const disabledPassword = await hashPassword(crypto.randomBytes(48).toString('base64url'), 10);
  const anonymousUsername = `deleted_${req.userId}_${crypto.randomBytes(6).toString('hex')}`;

  db.transaction(() => {
    // 注销账号会让用户自己的切片退出展示并清理信标；评论、私信和礁石内容保留原始记录。
    db.prepare(`
      UPDATE posts
      SET status='deleted', delete_reason='账号已注销', deleted_at=datetime('now','+8 hours'), updated_at=datetime('now','+8 hours')
      WHERE user_id=? AND status!='deleted'
    `).run(req.userId);
    db.prepare('DELETE FROM beacons WHERE user_id=?').run(req.userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.userId);
    db.prepare('DELETE FROM web_sessions WHERE user_id=?').run(req.userId);
    db.prepare('DELETE FROM device_push_tokens WHERE user_id=?').run(req.userId);
    db.prepare('DELETE FROM follows WHERE follower_id=? OR following_id=?').run(req.userId, req.userId);
    db.prepare('DELETE FROM blocks WHERE user_id=? OR blocked_user_id=?').run(req.userId, req.userId);
    db.prepare('DELETE FROM mutual_hides WHERE user_a=? OR user_b=?').run(req.userId, req.userId);
    db.prepare("UPDATE media_assets SET status='deleted' WHERE owner_id=?").run(req.userId);
    db.prepare(`
      UPDATE users SET
        username=?, password_hash=?, nickname='已注销用户', phone='', email='',
        avatar=NULL, cover_image=NULL, bio='', tags='[]', gender='', age=NULL,
        security_question='', security_answer='', register_ip='', last_login_ip='',
        last_login_at=NULL, status='deleted', deleted_at=datetime('now','+8 hours'),
        token_version=token_version+1, updated_at=datetime('now','+8 hours')
      WHERE id=?
    `).run(anonymousUsername, disabledPassword, req.userId);
  })();

  res.json({ ok: true, message: '账号已注销' });
}));

// 修改密码：同时校验当前密码和当前账号的验证码。
router.put('/change-password', auth, sensitiveAccountLimit, asyncRoute(async (req, res) => {
  const { password, current_password, verify_code } = req.body;
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) return res.status(400).json({ error: '密码需要 10-128 位' });
  if (typeof current_password !== 'string' || !current_password || current_password.length > 128) return res.status(400).json({ error: '请输入有效的当前密码' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (!await comparePassword(current_password, user.password_hash)) {
    return res.status(401).json({ error: '当前密码错误' });
  }
  if (!user.phone) return res.status(400).json({ error: '当前账号未绑定手机号' });
  if (usesFixedVerificationCode()) verifyFixedVerificationCode(verify_code);
  else verifyAndConsumeCode({ phone: user.phone, purpose: 'password_change', code: verify_code });

  const hash = await hashPassword(password, 10);
  const newVersion = Number(user.token_version || 0) + 1;
  db.prepare('UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?')
    .run(hash, newVersion, req.userId);
  db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(req.userId);
  res.json({ ok: true, token: createUserToken(req.userId, newVersion) });
}));

// 修改手机号：短信服务接入前，先用当前密码确认账号所有权。
router.put('/change-phone', auth, sensitiveAccountLimit, asyncRoute(async (req, res) => {
  const { phone, current_password } = req.body;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) return res.status(400).json({ error: '手机号格式错误' });
  if (typeof current_password !== 'string' || !current_password || current_password.length > 128) return res.status(400).json({ error: '请输入有效的当前密码' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (!await comparePassword(current_password, user.password_hash)) {
    return res.status(401).json({ error: '当前密码错误' });
  }

  const exist = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ? AND status != ?').get(phone, req.userId, 'deleted');
  if (exist) return res.status(409).json({ error: '该手机号已被其他账号绑定' });

  const current = db.prepare('SELECT username, phone FROM users WHERE id = ?').get(req.userId);
  let nextUsername = current?.username || '';
  const isAutoUsername = nextUsername === `user_${current?.phone || ''}` || /^user_\d{11}$/.test(nextUsername);
  if (isAutoUsername) {
    const candidate = `user_${phone}`;
    const collision = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(candidate, req.userId);
    if (!collision) nextUsername = candidate;
  }
  const newVersion = Number(user.token_version || 0) + 1;
  db.prepare("UPDATE users SET phone = ?, username = ?, token_version = ?, updated_at = datetime('now','+8 hours') WHERE id = ?")
    .run(phone, nextUsername, newVersion, req.userId);
  db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(req.userId);
  res.json({
    ok: true,
    username: nextUsername,
    accountCode: `user_${phone}`,
    token: createUserToken(req.userId, newVersion),
  });
}));

router.post('/forgot-password-step1', passwordRecoveryLimit, (req, res) => {
  res.status(400).json({ error: '请先获取验证码', code: 'VERIFICATION_REQUIRED' });
});

router.post('/forgot-password-step2', passwordRecoveryLimit, asyncRoute(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const password = req.body?.password;
  const verifyCode = req.body?.verify_code;
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: '密码需要 10-128 位' });
  }
  const user = db.prepare("SELECT id,token_version FROM users WHERE phone=? AND status!='deleted'").get(phone);
  if (!user) return res.status(400).json({ error: '验证码无效', code: 'VERIFICATION_CODE_INVALID' });
  if (usesFixedVerificationCode()) verifyFixedVerificationCode(verifyCode);
  else verifyAndConsumeCode({ phone, purpose: 'password_reset', code: verifyCode });
  const hash = await hashPassword(password, 10);
  const newVersion = Number(user.token_version || 0) + 1;
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash=?,token_version=? WHERE id=?').run(hash, newVersion, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    db.prepare('DELETE FROM web_sessions WHERE user_id=?').run(user.id);
  })();
  res.json({ ok: true, message: '密码已重设，请使用新密码登录' });
}));

module.exports = router;
