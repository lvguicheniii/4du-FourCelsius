const crypto = require('crypto');

const DEFAULT_FIXED_VERIFICATION_CODE = '252616';

function usesFixedVerificationCode() {
  return String(
    process.env.ACCOUNT_VERIFICATION_MODE
      || process.env.REGISTRATION_VERIFICATION_MODE
      || (process.env.NODE_ENV === 'production' ? 'sms' : 'fixed'),
  ).trim().toLowerCase() === 'fixed';
}

function fixedVerificationCode() {
  const code = String(
    process.env.ACCOUNT_FIXED_CODE
      || process.env.REGISTRATION_FIXED_CODE
      || DEFAULT_FIXED_VERIFICATION_CODE,
  ).trim();
  if (!/^\d{6}$/.test(code)) {
    const error = new Error('固定验证码配置无效');
    error.code = 'VERIFICATION_CODE_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  return code;
}

function verifyFixedVerificationCode(value) {
  const actual = Buffer.from(String(value || '').trim());
  const expected = Buffer.from(fixedVerificationCode());
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    const error = new Error('验证码错误');
    error.code = 'VERIFICATION_CODE_INVALID';
    error.status = 400;
    throw error;
  }
  return true;
}

module.exports = {
  DEFAULT_FIXED_VERIFICATION_CODE,
  fixedVerificationCode,
  usesFixedVerificationCode,
  verifyFixedVerificationCode,
};
