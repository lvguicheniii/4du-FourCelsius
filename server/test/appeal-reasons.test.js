const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  APPEAL_REJECTION_REASONS,
  buildAppealRejectionNote,
} = require('../src/lib/appeal-reasons');

test('appeal rejection uses fixed administrator choices and requires details for other', () => {
  assert.deepEqual(APPEAL_REJECTION_REASONS, [
    '现有证据足以认定违规',
    '申诉理由与案件事实不符',
    '未提供足以推翻原处罚的新证据',
    '账号存在重复或多次违规记录',
    '原处罚流程及尺度符合社区规范',
    '其他',
  ]);
  assert.equal(buildAppealRejectionNote('现有证据足以认定违规', ''), '现有证据足以认定违规');
  assert.equal(buildAppealRejectionNote('其他', ''), '');
  assert.equal(buildAppealRejectionNote('其他', '多次提交相同虚假材料'), '其他：多次提交相同虚假材料');
  assert.equal(buildAppealRejectionNote('任意手写理由', '说明'), '');
});

test('appeal cards include UID-linked reports and confirmed violation history', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/admin/api.js'), 'utf8');
  assert.match(source, /loadAppealCaseHistory\(appeal\.user_id\)/);
  assert.match(source, /recent_reports: recentReports/);
  assert.match(source, /violation_cases: violations/);
  assert.match(source, /mt\.admin_status = 'violation'/);
});
