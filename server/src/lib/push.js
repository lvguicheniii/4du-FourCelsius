const db = require('../db');
const { isFeatureEnabled } = require('./feature-flags');

async function sendPushMessages(messages) {
  if (!messages.length || typeof fetch !== 'function') return;
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!response.ok) console.error('Expo push failed:', response.status, await response.text());
  } catch (error) {
    console.error('Expo push request failed:', error.message);
  }
}

function sendPushToUser(userId, { title, body, data = {}, ...presentation }) {
  if (!userId || !isFeatureEnabled('offline_push', userId)) return Promise.resolve();
  const tokens = db.prepare(`
    SELECT token FROM device_push_tokens WHERE user_id = ? AND enabled = 1
  `).all(userId);
  const messages = tokens.map(({ token }) => ({
    to: token,
    sound: 'default',
    title,
    body,
    data,
    channelId: 'sidu-social',
    ...presentation,
  }));
  return sendPushMessages(messages);
}

module.exports = { sendPushToUser, sendPushMessages };
