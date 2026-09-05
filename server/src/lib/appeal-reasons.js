const APPEAL_REJECTION_REASONS = Object.freeze([
  '现有证据足以认定违规',
  '申诉理由与案件事实不符',
  '未提供足以推翻原处罚的新证据',
  '账号存在重复或多次违规记录',
  '原处罚流程及尺度符合社区规范',
  '其他',
]);

function normalizeAppealRejectionReason(value) {
  return String(value || '').trim().slice(0, 1000);
}

function buildAppealRejectionNote(reasonValue, detailValue) {
  const reason = normalizeAppealRejectionReason(reasonValue);
  const detail = normalizeAppealRejectionReason(detailValue);
  if (!APPEAL_REJECTION_REASONS.includes(reason)) return '';
  if (reason === '其他' && !detail) return '';
  return detail ? `${reason}：${detail}` : reason;
}

module.exports = {
  APPEAL_REJECTION_REASONS,
  normalizeAppealRejectionReason,
  buildAppealRejectionNote,
};
