import { state } from './state';
import { getImageBlob } from '../storage/service';

/** Inline SVG shown while an image blob is not yet loaded. */
export const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect width="200" height="200" fill="%23f0f0f0"/%3E%3C/svg%3E';

// URL lifecycle management
export function getOrCreateObjectURL(imageId: string): string {
  if (state.objectUrls.has(imageId)) {
    return state.objectUrls.get(imageId)!;
  }

  const blob = state.loadedBlobs.get(imageId);
  if (!blob) {
    return PLACEHOLDER_IMAGE;
  }

  const url = URL.createObjectURL(blob);
  state.objectUrls.set(imageId, url);
  return url;
}

export async function loadImageBlob(imageId: string): Promise<void> {
  if (state.loadedBlobs.has(imageId)) {
    return;
  }

  const blob = await getImageBlob(imageId);
  if (blob) {
    state.loadedBlobs.set(imageId, blob);
  }
}

export function revokeObjectURLs() {
  for (const url of state.objectUrls.values()) {
    URL.revokeObjectURL(url);
  }
  state.objectUrls.clear();
}

export function revokeObjectURL(imageId: string) {
  const url = state.objectUrls.get(imageId);
  if (url && url !== PLACEHOLDER_IMAGE) {
    URL.revokeObjectURL(url);
    state.objectUrls.delete(imageId);
  }
}
