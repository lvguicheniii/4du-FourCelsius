import { AppState, InteractionManager, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { showAppAlert } from '@/components/app-alert';

let pickerOpen = false;

function canceledResult(): ImagePicker.ImagePickerResult {
  return { canceled: true, assets: null };
}

async function waitUntilReady() {
  if (AppState.currentState !== 'active') {
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        subscription.remove();
        resolve();
      }, 1500);
      const subscription = AppState.addEventListener('change', state => {
        if (state !== 'active') return;
        clearTimeout(timeout);
        subscription.remove();
        resolve();
      });
    });
  }
  await new Promise<void>(resolve => InteractionManager.runAfterInteractions(() => resolve()));
  // ActivityResult launchers are registered after the first resumed frame on
  // Android. Give the development client a short settling window after a
  // screen focus or hot reload before opening the system picker.
  await new Promise<void>(resolve => setTimeout(resolve, 250));
}

function isUnregisteredLauncherError(error: unknown) {
  return error instanceof Error && /unregistered ActivityResultLauncher/i.test(error.message);
}

export async function launchImageLibrarySafely(
  options: ImagePicker.ImagePickerOptions,
): Promise<ImagePicker.ImagePickerResult> {
  if (pickerOpen) return canceledResult();
  pickerOpen = true;
  try {
    // Touch the native module before launching. On some Android activity resumes,
    // a lazily-created picker otherwise misses its launcher registration window.
    try { await ImagePicker.getMediaLibraryPermissionsAsync(); } catch {}
    await waitUntilReady();
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await ImagePicker.launchImageLibraryAsync(
          Platform.OS === 'android' && attempt > 1 ? { ...options, legacy: true } : options,
        );
      } catch (error) {
        lastError = error;
        if (!isUnregisteredLauncherError(error) || attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        await waitUntilReady();
      }
    }
    throw lastError;
  } catch (error) {
    showAppAlert(
      '无法打开相册',
      isUnregisteredLauncherError(error)
        ? '相册组件尚未准备好，请返回后重试'
        : '打开相册失败，请稍后重试',
    );
    return canceledResult();
  } finally {
    pickerOpen = false;
  }
}
