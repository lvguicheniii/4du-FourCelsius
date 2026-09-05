const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('public reef applications have storage, authenticated submission, and admin visibility', () => {
  const migrations = read('src/db/migrations.js');
  const reef = read('src/routes/reef.js');
  const admin = read('src/routes/admin/append2.js');
  const adminPage = read('src/public/admin/index.html');
  const app = read('../community-app/src/app/(tabs)/qianliu.tsx');
  const web = read('../community-web/src/screens.tsx');

  assert.match(migrations, /CREATE TABLE IF NOT EXISTS public_reef_applications/);
  assert.match(reef, /router\.post\('\/public-applications', auth/);
  assert.match(reef, /reason\.length > 200/);
  assert.match(admin, /router\.get\('\/public-reef-applications', adminAuth/);
  assert.match(admin, /u\.nickname,u\.username,u\.avatar,u\.gender/);
  assert.match(admin, /const limit = 20/);
  assert.match(admin, /totalPages: Math\.max\(1, Math\.ceil\(total \/ limit\)\)/);
  assert.match(admin, /public_reef_application_reviewed/);
  assert.match(admin, /您提交的【\$\{application\.reef_name\}】公海礁石申请，已被肆度官方管理团队查看。/);
  assert.match(adminPage, /收到的新增公海礁石申请/);
  assert.match(adminPage, /publicReefApplications:LPRA/);
  assert.match(adminPage, /礁石申请名称：/);
  assert.match(adminPage, /申请理由：/);
  assert.match(app, /新增公海礁石申请/);
  assert.match(app, /maxLength=\{200\}/);
  assert.match(web, /申请新公海礁石/);
  assert.match(web, /submitPublicReefApplication/);
});
