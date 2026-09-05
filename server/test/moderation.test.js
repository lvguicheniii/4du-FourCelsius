const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { enqueueModeration, processTask, sha, mediaUrlsFor, configuration, createWorker } = require('../src/lib/moderation');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE moderation_tasks (
      id TEXT PRIMARY KEY,target_type TEXT,target_id TEXT,author_id TEXT,related_user_id TEXT,
      content_snapshot TEXT DEFAULT '',media_snapshot TEXT DEFAULT '[]',context_snapshot TEXT DEFAULT '[]',content_hash TEXT,
      status TEXT DEFAULT 'queued',provider TEXT DEFAULT 'tencent_cloud',risk_label TEXT DEFAULT '',
      risk_score INTEGER DEFAULT 0,provider_result_json TEXT DEFAULT '[]',retry_count INTEGER DEFAULT 0,
      last_error TEXT DEFAULT '',next_attempt_at TEXT DEFAULT (datetime('now','+8 hours')),checked_at TEXT,
      admin_status TEXT DEFAULT 'pending',handled_by TEXT,handled_at TEXT,handle_action TEXT DEFAULT '',
      handle_note TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','+8 hours')),
      updated_at TEXT DEFAULT (datetime('now','+8 hours')),light_violation INTEGER DEFAULT 0,
      light_note TEXT DEFAULT '',light_marked_by TEXT,light_marked_at TEXT,UNIQUE(target_type,target_id)
    );
    CREATE TABLE moderation_result_cache (
      unit_type TEXT,content_hash TEXT,suggestion TEXT,risk_label TEXT,risk_score INTEGER,
      result_json TEXT,checked_at TEXT DEFAULT (datetime('now','+8 hours')),PRIMARY KEY(unit_type,content_hash)
    );
  `);
  return db;
}

test('moderation queue keeps an immutable publication snapshot and is idempotent', () => {
  const db = createDb();
  const input = { targetType: 'message', targetId: 'm1', authorId: 'a', relatedUserId: 'b', contentSnapshot: 'snapshot', mediaSnapshot: [], contextSnapshot: [{ id: 'm0', content: 'earlier' }] };
  const first = enqueueModeration(db, input);
  const second = enqueueModeration(db, { ...input, contentSnapshot: 'changed later' });
  assert.equal(second, first);
  assert.deepEqual(db.prepare('SELECT author_id,related_user_id,content_snapshot,status FROM moderation_tasks').get(), {
    author_id: 'a', related_user_id: 'b', content_snapshot: 'snapshot', status: 'queued',
  });
  assert.deepEqual(JSON.parse(db.prepare('SELECT context_snapshot FROM moderation_tasks').get().context_snapshot), [{ id: 'm0', content: 'earlier' }]);
  db.close();
});

test('cached Tencent review result enters human review without blocking content', async () => {
  const db = createDb();
  const text = 'review this text';
  const id = enqueueModeration(db, { targetType: 'comment', targetId: 'c1', authorId: 'a', contentSnapshot: text, mediaSnapshot: [] });
  const providerResult = { Suggestion: 'Review', Label: 'Abuse', SubLabel: 'Insult', Score: 87, RequestId: 'request-1' };
  db.prepare('INSERT INTO moderation_result_cache(unit_type,content_hash,suggestion,risk_label,risk_score,result_json) VALUES (?,?,?,?,?,?)')
    .run('text', sha(text), 'Review', 'Abuse', 87, JSON.stringify(providerResult));
  const task = db.prepare('SELECT * FROM moderation_tasks WHERE id=?').get(id);
  const result = await processTask(db, task);
  assert.equal(result.status, 'needs_review');
  assert.deepEqual(db.prepare('SELECT status,admin_status,risk_label,risk_score FROM moderation_tasks WHERE id=?').get(id), {
    status: 'needs_review', admin_status: 'pending', risk_label: 'Insult', risk_score: 87,
  });
  db.close();
});

test('cached Tencent pass result closes automatically and media snapshots are normalized', async () => {
  const db = createDb();
  const text = 'normal text';
  const id = enqueueModeration(db, { targetType: 'post', targetId: 'p1', authorId: 'a', contentSnapshot: text, mediaSnapshot: [] });
  const providerResult = { Suggestion: 'Pass', Label: 'Normal', Score: 0, RequestId: 'request-2' };
  db.prepare('INSERT INTO moderation_result_cache(unit_type,content_hash,suggestion,risk_label,risk_score,result_json) VALUES (?,?,?,?,?,?)')
    .run('text', sha(text), 'Pass', 'Normal', 0, JSON.stringify(providerResult));
  await processTask(db, db.prepare('SELECT * FROM moderation_tasks WHERE id=?').get(id));
  assert.deepEqual(db.prepare('SELECT status,admin_status FROM moderation_tasks WHERE id=?').get(id), { status: 'passed', admin_status: 'normal' });
  assert.deepEqual(mediaUrlsFor('post', JSON.stringify(['one.jpg', { stillUrl: 'two.jpg' }])), ['one.jpg', 'two.jpg']);
  assert.deepEqual(mediaUrlsFor('comment', JSON.stringify(['sticker.gif'])), ['sticker.gif']);
  db.close();
});

test('moderation configuration exposes readiness without exposing credentials', () => {
  const previous = {
    enabled: process.env.CONTENT_MODERATION_ENABLED,
    secretId: process.env.TENCENTCLOUD_MODERATION_SECRET_ID,
    secretKey: process.env.TENCENTCLOUD_MODERATION_SECRET_KEY,
    textBiz: process.env.TENCENTCLOUD_TMS_BIZ_TYPE,
    imageBiz: process.env.TENCENTCLOUD_IMS_BIZ_TYPE,
  };
  process.env.CONTENT_MODERATION_ENABLED = 'true';
  process.env.TENCENTCLOUD_MODERATION_SECRET_ID = 'secret-id';
  process.env.TENCENTCLOUD_MODERATION_SECRET_KEY = 'secret-key';
  process.env.TENCENTCLOUD_TMS_BIZ_TYPE = 'sidu_text_v1';
  process.env.TENCENTCLOUD_IMS_BIZ_TYPE = 'sidu_image_v1';
  const status = configuration();
  assert.deepEqual(status, {
    enabled: true,
    credentialsConfigured: true,
    bizTypesConfigured: true,
    textBizType: 'sidu_text_v1',
    imageBizType: 'sidu_image_v1',
    region: 'ap-guangzhou',
  });
  assert.equal('secretId' in status, false);
  assert.equal('secretKey' in status, false);
  Object.entries(previous).forEach(([key, value]) => {
    const envKey = { enabled: 'CONTENT_MODERATION_ENABLED', secretId: 'TENCENTCLOUD_MODERATION_SECRET_ID', secretKey: 'TENCENTCLOUD_MODERATION_SECRET_KEY', textBiz: 'TENCENTCLOUD_TMS_BIZ_TYPE', imageBiz: 'TENCENTCLOUD_IMS_BIZ_TYPE' }[key];
    if (value === undefined) delete process.env[envKey];
    else process.env[envKey] = value;
  });
});

test('moderation worker reports readiness and runtime counters', () => {
  const previous = process.env.CONTENT_MODERATION_ENABLED;
  process.env.CONTENT_MODERATION_ENABLED = 'false';
  const db = createDb();
  const worker = createWorker(db, { intervalMs: 60000 });
  const status = worker.getStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.processed, 0);
  assert.equal(status.failed, 0);
  assert.equal(typeof status.startedAt, 'string');
  worker.stop();
  db.close();
  if (previous === undefined) delete process.env.CONTENT_MODERATION_ENABLED;
  else process.env.CONTENT_MODERATION_ENABLED = previous;
});
