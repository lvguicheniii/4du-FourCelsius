const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const captchaService = read('src/lib/tencent-captcha.js');
const smsService = read('src/lib/sms-verification.js');
const appCaptcha = read('../community-app/src/lib/tencent-captcha.ts');
const envExample = read('.env.example');

test('Tencent credentials remain server-side and are represented only by placeholders', () => {
  assert.match(envExample, /TENCENTCLOUD_CAPTCHA_SECRET_KEY=\s*$/m);
  assert.match(envExample, /TENCENTCLOUD_SMS_SECRET_KEY=\s*$/m);
  assert.doesNotMatch(appCaptcha, /SECRET_(?:ID|KEY)|APP_SECRET/i);
});

test('captcha tickets fail closed and are verified exactly once on the server', () => {
  assert.match(captchaService, /normalizedTicket\.startsWith\('trerror_'\)/);
  assert.match(captchaService, /DescribeCaptchaResult/);
  assert.match(captchaService, /status='verifying'/);
  assert.match(captchaService, /status='used'/);
});

test('SMS codes are random, hashed, purpose-bound, expiring, and attempt-limited', () => {
  assert.match(smsService, /crypto\.randomInt\(100000, 1000000\)/);
  assert.match(smsService, /verificationCodeHash\(id, code\)/);
  assert.match(smsService, /CODE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(smsService, /MAX_ATTEMPTS = 5/);
  assert.match(smsService, /phone_hash=\? AND purpose=\? AND status='active'/);
  assert.doesNotMatch(smsService, /252616/);
});
