require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { nowCst } = require('./lib/time');

const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const commentRoutes = require('./routes/comments');
const followRoutes = require('./routes/follows');
const uploadRoutes = require('./routes/upload');
const adminApiRoutes = require('./routes/admin/api');
const chatRoutes = require('./routes/chat');
const stickerRoutes = require('./routes/stickers');
const beaconRoutes = require('./routes/beacons');
const communityConfigRoutes = require('./routes/community-config');
const refrigerantRoutes = require('./routes/refrigerant');
const frostShellRoutes = require('./routes/frost-shells');
const productRoutes = require('./routes/product');
const reefRoutes = require('./routes/reef');
const achievementRoutes = require('./routes/achievements');
const sliceBoxRoutes = require('./routes/slice-boxes');
const telemetryRoutes = require('./routes/telemetry');
const feedbackRoutes = require('./routes/feedback');
const appModerationRoutes = require('./routes/app-moderation');
const createAppUpdateRoutes = require('./routes/app-updates');
const { router: notificationRoutes } = require('./routes/notifications');
const { auth } = require('./middleware/auth');
const wsServer = require('./ws');
const db = require('./db');
const { reconcileDailyTopics } = require('./lib/daily-topics');
const { reconcileReefLifecycle } = require('./lib/reef-lifecycle');
const { pruneLoginThrottles } = require('./lib/login-throttle');
const { signApiMediaResponses } = require('./lib/cos-media-signing');
const { recordRequestMetric } = require('./lib/runtime-metrics');
const { createWorker: createModerationWorker } = require('./lib/moderation');
const { pruneIdempotencyRequests } = require('./middleware/idempotency');
const { disableDynamicApiCaching } = require('./middleware/dynamic-api-cache');
const { pruneCaptchaChallenges } = require('./lib/tencent-captcha');
const { pruneSmsVerificationCodes } = require('./lib/sms-verification');

const app = express();
app.disable('x-powered-by');
app.set('uploadPressure', uploadRoutes.getPressureStats);
const server = http.createServer(app);
const moderationWorker = createModerationWorker(db);
app.set('moderationWorker', moderationWorker);
const PORT = process.env.PORT || 3001;
const BIND_ADDRESS = process.env.SIDU_BIND_ADDRESS
  || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
const configuredCorsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedCorsOrigins = new Set(configuredCorsOrigins.length ? configuredCorsOrigins : [
  'http://localhost:3001',
]);

pruneLoginThrottles(db);
const loginThrottleCleanupTimer = setInterval(() => pruneLoginThrottles(db), 24 * 60 * 60 * 1000);
loginThrottleCleanupTimer.unref();
pruneIdempotencyRequests();
const idempotencyCleanupTimer = setInterval(pruneIdempotencyRequests, 24 * 60 * 60 * 1000);
idempotencyCleanupTimer.unref();
pruneCaptchaChallenges();
pruneSmsVerificationCodes();
const accountVerificationCleanupTimer = setInterval(() => {
  pruneCaptchaChallenges();
  pruneSmsVerificationCodes();
}, 24 * 60 * 60 * 1000);
accountVerificationCleanupTimer.unref();

// 仅信任本机和私网反向代理，公网直连请求不能伪造 X-Forwarded-For。
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// 每分钟对齐一次北京时间日期状态，跨零点无需重启服务或等待管理员刷新。
reconcileDailyTopics(db);
const dailyTopicTimer = setInterval(() => reconcileDailyTopics(db), 60 * 1000);
dailyTopicTimer.unref();

// Native clients do not send an Origin header. Browser clients are limited to
// the production admin origins so arbitrary websites cannot read API responses.
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedCorsOrigins.has(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
}));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.get('X-Forwarded-Proto') === 'https') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/admin')) {
    res.set('Content-Security-Policy', [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self'",
    ].join('; '));
  }
  next();
});
app.use((req, res, next) => {
  const incomingId = String(req.get('X-Request-ID') || '').trim();
  req.requestId = /^[A-Za-z0-9._:-]{8,100}$/.test(incomingId) ? incomingId : `req_${uuid()}`;
  res.set('X-Request-ID', req.requestId);
  const startedAt = Date.now();
  res.on('finish', () => {
    recordRequestMetric(Date.now() - startedAt, res.statusCode);
    if (res.statusCode < 500) return;
    console.error(JSON.stringify({
      level: 'error',
      type: 'http_request_failed',
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.userId || null,
    }));
  });
  next();
});
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb', strict: true }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/api/notification-assets', express.static(path.join(__dirname, 'public', 'notification-assets'), {
  immutable: true,
  maxAge: '1y',
}));

// JSON API responses are user/session dependent and must never be revalidated
// into an empty 304 response. Immutable OTA and notification assets keep their
// long-lived cache policy.
app.use('/api', disableDynamicApiCaching);

