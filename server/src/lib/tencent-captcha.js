const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { captcha } = require('tencentcloud-sdk-nodejs-captcha/tencentcloud/services');
const db = require('../db');

const CaptchaClient = captcha.v20190722.Client;
const PURPOSES = new Set(['register', 'password_change', 'password_reset']);
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function captchaConfig() {
  return {
    secretId: String(process.env.TENCENTCLOUD_CAPTCHA_SECRET_ID || '').trim(),
    secretKey: String(process.env.TENCENTCLOUD_CAPTCHA_SECRET_KEY || '').trim(),
    appId: String(process.env.TENCENTCLOUD_CAPTCHA_APP_ID || '').trim(),
    appSecret: String(process.env.TENCENTCLOUD_CAPTCHA_APP_SECRET || '').trim(),
    region: String(process.env.TENCENTCLOUD_CAPTCHA_REGION || 'ap-guangzhou').trim(),
  };
}

function serviceError(message, code, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireCaptchaConfig() {
  const config = captchaConfig();
  if (!config.secretId || !config.secretKey || !/^\d+$/.test(config.appId) || !config.appSecret) {
    throw serviceError('安全验证服务暂未完成配置', 'CAPTCHA_NOT_CONFIGURED');
  }
  return config;
}

function normalizePurpose(value) {
  const purpose = String(value || '').trim();
  if (!PURPOSES.has(purpose)) throw serviceError('验证码用途无效', 'CAPTCHA_PURPOSE_INVALID', 400);
  return purpose;
}

function createCaptchaChallenge(purposeValue, now = Date.now()) {
  requireCaptchaConfig();
  const purpose = normalizePurpose(purposeValue);
  const id = uuid();
  db.prepare(`
    INSERT INTO captcha_challenges(id,purpose,status,created_at_ms,expires_at_ms)
    VALUES (?,?,'pending',?,?)
  `).run(id, purpose, now, now + CHALLENGE_TTL_MS);
  return { id, purpose, expiresAt: now + CHALLENGE_TTL_MS };
}

function paddedAesKey(value) {
  const source = Buffer.from(String(value), 'utf8');
  if (!source.length) throw serviceError('安全验证服务暂未完成配置', 'CAPTCHA_NOT_CONFIGURED');
  if (source.length >= 32) return source.subarray(0, 32);
  const key = Buffer.alloc(32);
  for (let index = 0; index < key.length; index += 1) key[index] = source[index % source.length];
  return key;
}

function createAidEncrypted(config = requireCaptchaConfig(), now = Date.now()) {
  const iv = crypto.randomBytes(16);
  const plaintext = `${config.appId}&${Math.floor(now / 1000)}&300`;
  const cipher = crypto.createCipheriv('aes-256-cbc', paddedAesKey(config.appSecret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function getChallenge(id, now = Date.now()) {
  const row = db.prepare(`
    SELECT id,purpose,status,created_at_ms,expires_at_ms,verified_at_ms,used_at_ms
    FROM captcha_challenges
    WHERE id=?
  `).get(String(id || ''));
  if (!row || Number(row.expires_at_ms) <= now) {
    throw serviceError('安全验证已过期，请重新验证', 'CAPTCHA_CHALLENGE_EXPIRED', 400);
  }
  return row;
}

function validateRedirectUri(value) {
  const redirectUri = String(value || '');
  if (redirectUri === 'communityapp://captcha-result') return redirectUri;
  throw serviceError('验证码回跳地址无效', 'CAPTCHA_REDIRECT_INVALID', 400);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderCaptchaLaunchPage({ challengeId, redirectUri }) {
  const config = requireCaptchaConfig();
  const challenge = getChallenge(challengeId);
  if (challenge.status !== 'pending') {
    throw serviceError('安全验证已使用，请重新发起', 'CAPTCHA_CHALLENGE_USED', 400);
  }
  const callbackUri = validateRedirectUri(redirectUri);
  const appIdJson = JSON.stringify(config.appId);
  const challengeJson = JSON.stringify(challenge.id);
  const redirectJson = JSON.stringify(callbackUri);
  const aidEncryptedJson = JSON.stringify(createAidEncrypted(config));
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta name="color-scheme" content="light dark">
  <title>肆度安全验证</title>
  <style>
    :root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#eff8fc,#d9edf6);color:#183545}
    main{width:min(86vw,360px);padding:30px 24px;border:1px solid rgba(255,255,255,.75);border-radius:24px;background:rgba(255,255,255,.58);box-shadow:0 18px 55px rgba(34,91,119,.12);text-align:center;backdrop-filter:blur(24px)}
    h1{margin:0 0 10px;font-size:20px}p{margin:0;color:#577484;font-size:14px;line-height:1.7}.mark{font-size:34px;margin-bottom:14px;color:#33a9dc}
    button{margin-top:18px;border:0;border-radius:999px;padding:10px 20px;background:#33a9dc;color:#fff;font-size:14px}
    @media(prefers-color-scheme:dark){body{background:linear-gradient(145deg,#0c202d,#173c50);color:#eef8fc}main{background:rgba(13,36,49,.7);border-color:rgba(126,194,224,.2)}p{color:#9db9c8}}
  </style>
  <script src="https://turing.captcha.qcloud.com/TJCaptcha.js"></script>
</head>
<body>
  <main><div class="mark">❄</div><h1>正在打开安全验证</h1><p id="status">通过图片验证后，肆度服务器才会发送短信验证码。</p><button id="retry" hidden>重新验证</button></main>
  <script>
    (() => {
      const appId=${appIdJson};
      const challengeId=${challengeJson};
      const redirectUri=${redirectJson};
      const options={userLanguage:'zh-cn',aidEncrypted:${aidEncryptedJson},aidEncryptedType:'cbc'};
      const status=document.getElementById('status');
      const retry=document.getElementById('retry');
      const finish=(params)=>{const url=new URL(redirectUri);Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,String(value)));location.replace(url.toString());};
      const show=()=>{
        retry.hidden=true;status.textContent='请在弹出的窗口中完成图片验证。';
        try{
          const instance=new TencentCaptcha(appId,(result)=>{
            if(result && result.ret===0 && result.ticket && result.randstr && !result.errorCode && !String(result.ticket).startsWith('trerror_')){
              finish({challenge_id:challengeId,ticket:result.ticket,randstr:result.randstr});return;
            }
            if(result && result.ret===2){finish({challenge_id:challengeId,cancelled:'1'});return;}
            status.textContent='安全验证暂时没有完成，请重试。';retry.hidden=false;
          },options);
          instance.show();
        }catch(error){status.textContent='安全验证服务加载失败，请检查网络后重试。';retry.hidden=false;}
      };
      retry.addEventListener('click',show);window.addEventListener('load',show,{once:true});
    })();
  </script>
</body>
</html>`;
}

const claimChallenge = db.transaction((id, purpose, now) => {
  const row = getChallenge(id, now);
  if (row.purpose !== purpose) throw serviceError('安全验证用途不一致', 'CAPTCHA_PURPOSE_MISMATCH', 400);
  if (row.status === 'verified') return { alreadyVerified: true, row };
  if (row.status !== 'pending') throw serviceError('安全验证已失效，请重新验证', 'CAPTCHA_CHALLENGE_USED', 400);
  const changed = db.prepare("UPDATE captcha_challenges SET status='verifying' WHERE id=? AND status='pending'").run(id).changes;
  if (!changed) throw serviceError('安全验证正在处理，请稍后重试', 'CAPTCHA_CHALLENGE_BUSY', 409);
  return { alreadyVerified: false, row };
});

async function verifyCaptchaProof({ challengeId, purpose: purposeValue, ticket, randstr, userIp }) {
  const config = requireCaptchaConfig();
  const purpose = normalizePurpose(purposeValue);
  const id = String(challengeId || '').trim();
  const normalizedTicket = String(ticket || '').trim();
  const normalizedRandstr = String(randstr || '').trim();
  if (!id || !normalizedTicket || !normalizedRandstr || normalizedTicket.length > 4096 || normalizedRandstr.length > 512) {
    throw serviceError('请先完成图片验证', 'CAPTCHA_PROOF_REQUIRED', 400);
  }
  if (normalizedTicket.startsWith('trerror_')) {
    throw serviceError('图片验证未完成，请重新验证', 'CAPTCHA_FALLBACK_REJECTED', 400);
  }

  const claimed = claimChallenge(id, purpose, Date.now());
  if (claimed.alreadyVerified) return { ok: true, challengeId: id };

  const client = new CaptchaClient({
    credential: { secretId: config.secretId, secretKey: config.secretKey },
    region: config.region,
    profile: { httpProfile: { endpoint: 'captcha.tencentcloudapi.com', reqTimeout: 8 } },
  });
  try {
    const response = await client.DescribeCaptchaResult({
      CaptchaType: 9,
      Ticket: normalizedTicket,
      UserIp: String(userIp || '').slice(0, 128),
      Randstr: normalizedRandstr,
      CaptchaAppId: Number(config.appId),
      AppSecretKey: config.appSecret,
    });
    if (Number(response?.CaptchaCode) !== 1 || Number(response?.EvilLevel) === 100) {
      db.prepare("UPDATE captcha_challenges SET status='rejected' WHERE id=?").run(id);
      throw serviceError('图片验证未通过，请重新验证', 'CAPTCHA_REJECTED', 400);
    }
    db.prepare("UPDATE captcha_challenges SET status='verified',verified_at_ms=? WHERE id=? AND status='verifying'")
      .run(Date.now(), id);
    return { ok: true, challengeId: id };
  } catch (error) {
    if (error?.code === 'CAPTCHA_REJECTED') throw error;
    db.prepare("UPDATE captcha_challenges SET status='pending' WHERE id=? AND status='verifying'").run(id);
    console.error(JSON.stringify({ level: 'error', type: 'captcha_verification_failed', code: String(error?.code || 'SDK_ERROR').slice(0, 100) }));
    throw serviceError('安全验证服务暂时不可用，请稍后重试', 'CAPTCHA_PROVIDER_UNAVAILABLE');
  }
}

function markCaptchaChallengeUsed(challengeId) {
  const changes = db.prepare("UPDATE captcha_challenges SET status='used',used_at_ms=? WHERE id=? AND status='verified'")
    .run(Date.now(), String(challengeId || '')).changes;
  if (!changes) throw serviceError('安全验证已失效，请重新验证', 'CAPTCHA_CHALLENGE_USED', 400);
}

function pruneCaptchaChallenges(now = Date.now()) {
  return db.prepare('DELETE FROM captcha_challenges WHERE expires_at_ms < ?').run(now - 24 * 60 * 60 * 1000).changes;
}

module.exports = {
  PURPOSES,
  createCaptchaChallenge,
  createAidEncrypted,
  getChallenge,
  markCaptchaChallengeUsed,
  normalizePurpose,
  pruneCaptchaChallenges,
  renderCaptchaLaunchPage,
  verifyCaptchaProof,
  getPublicCaptchaConfig() {
    const config = requireCaptchaConfig();
    return { appId: Number(config.appId), aidEncrypted: createAidEncrypted(config), aidEncryptedType: 'cbc' };
  },
};
