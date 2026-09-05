export type UploadFileType = 'p' | 'a' | 'c' | 's' | 'm' | 'f' | 'v' | 'vp' | 'vm' | 'vr';

export type UploadImagePolicy = {
  maxDimension: number;
  compress: number;
};

export type UploadImagePreset = 'default' | 'media-cover';

const IMAGE_TYPES = new Set<UploadFileType>(['p', 'a', 'c', 'm', 'f']);
const PRESERVED_EXTENSIONS = new Set(['png', 'gif', 'webp', 'bmp']);

export function getUploadImagePolicy(uri: string, type: UploadFileType, preset: UploadImagePreset = 'default'): UploadImagePolicy | null {
  if (!IMAGE_TYPES.has(type)) return null;

  if (preset === 'media-cover') return { maxDimension: 1600, compress: 0.76 };

  const cleanUri = uri.split(/[?#]/, 1)[0];
  const extension = cleanUri.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (extension && PRESERVED_EXTENSIONS.has(extension)) return null;

  return type === 'a'
    ? { maxDimension: 1024, compress: 0.85 }
    : { maxDimension: 2048, compress: 0.82 };
}

export async function prepareImageForUpload(uri: string, type: UploadFileType, preset: UploadImagePreset = 'default'): Promise<string> {
  const policy = getUploadImagePolicy(uri, type, preset);
  if (!policy) return uri;

  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const source = ImageManipulator.manipulate(uri);
    const original = await source.renderAsync();
    const longestEdge = Math.max(original.width, original.height);

    if (longestEdge > policy.maxDimension) {
      if (original.width >= original.height) {
        source.resize({ width: policy.maxDimension, height: null });
      } else {
        source.resize({ width: null, height: policy.maxDimension });
      }
    }

    const rendered = longestEdge > policy.maxDimension
      ? await source.renderAsync()
      : original;
    const result = await rendered.saveAsync({
      compress: policy.compress,
      format: SaveFormat.JPEG,
    });
    return result.uri;
  } catch {
    // Uploading the original is preferable to blocking the user's action.
    return uri;
  }
}