// 管理后台静态文件
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// API 路由
app.use('/api', signApiMediaResponses);
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/follows', followRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminApiRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/stickers', auth, stickerRoutes);
app.use('/api/notifications', auth, notificationRoutes);
app.use('/api/beacons', beaconRoutes);
app.use('/api/community-config', communityConfigRoutes);
app.use('/api/refrigerant', refrigerantRoutes);
app.use('/api/frost-shells', frostShellRoutes);
app.use('/api/product', productRoutes);
app.use('/api/reef', reefRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/slice-boxes', sliceBoxRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/app-moderation', appModerationRoutes);
app.use('/api/app-updates', createAppUpdateRoutes(db));

// 健康检查
app.get('/api/health', (req, res) => {
  const moderation = moderationWorker.getStatus();
  const moderationReady = !moderation.enabled
    || (moderation.credentialsConfigured && moderation.bizTypesConfigured);
  res.status(moderationReady ? 200 : 503).json({
    status: moderationReady ? 'ok' : 'degraded',
    time: nowCst(),
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在', requestId: req.requestId });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error?.status || error?.statusCode) || 500;
  console.error(JSON.stringify({
    level: 'error',
    type: 'unhandled_request_error',
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl.split('?')[0],
    status,
    userId: req.userId || null,
    error: String(error?.message || 'Unknown error').slice(0, 500),
  }));
  res.status(status).json({
    error: status >= 500
      ? '服务器暂时无法处理该请求'
      : status === 413
        ? '请求内容过大'
        : String(error?.message || '请求失败'),
    requestId: req.requestId,
  });
});

// ====== 初始化：自动创建超级管理员 ======
(function ensureSuperAdmin() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1").get();
  if (!admin) {
    const isProduction = process.env.NODE_ENV === 'production';
    const bootstrapUsername = String(process.env.ADMIN_BOOTSTRAP_USERNAME || (isProduction ? '' : 'noesis')).trim();
    let bootstrapPassword = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');
    const generatedPassword = !bootstrapPassword && !isProduction;
    if (generatedPassword) bootstrapPassword = crypto.randomBytes(18).toString('base64url');
    if (bootstrapUsername.length < 3 || bootstrapUsername.length > 64 || bootstrapPassword.length < 12 || bootstrapPassword.length > 128) {
      console.error(isProduction
        ? '未创建超级管理员：生产环境必须设置 3-64 位 ADMIN_BOOTSTRAP_USERNAME 和 12-128 位 ADMIN_BOOTSTRAP_PASSWORD'
        : '未创建超级管理员：请设置有效的 ADMIN_BOOTSTRAP_PASSWORD，或保持为空以生成一次性本地测试密码');
      return;
    }
    const id = uuid();
    const hash = bcrypt.hashSync(bootstrapPassword, 10);
    db.prepare(`INSERT INTO users (id, username, password_hash, nickname, role, status)
      VALUES (?, ?, ?, '超级管理员', 'superadmin', 'active')`).run(id, bootstrapUsername, hash);
    if (generatedPassword) {
      console.warn(`本地超级管理员已创建: ${bootstrapUsername}`);
      console.warn(`一次性初始密码（仅显示本次，请立即登录后修改）: ${bootstrapPassword}`);
    } else {
      console.log(`超级管理员已创建: ${bootstrapUsername}`);
    }
  }
})();

server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`✅ 肆度服务已启动: http://${BIND_ADDRESS}:${PORT}`);
  console.log(`🔧 管理后台: http://localhost:${PORT}/admin`);
});

// WebSocket 实时推送（必须在 server.listen 之前 init）
wsServer.init(server);

// 注入到 chat 路由，让消息发送后可以实时推送
app.set('ws', wsServer);

// 私人礁石到期只改变状态，聊天记录与成员历史继续保存在数据库。
reconcileReefLifecycle(db, { ws: wsServer });
const reefLifecycleTimer = setInterval(() => reconcileReefLifecycle(db, { ws: wsServer }), 60 * 1000);
reefLifecycleTimer.unref();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', type: 'graceful_shutdown_started', signal }));
  clearInterval(dailyTopicTimer);
  clearInterval(reefLifecycleTimer);
  clearInterval(loginThrottleCleanupTimer);
  clearInterval(idempotencyCleanupTimer);
  clearInterval(accountVerificationCleanupTimer);

  const forceExit = setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', type: 'graceful_shutdown_timeout', signal }));
    process.exit(1);
  }, 10000);

  try {
    const httpClosed = new Promise((resolve) => server.close(resolve));
    await Promise.all([httpClosed, wsServer.shutdown()]);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    clearTimeout(forceExit);
    console.log(JSON.stringify({ level: 'info', type: 'graceful_shutdown_completed', signal }));
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExit);
    console.error(JSON.stringify({
      level: 'error',
      type: 'graceful_shutdown_failed',
      signal,
      error: String(error?.message || error).slice(0, 500),
    }));
    process.exit(1);
  }
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
