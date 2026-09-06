const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const verification = require('../src/lib/registration-verification');
const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');
const appLoginSource = fs.readFileSync(path.join(__dirname, '..', '..', 'community-app', 'src', 'app', 'login.tsx'), 'utf8');
const appAccountSource = fs.readFileSync(path.join(__dirname, '..', '..', 'community-app', 'src', 'app', 'account.tsx'), 'utf8');
const webUiSource = fs.readFileSync(path.join(__dirname, '..', '..', 'community-web', 'src', 'ui.tsx'), 'utf8');
const webScreensSource = fs.readFileSync(path.join(__dirname, '..', '..', 'community-web', 'src', 'screens.tsx'), 'utf8');
const webVerificationSource = fs.readFileSync(path.join(__dirname, '..', '..', 'community-web', 'src', 'verification-code.ts'), 'utf8');
const appConfigSource = fs.readFileSync(path.join(__dirname, '..', '..', 'community-app', 'app.config.js'), 'utf8');
const appClientSource = fs.readFileSync(path.join(__dirname, '..', '..', 'community-app', 'src', 'api', 'client.ts'), 'utf8');

function withVerificationEnvironment(values, callback) {
  const previous = {
    mode: process.env.ACCOUNT_VERIFICATION_MODE,
    code: process.env.ACCOUNT_FIXED_CODE,
    legacyMode: process.env.REGISTRATION_VERIFICATION_MODE,
    legacyCode: process.env.REGISTRATION_FIXED_CODE,
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    return callback();
  } finally {
    if (previous.mode === undefined) delete process.env.ACCOUNT_VERIFICATION_MODE;
    else process.env.ACCOUNT_VERIFICATION_MODE = previous.mode;
    if (previous.code === undefined) delete process.env.ACCOUNT_FIXED_CODE;
    else process.env.ACCOUNT_FIXED_CODE = previous.code;
    if (previous.legacyMode === undefined) delete process.env.REGISTRATION_VERIFICATION_MODE;
    else process.env.REGISTRATION_VERIFICATION_MODE = previous.legacyMode;
    if (previous.legacyCode === undefined) delete process.env.REGISTRATION_FIXED_CODE;
    else process.env.REGISTRATION_FIXED_CODE = previous.legacyCode;
  }
}

test('local account verification defaults to the fixed 252616 code', () => {
  withVerificationEnvironment({
    ACCOUNT_VERIFICATION_MODE: undefined,
    ACCOUNT_FIXED_CODE: undefined,
    REGISTRATION_VERIFICATION_MODE: undefined,
    REGISTRATION_FIXED_CODE: undefined,
  }, () => {
    assert.equal(verification.usesFixedVerificationCode(), true);
    assert.equal(verification.fixedVerificationCode(), '252616');
    assert.equal(verification.verifyFixedVerificationCode('252616'), true);
    assert.throws(
      () => verification.verifyFixedVerificationCode('000001'),
      error => error?.code === 'VERIFICATION_CODE_INVALID' && error?.status === 400,
    );
  });
});

test('fixed account verification can be switched back to Tencent SMS explicitly', () => {
  withVerificationEnvironment({ ACCOUNT_VERIFICATION_MODE: 'sms' }, () => {
    assert.equal(verification.usesFixedVerificationCode(), false);
  });
});

test('registration, password reset and password change all bypass Tencent in fixed mode', () => {
  assert.match(authSource, /if \(usesFixedVerificationCode\(\)\) \{[\s\S]*return sendCodePhoneLimit/);
  assert.match(authSource, /if \(usesFixedVerificationCode\(\)\) verifyFixedVerificationCode\(code\);/);
  assert.match(authSource, /if \(usesFixedVerificationCode\(\)\) verifyFixedVerificationCode\(verifyCode\);/);
  assert.match(authSource, /if \(usesFixedVerificationCode\(\)\) verifyFixedVerificationCode\(verify_code\);/);
  assert.doesNotMatch(appLoginSource, /runTencentCaptcha/);
  assert.doesNotMatch(appAccountSource, /runTencentCaptcha/);
  assert.doesNotMatch(webUiSource, /runTencentCaptcha/);
  assert.doesNotMatch(webScreensSource, /runTencentCaptcha/);
  assert.match(webVerificationSource, /VITE_FIXED_VERIFICATION_CODE \|\| "252616"/);
  assert.match(webUiSource, /setCode\(FIXED_VERIFICATION_CODE\)/);
  assert.match(webScreensSource, /setVerifyCode\(FIXED_VERIFICATION_CODE\)/);
  assert.doesNotMatch(webUiSource, /disabled=\{!phoneValid\}[^>]*>填入验证码/);
  assert.doesNotMatch(webScreensSource, /disabled=\{!user\?\.phone\}[^>]*>填入验证码/);
});

test('Expo Go local preview avoids production OTA and discovers the local API host', () => {
  assert.match(appConfigSource, /updates: \{ \.\.\.baseConfig\.updates, enabled: !isDevelopment/);
  assert.match(appConfigSource, /reactCompiler: isDevelopment \? false/);
  assert.match(appConfigSource, /!== 'expo-dev-client'/);
  assert.match(appClientSource, /Constants\.expoConfig\?\.hostUri/);
  assert.match(appClientSource, /return `http:\/\/\$\{hostname\}:3001`/);
  assert.match(appClientSource, /hostname\.endsWith\('\.exp\.direct'\)/);
});
