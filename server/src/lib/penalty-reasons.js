const PENALTY_REASONS = Object.freeze([
  '色情、淫秽或低俗内容',
  '谩骂、人身攻击或网络暴力',
  '违法违规或涉政内容',
  '广告、营销或恶意引流',
  '恶意引战或不实信息',
  '其他',
]);

function normalizePenaltyReason(value) {
  return String(value || '').trim().slice(0, 1000);
}

function isValidPenaltyReason(value) {
  const reason = normalizePenaltyReason(value);
  if (!reason || reason === '其他') return false;
  return PENALTY_REASONS.some((preset) => (
    preset !== '其他' && (reason === preset || reason.startsWith(`${preset}：`))
  )) || reason.startsWith('其他：');
}

module.exports = { PENALTY_REASONS, normalizePenaltyReason, isValidPenaltyReason };
