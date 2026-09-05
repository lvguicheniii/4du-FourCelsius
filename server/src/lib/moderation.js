const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { defaultSigner } = require('./cos-media-signing');

let tmsClient = null;
let imsClient = null;

function enabled() {
  return String(process.env.CONTENT_MODERATION_ENABLED || '').toLowerCase() === 'true';
}

function moderationCredential() {
  const secretId = process.env.TENCENTCLOUD_MODERATION_SECRET_ID || '';
  const secretKey = process.env.TENCENTCLOUD_MODERATION_SECRET_KEY || '';
  if (!secretId || !secretKey) return null;
  return { secretId, secretKey };
}

function configuration() {
  const credentialsConfigured = Boolean(
    process.env.TENCENTCLOUD_MODERATION_SECRET_ID
    && process.env.TENCENTCLOUD_MODERATION_SECRET_KEY,
  );
  const textBizType = String(process.env.TENCENTCLOUD_TMS_BIZ_TYPE || '').trim();
  const imageBizType = String(process.env.TENCENTCLOUD_IMS_BIZ_TYPE || '').trim();
  return {
    enabled: enabled(),
    credentialsConfigured,
    bizTypesConfigured: Boolean(textBizType && imageBizType),
    textBizType: textBizType || null,
    imageBizType: imageBizType || null,
    region: process.env.TENCENTCLOUD_MODERATION_REGION || 'ap-guangzhou',
  };
}

function getClients() {
  if (tmsClient && imsClient) return { tmsClient, imsClient };
  const credential = moderationCredential();
  if (!credential) return { tmsClient: null, imsClient: null };
  const region = process.env.TENCENTCLOUD_MODERATION_REGION || 'ap-guangzhou';
  const profile = { httpProfile: { reqTimeout: 12 } };
  const { tms } = require('tencentcloud-sdk-nodejs-tms/tencentcloud/services');
  const { ims } = require('tencentcloud-sdk-nodejs-ims/tencentcloud/services');
  tmsClient = new tms.v20201229.Client({ credential, region, profile });
  imsClient = new ims.v20201229.Client({ credential, region, profile });
  return { tmsClient, imsClient };
}

function sha(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function mediaUrlsFor(targetType, snapshot) {
  const value = safeJson(snapshot, []);
  if (targetType === 'post') {
    return (Array.isArray(value) ? value : []).flatMap((item) => {
      if (typeof item === 'string') return [item];
      return [item?.stillUrl, item?.imageUrl, item?.url].filter(Boolean);
    });
  }
  if (targetType === 'message' || targetType === 'comment') {
    if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' ? [item] : [item?.stillUrl, item?.url].filter(Boolean));
  }
  return [];
}

function sceneName(unitType) {
  return unitType === 'image'
    ? String(process.env.TENCENTCLOUD_IMS_SCENE_NAME || '切片私信表情包')
    : String(process.env.TENCENTCLOUD_TMS_SCENE_NAME || '切片评论私信');
}

function normalizeDecision(response, unitType, dataId) {
  const suggestion = String(response?.Suggestion || 'Review');
  const label = String(response?.Label || 'Unknown');
  const score = Number(response?.Score || 0);
  return {
    unitType,
    suggestion,
    label,
    subLabel: response?.SubLabel || '',
    score: Number.isFinite(score) ? score : 0,
    dataId: String(response?.DataId || dataId || ''),
    sceneName: sceneName(unitType),
    requestId: String(response?.RequestId || ''),
    result: response || {},
  };
}

async function moderateText(content, dataId) {
  const text = String(content || '').trim();
  if (!text) return null;
  const hash = sha(text);
  const cached = this.db.prepare('SELECT * FROM moderation_result_cache WHERE unit_type=? AND content_hash=?').get('text', hash);
  if (cached) return { ...normalizeDecision(safeJson(cached.result_json, {}), 'text', dataId), cached: true, hash };
  const { tmsClient } = getClients();
  if (!tmsClient) throw new Error('Tencent Cloud moderation credentials are not configured');
  const safeDataId = String(dataId || '').replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 64) || uuid().replace(/-/g, '');
  const response = await tmsClient.TextModeration({
    BizType: process.env.TENCENTCLOUD_TMS_BIZ_TYPE || undefined,
    DataId: safeDataId,
    Content: Buffer.from(text, 'utf8').toString('base64'),
    SourceLanguage: 'zh',
    Type: 'TEXT',
  });
  const decision = normalizeDecision(response, 'text', safeDataId);
  this.db.prepare(`INSERT OR REPLACE INTO moderation_result_cache
    (unit_type,content_hash,suggestion,risk_label,risk_score,result_json,checked_at)
    VALUES (?,?,?,?,?,?,datetime('now','+8 hours'))`)
    .run('text', hash, decision.suggestion, decision.label, decision.score, JSON.stringify(response));
  return { ...decision, hash };
}

async function moderateImage(url, dataId) {
  const canonical = String(url || '').trim();
  if (!canonical) return null;
  const hash = sha(canonical);
  const cached = this.db.prepare('SELECT * FROM moderation_result_cache WHERE unit_type=? AND content_hash=?').get('image', hash);
  if (cached) return { ...normalizeDecision(safeJson(cached.result_json, {}), 'image', dataId), cached: true, hash };
  const { imsClient } = getClients();
  if (!imsClient) throw new Error('Tencent Cloud moderation credentials are not configured');
  const safeDataId = String(dataId || '').replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 64) || uuid().replace(/-/g, '');
  const response = await imsClient.ImageModeration({
    BizType: process.env.TENCENTCLOUD_IMS_BIZ_TYPE || undefined,
    DataId: safeDataId,
    FileUrl: defaultSigner.signUrl(canonical),
    Type: 'IMAGE',
  });
  const decision = normalizeDecision(response, 'image', safeDataId);
  this.db.prepare(`INSERT OR REPLACE INTO moderation_result_cache
    (unit_type,content_hash,suggestion,risk_label,risk_score,result_json,checked_at)
    VALUES (?,?,?,?,?,?,datetime('now','+8 hours'))`)
    .run('image', hash, decision.suggestion, decision.label, decision.score, JSON.stringify(response));
  return { ...decision, hash };
}

