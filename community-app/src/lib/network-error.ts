export const OFFLINE_ERROR_MESSAGE = '当前设备未连接网络，请检查网络后重试';

export async function getNetworkAwareError(error: unknown, fallbackMessage?: string): Promise<Error> {
  try {
    const Network = await import('expo-network');
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) {
      return new Error(OFFLINE_ERROR_MESSAGE);
    }
  } catch {
    // Preserve the transport error if the native network check itself is unavailable.
  }

  if (fallbackMessage) return new Error(fallbackMessage);
  return error instanceof Error ? error : new Error('网络请求失败，请稍后重试');
}
