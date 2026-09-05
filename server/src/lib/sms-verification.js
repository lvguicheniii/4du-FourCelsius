const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { sms } = require('tencentcloud-sdk-nodejs-sms/tencentcloud/services');
const db = require('../db');
const { JWT_SECRET } = require('./security-config');

const SmsClient = sms.v20210111.Client;
const CODE_TTL_MS = 5 * 60 * 1000;
const SEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const PURPOSES = new Set(['register', 'password_change', 'password_reset']);
const verificationKey = crypto.createHmac('sha256', JWT_SECRET).update('sidu-sms-verification-v1').digest();

function serviceError(message, code, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizePhone(value) {
  const phone = String(value || '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) throw serviceError('手机号格式错误', 'PHONE_INVALID', 400);
  return phone;
}

function normalizePurpose(value) {
  const purpose = String(value || '').trim();
  if (!PURPOSES.has(purpose)) throw serviceError('短信验证码用途无效', 'SMS_PURPOSE_INVALID', 400);
  return purpose;
}

function hmac(value) {
  return crypto.createHmac('sha256', verificationKey).update(String(value)).digest('hex');
}

function phoneSubject(value) {
  return hmac(`phone:${normalizePhone(value)}`);
}

function verificationCodeHash(id, code) {
  return hmac(`code:${id}:${code}`);
}

function smsConfig() {
  return {
    secretId: String(process.env.TENCENTCLOUD_SMS_SECRET_ID || '').trim(),
    secretKey: String(process.env.TENCENTCLOUD_SMS_SECRET_KEY || '').trim(),
    region: String(process.env.TENCENTCLOUD_SMS_REGION || 'ap-guangzhou').trim(),
    sdkAppId: String(process.env.TENCENTCLOUD_SMS_SDK_APP_ID || '').trim(),
    signName: String(process.env.TENCENTCLOUD_SMS_SIGN_NAME || '').trim(),
    registerTemplateId: String(process.env.TENCENTCLOUD_SMS_REGISTER_TEMPLATE_ID || '').trim(),
    passwordTemplateId: String(process.env.TENCENTCLOUD_SMS_PASSWORD_TEMPLATE_ID || '').trim(),
  };
}

function requireSmsConfig(purpose) {
  const config = smsConfig();
  const templateId = purpose === 'register' ? config.registerTemplateId : config.passwordTemplateId;
  if (!config.secretId || !config.secretKey || !config.sdkAppId || !config.signName || !templateId) {
    throw serviceError('短信服务暂未完成配置', 'SMS_NOT_CONFIGURED');
  }
  return { ...config, templateId };
}

function templateParams(purpose, code) {
  const key = purpose === 'register'
    ? 'TENCENTCLOUD_SMS_REGISTER_TEMPLATE_PARAMS'
    : 'TENCENTCLOUD_SMS_PASSWORD_TEMPLATE_PARAMS';
  const tokens = String(process.env[key] || 'code,minutes')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const values = { code, minutes: String(Math.ceil(CODE_TTL_MS / 60000)) };
  if (tokens.some(token => !Object.prototype.hasOwnProperty.call(values, token))) {
    throw serviceError('短信模板参数配置无效', 'SMS_TEMPLATE_PARAMS_INVALID');
  }
  return tokens.map(token => values[token]);
}

const reserveCode = db.transaction((phoneHash, purpose, now) => {
  const latest = db.prepare(`
    SELECT created_at_ms FROM sms_verification_codes
    WHERE phone_hash=? AND purpose=?
    ORDER BY created_at_ms DESC LIMIT 1
  `).get(phoneHash, purpose);
  if (latest && now - Number(latest.created_at_ms) < SEND_COOLDOWN_MS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((SEND_COOLDOWN_MS - (now - Number(latest.created_at_ms))) / 1000));
    const error = serviceError(`请在 ${retryAfterSeconds} 秒后重试`, 'SMS_COOLDOWN', 429);
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
  const id = uuid();
  db.prepare(`
    INSERT INTO sms_verification_codes(id,phone_hash,purpose,status,created_at_ms,expires_at_ms)
    VALUES (?,?,?,'sending',?,?)
  `).run(id, phoneHash, purpose, now, now + CODE_TTL_MS);
  return id;
});

async function sendWithTencentCloud({ phone, purpose, code }) {
  const config = requireSmsConfig(purpose);
  const client = new SmsClient({
    credential: { secretId: config.secretId, secretKey: config.secretKey },
    region: config.region,
    profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com', reqTimeout: 8 } },
  });
  const response = await client.SendSms({
    SmsSdkAppId: config.sdkAppId,
    SignName: config.signName,
    TemplateId: config.templateId,
    TemplateParamSet: templateParams(purpose, code),
    PhoneNumberSet: [`+86${phone}`],
  });
  const status = response?.SendStatusSet?.[0];
  if (!status || status.Code !== 'Ok') {
    const error = serviceError('短信暂时发送失败，请稍后重试', 'SMS_PROVIDER_REJECTED');
    error.providerCode = String(status?.Code || 'EMPTY_RESPONSE').slice(0, 100);
    throw error;
  }
}

async function sendVerificationCode({ phone: phoneValue, purpose: purposeValue }) {
  const phone = normalizePhone(phoneValue);
  const purpose = normalizePurpose(purposeValue);
  requireSmsConfig(purpose);
  const phoneHash = phoneSubject(phone);
  const now = Date.now();
  const id = reserveCode(phoneHash, purpose, now);
  const code = String(crypto.randomInt(100000, 1000000));
  try {
    await sendWithTencentCloud({ phone, purpose, code });
    db.transaction(() => {
      db.prepare(`
        UPDATE sms_verification_codes SET status='superseded'
        WHERE phone_hash=? AND purpose=? AND status='active'
      `).run(phoneHash, purpose);
      db.prepare("UPDATE sms_verification_codes SET status='active',code_hash=? WHERE id=? AND status='sending'")
        .run(verificationCodeHash(id, code), id);
    })();
    return { ok: true, cooldownSeconds: SEND_COOLDOWN_MS / 1000, expiresInSeconds: CODE_TTL_MS / 1000 };
  } catch (error) {
    db.prepare("DELETE FROM sms_verification_codes WHERE id=? AND status='sending'").run(id);
    console.error(JSON.stringify({
      level: 'error',
      type: 'sms_send_failed',
      purpose,
      code: String(error?.providerCode || error?.code || 'SDK_ERROR').slice(0, 100),
    }));
    if (error?.code) throw error;
    throw serviceError('短信服务暂时不可用，请稍后重试', 'SMS_PROVIDER_UNAVAILABLE');
  }
}

const consumeVerificationCode = db.transaction((phoneHash, purpose, code, now) => {
  const row = db.prepare(`
    SELECT id,code_hash,attempts,expires_at_ms
    FROM sms_verification_codes
    WHERE phone_hash=? AND purpose=? AND status='active'
    ORDER BY created_at_ms DESC LIMIT 1
  `).get(phoneHash, purpose);
  if (!row || Number(row.expires_at_ms) <= now || !row.code_hash) {
    throw serviceError('短信验证码无效或已过期', 'SMS_CODE_INVALID', 400);
  }
  const actual = Buffer.from(verificationCodeHash(row.id, code), 'hex');
  const expected = Buffer.from(row.code_hash, 'hex');
  const correct = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  if (!correct) {
    const attempts = Number(row.attempts) + 1;
    db.prepare(`
      UPDATE sms_verification_codes
      SET attempts=?,status=CASE WHEN ? >= ? THEN 'consumed' ELSE status END,
          consumed_at_ms=CASE WHEN ? >= ? THEN ? ELSE consumed_at_ms END
      WHERE id=?
    `).run(attempts, attempts, MAX_ATTEMPTS, attempts, MAX_ATTEMPTS, now, row.id);
    throw serviceError('短信验证码错误', 'SMS_CODE_INVALID', 400);
  }
  const changed = db.prepare(`
    UPDATE sms_verification_codes SET status='consumed',consumed_at_ms=?
    WHERE id=? AND status='active'
  `).run(now, row.id).changes;
  if (!changed) throw serviceError('短信验证码已使用', 'SMS_CODE_USED', 400);
  return true;
});

function verifyAndConsumeCode({ phone: phoneValue, purpose: purposeValue, code: codeValue }) {
  const phone = normalizePhone(phoneValue);
  const purpose = normalizePurpose(purposeValue);
  const code = String(codeValue || '').trim();
  if (!/^\d{6}$/.test(code)) throw serviceError('请输入 6 位短信验证码', 'SMS_CODE_INVALID', 400);
  return consumeVerificationCode(phoneSubject(phone), purpose, code, Date.now());
}

function pruneSmsVerificationCodes(now = Date.now()) {
  return db.prepare('DELETE FROM sms_verification_codes WHERE expires_at_ms < ?').run(now - 24 * 60 * 60 * 1000).changes;
}

module.exports = {
  CODE_TTL_MS,
  SEND_COOLDOWN_MS,
  normalizePhone,
  phoneSubject,
  pruneSmsVerificationCodes,
  sendVerificationCode,
  templateParams,
  verifyAndConsumeCode,
};
