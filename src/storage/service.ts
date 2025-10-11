import { imageDB } from './db';
import type { SavedImage } from '../types';

export async function saveImage(
  imageUrl: string,
  pageUrl: string,
  pageTitle?: string
): Promise<string> {
  const response = await fetch(imageUrl);
  const blob = await response.blob();

  const dimensions = await getImageDimensions(blob);

  const image: SavedImage = {
    id: crypto.randomUUID(),
    blob,
    imageUrl,
    pageUrl,
    pageTitle,
    mimeType: blob.type,
    fileSize: blob.size,
    width: dimensions.width,
    height: dimensions.height,
    savedAt: Date.now(),
  };

  await imageDB.add(image);
  return image.id;
}

async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const imageBitmap = await createImageBitmap(blob);
  const dimensions = { width: imageBitmap.width, height: imageBitmap.height };
  imageBitmap.close();
  return dimensions;
}

export async function getAllImages(): Promise<SavedImage[]> {
  return imageDB.getAll();
}

export async function getImage(id: string): Promise<SavedImage | undefined> {
  return imageDB.get(id);
}

export async function deleteImage(id: string): Promise<void> {
  return imageDB.delete(id);
}

export async function getImageCount(): Promise<number> {
  return imageDB.count();
}

export async function deleteAllImages(): Promise<void> {
  return imageDB.clear();
}
