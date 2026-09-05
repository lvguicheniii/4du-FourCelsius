import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createCaptchaChallenge, type CaptchaProof, type SmsVerificationPurpose } from '@/api/client';

function queryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export async function runTencentCaptcha(purpose: SmsVerificationPurpose): Promise<CaptchaProof> {
  const redirectUri = Linking.createURL('captcha-result', { scheme: 'communityapp' });
  const challenge = await createCaptchaChallenge(purpose);
  if (challenge.redirectUri !== redirectUri) {
    throw new Error('安全验证回跳配置不一致，请更新 App 后重试');
  }
  const result = await WebBrowser.openAuthSessionAsync(challenge.launchUrl, redirectUri, {
    preferEphemeralSession: true,
    createTask: false,
  });
  if (result.type !== 'success' || !result.url) throw new Error('已取消安全验证');

  const parsed = Linking.parse(result.url);
  const challengeId = queryValue(parsed.queryParams?.challenge_id);
  const ticket = queryValue(parsed.queryParams?.ticket);
  const randstr = queryValue(parsed.queryParams?.randstr);
  const cancelled = queryValue(parsed.queryParams?.cancelled);
  if (cancelled === '1') throw new Error('已取消安全验证');
  if (challengeId !== challenge.challengeId || !ticket || !randstr) {
    throw new Error('安全验证结果无效，请重新验证');
  }
  return { challengeId, ticket, randstr };
}
