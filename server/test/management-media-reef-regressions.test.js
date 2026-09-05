const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('admin message snapshots render image, video, live photo and context records', () => {
  const admin = read('server/src/public/admin/index.html');
  assert.match(admin, /kind==='live_photo'/);
  assert.match(admin, /kind==='video'/);
  assert.match(admin, /kind==='post_context'\|\|kind==='comment_context'/);
  assert.match(admin, /实况照片数据无法解析/);
});

test('destroyed reef cards remain resolvable without exposing an overview countdown', () => {
  const reef = read('server/src/routes/reef.js');
  const card = read('community-app/src/components/reef-share-card.tsx');
  const room = read('community-app/src/app/reef/[id].tsx');
  assert.match(reef, /rooms\/:id\/card/);
  assert.match(reef, /room\.status === 'destroyed'.*status\(410\)/s);
  assert.match(card, /该礁石已被摧毁/);
  assert.doesNotMatch(room, /聊天已结束，历史内容仍由系统永久保存/);
  assert.match(room, /!destroyed \? <Pressable/);
});

test('management roles and app moderation are enforced on the server', () => {
  const admin = read('server/src/routes/admin/api.js');
  const appModeration = read('server/src/routes/app-moderation.js');
  const auth = read('server/src/middleware/auth.js');
  assert.match(admin, /后台审核员只能访问内容审核功能/);
  assert.match(admin, /'reviewer'/);
  assert.match(appModeration, /req\.user\?\.role !== 'app_admin'/);
  assert.match(appModeration, /idempotent\('app-moderation\.post-action'\)/);
  assert.match(appModeration, /db\.transaction\(\(\) =>/);
  assert.match(appModeration, /WHERE id=\? AND status='active'/);
  assert.match(appModeration, /\['delete', 'mute', 'ban'\]/);
  assert.match(auth, /nickname, role, status, ban_until/);
  assert.match(auth, /role: user\.role/);
});

test('refrigerant daily use and admin penalties are transactionally guarded', () => {
  const refrigerant = read('server/src/routes/refrigerant.js');
  const admin = read('server/src/routes/admin/api.js');
  assert.match(refrigerant, /dailyUse\.changes !== 1/);
  assert.match(refrigerant, /INSERT OR IGNORE INTO post_refrigerant_daily_uses/);
  assert.match(admin, /function deletePostByAdmin[\s\S]*?return db\.transaction/);
  assert.match(admin, /function deleteCommentByAdmin[\s\S]*?return db\.transaction/);
  assert.match(admin, /function applyAdminMute[\s\S]*?return db\.transaction/);
  assert.match(admin, /function applyAdminBan[\s\S]*?return db\.transaction/);
});