function enqueueModeration(db, input) {
  if (!input?.targetType || !input?.targetId || !input?.authorId) return null;
  const content = String(input.contentSnapshot || '').slice(0, 10000);
  const media = Array.isArray(input.mediaSnapshot) ? input.mediaSnapshot.filter(Boolean).slice(0, 12) : [];
  const context = Array.isArray(input.contextSnapshot) ? input.contextSnapshot.slice(-50) : [];
  const contentHash = sha(`${input.targetType}\n${input.targetId}\n${content}\n${JSON.stringify(media)}`);
  const existing = db.prepare('SELECT id FROM moderation_tasks WHERE target_type=? AND target_id=?').get(input.targetType, input.targetId);
  if (existing) return existing.id;
  const id = `mod_${uuid()}`;
  db.prepare(`INSERT INTO moderation_tasks
    (id,target_type,target_id,author_id,related_user_id,content_snapshot,media_snapshot,context_snapshot,content_hash)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, input.targetType, input.targetId, input.authorId, input.relatedUserId || null, content, JSON.stringify(media), JSON.stringify(context), contentHash);
  return id;
}

async function processTask(db, task) {
  const runner = { db };
  const units = [];
  const textKinds = new Set(['post', 'comment']);
  if (textKinds.has(task.target_type) || (task.target_type === 'message' && task.content_snapshot)) {
    const decision = await moderateText.call(runner, task.content_snapshot, task.id);
    if (decision) units.push(decision);
  }
  for (const [index, url] of mediaUrlsFor(task.target_type, task.media_snapshot).entries()) {
    const decision = await moderateImage.call(runner, url, `${task.id}_${index}`);
    if (decision) units.push(decision);
  }
  const risky = units.filter((unit) => unit.suggestion !== 'Pass' || unit.label !== 'Normal');
  const riskScore = units.reduce((max, unit) => Math.max(max, Number(unit.score) || 0), 0);
  const riskLabel = risky.map((unit) => unit.subLabel || unit.label).filter(Boolean).join(', ') || 'Normal';
  const nextStatus = risky.length ? 'needs_review' : 'passed';
  db.prepare(`UPDATE moderation_tasks SET status=?,admin_status=?,risk_label=?,risk_score=?,provider_result_json=?,checked_at=datetime('now','+8 hours'),updated_at=datetime('now','+8 hours'),last_error='' WHERE id=?`)
    .run(nextStatus, risky.length ? 'pending' : 'normal', riskLabel, riskScore, JSON.stringify(units), task.id);
  return { status: nextStatus, units };
}

function createWorker(db, options = {}) {
  const intervalMs = Math.max(5000, Number(options.intervalMs || process.env.CONTENT_MODERATION_INTERVAL_MS || 10000));
  const batchSize = Math.max(1, Math.min(10, Number(options.batchSize || 2)));
  let busy = false;
  const state = {
    startedAt: new Date().toISOString(),
    lastTickAt: null,
    lastSuccessAt: null,
    lastError: null,
    processed: 0,
    failed: 0,
  };
  async function tick() {
    if (busy || !enabled()) return;
    busy = true;
    state.lastTickAt = new Date().toISOString();
    try {
      db.prepare("UPDATE moderation_tasks SET status='queued',updated_at=datetime('now','+8 hours') WHERE status='processing' AND updated_at < datetime('now','+8 hours','-15 minutes')").run();
      const tasks = db.prepare("SELECT * FROM moderation_tasks WHERE status='queued' AND next_attempt_at <= datetime('now','+8 hours') ORDER BY created_at LIMIT ?").all(batchSize);
      for (const task of tasks) {
        const claimed = db.prepare("UPDATE moderation_tasks SET status='processing',updated_at=datetime('now','+8 hours') WHERE id=? AND status='queued'").run(task.id);
        if (!claimed.changes) continue;
        try {
          await processTask(db, task);
          state.processed += 1;
          state.lastSuccessAt = new Date().toISOString();
          state.lastError = null;
        }
        catch (error) {
          state.failed += 1;
          state.lastError = String(error?.message || error).slice(0, 300);
          const retry = Number(task.retry_count || 0) + 1;
          const terminal = retry >= 5;
          db.prepare(`UPDATE moderation_tasks SET status=?,retry_count=?,last_error=?,next_attempt_at=datetime('now','+8 hours',?),updated_at=datetime('now','+8 hours') WHERE id=?`)
            .run(terminal ? 'failed' : 'queued', retry, String(error?.message || error).slice(0, 1000), `+${Math.min(60, 2 ** retry)} minutes`, task.id);
          console.error('Moderation task failed:', task.id, error?.message || error);
        }
      }
    } finally { busy = false; }
  }
  const timer = setInterval(() => { tick().catch((error) => console.error('Moderation worker tick failed:', error)); }, intervalMs);
  timer.unref();
  return {
    tick,
    stop: () => clearInterval(timer),
    getStatus: () => ({ ...configuration(), ...state, busy }),
  };
}

module.exports = { enabled, configuration, enqueueModeration, processTask, createWorker, sha, mediaUrlsFor };
