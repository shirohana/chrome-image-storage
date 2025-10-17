import { imageDB } from './db';
import type { SavedImage } from '../types';

export async function saveImage(
  imageUrl: string,
  pageUrl: string,
  pageTitle?: string,
  capturedBlob?: Blob
): Promise<string> {
  let blob: Blob;

  if (capturedBlob) {
    // Use provided blob (captured from DOM)
    blob = capturedBlob;
  } else {
    // Fetch the image with extension's host permissions
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    blob = await response.blob();

    // Verify we got image data
    if (!blob.type.startsWith('image/')) {
      throw new Error(`Invalid content type: ${blob.type}`);
    }
  }

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
  const image = await imageDB.get(id);
  if (image) {
    image.isDeleted = true;
    await imageDB.update(image);
  }
}

export async function restoreImage(id: string): Promise<void> {
  const image = await imageDB.get(id);
  if (image) {
    image.isDeleted = false;
    await imageDB.update(image);
  }
}

export async function permanentlyDeleteImage(id: string): Promise<void> {
  return imageDB.delete(id);
}

export async function getImageCount(): Promise<number> {
  const images = await imageDB.getAll();
  return images.filter(img => !img.isDeleted).length;
}

export async function deleteAllImages(): Promise<void> {
  const images = await imageDB.getAll();
  for (const image of images) {
    if (!image.isDeleted) {
      image.isDeleted = true;
      await imageDB.update(image);
    }
  }
}

export async function emptyTrash(): Promise<void> {
  const images = await imageDB.getAll();
  for (const image of images) {
    if (image.isDeleted) {
      await imageDB.delete(image.id);
    }
  }
}

export async function updateImageTags(id: string, tags: string[]): Promise<void> {
  const image = await imageDB.get(id);
  if (image) {
    image.tags = tags;
    await imageDB.update(image);
  }
}
