const test = require('node:test');
const assert = require('node:assert/strict');
const { PENALTY_REASONS, isValidPenaltyReason } = require('../src/lib/penalty-reasons');

test('all administrator punishments share the same reason presets', () => {
  assert.deepEqual(PENALTY_REASONS, [
    '色情、淫秽或低俗内容',
    '谩骂、人身攻击或网络暴力',
    '违法违规或涉政内容',
    '广告、营销或恶意引流',
    '恶意引战或不实信息',
    '其他',
  ]);
});

test('other punishment reasons require a concrete explanation', () => {
  assert.equal(isValidPenaltyReason('其他'), false);
  assert.equal(isValidPenaltyReason('其他：需要人工说明的具体问题'), true);
  assert.equal(isValidPenaltyReason('色情、淫秽或低俗内容'), true);
  assert.equal(isValidPenaltyReason('违规操作'), false);
});
