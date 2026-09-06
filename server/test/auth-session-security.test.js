const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authRoutes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');
const dbBootstrap = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'index.js'), 'utf8');
const migrations = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations.js'), 'utf8');
const captchaService = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'tencent-captcha.js'), 'utf8');
const smsService = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'sms-verification.js'), 'utf8');

test('sensitive account changes rotate the user token version', () => {
  assert.match(authRoutes, /password_hash = \?, token_version = \?/);
  assert.match(authRoutes, /phone = \?, username = \?, token_version = \?/);
  assert.match(authRoutes, /token: createUserToken\(req\.userId, newVersion\)/);
});

test('security answers are stored hashed at registration', () => {
  assert.match(authRoutes, /hashSecurityAnswer\(security_answer\)/);
  assert.doesNotMatch(authRoutes, /bcrypt\.(?:compareSync|hashSync)/);
});

test('sensitive account changes retain current-password checks in fixed-code mode', () => {
  assert.match(authRoutes, /const \{ password, current_password, verify_code \} = req\.body/);
  assert.match(authRoutes, /const \{ phone, current_password \} = req\.body/);
  assert.match(authRoutes, /await comparePassword\(current_password, user\.password_hash\)/);
  assert.match(authRoutes, /usesFixedVerificationCode\(\)\) verifyFixedVerificationCode\(verify_code\)/);
  assert.match(authRoutes, /else verifyAndConsumeCode\(\{ phone: user\.phone, purpose: 'password_change', code: verify_code \}\)/);
  assert.doesNotMatch(authRoutes, /252616/);
  assert.doesNotMatch(smsService, /['"]000000['"]/);
});

test('anonymous password recovery uses the fixed code while avoiding account enumeration when requesting it', () => {
  assert.match(authRoutes, /purpose === 'password_reset'/);
  assert.match(authRoutes, /usesFixedVerificationCode\(\)\) verifyFixedVerificationCode\(verifyCode\)/);
  assert.match(authRoutes, /return res\.json\(\{ ok: true, mode: 'fixed', fixedCode: fixedVerificationCode\(\) \}\)/);
  assert.match(authRoutes, /验证码无效/);
});

test('SMS delivery is gated by server-side Tencent captcha verification', () => {
  const verifyPosition = authRoutes.indexOf('await verifyCaptchaProof({');
  const sendPosition = authRoutes.indexOf('await sendVerificationCode({ phone, purpose })');
  assert.ok(verifyPosition >= 0 && sendPosition > verifyPosition);
  assert.match(captchaService, /DescribeCaptchaResult/);
  assert.match(captchaService, /Number\(response\?\.CaptchaCode\) !== 1/);
  assert.match(captchaService, /normalizedTicket\.startsWith\('trerror_'\)/);
  assert.match(smsService, /crypto\.timingSafeEqual/);
  assert.match(smsService, /verificationCodeHash/);
});

test('database startup never installs a shared security answer', () => {
  assert.doesNotMatch(dbBootstrap, /hashSync\('123456'/);
  assert.doesNotMatch(dbBootstrap, /privateMarkers/);
  assert.match(migrations, /073_remove_known_default_security_answers/);
  assert.match(migrations, /bcrypt\.compareSync\('123456', stored\)/);
});
