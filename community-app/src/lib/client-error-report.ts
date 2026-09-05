import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { BASE_URL, getToken } from '@/api/client';

export function createIncidentId() {
  return `app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function reportClientError(error: Error, incidentId: string) {
  const token = getToken();
  await fetch(`${BASE_URL}/api/telemetry/client-error`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': incidentId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      incidentId,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version || 'unknown',
      name: String(error?.name || 'Error').slice(0, 100),
      message: String(error?.message || 'Unknown client error').slice(0, 500),
      stack: String(error?.stack || '').slice(0, 4000),
    }),
  });
}
