import { imageDB } from './db';
import type { SavedImage } from '../types';
import { loadTagRules, getAutoTags } from './tag-rules';

/**
 * Extracts rating from tags array and returns cleaned tags without rating tags.
 * Rating tags format: rating:g, rating:s, rating:q, rating:e
 * Returns the first found rating tag and removes all rating tags from array.
 */
function extractRatingFromTags(tags: string[]): { rating?: 'g' | 's' | 'q' | 'e'; cleanedTags: string[] } {
  let rating: 'g' | 's' | 'q' | 'e' | undefined;
  const cleanedTags: string[] = [];

  for (const tag of tags) {
    const match = tag.match(/^rating:([gsqe])$/i);
    if (match) {
      // Extract rating value from first matching tag
      if (!rating) {
        rating = match[1].toLowerCase() as 'g' | 's' | 'q' | 'e';
      }
      // Don't include rating tags in cleaned array
    } else {
      cleanedTags.push(tag);
    }
  }

  return { rating, cleanedTags };
}

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

  const rules = await loadTagRules();
  const autoTags = getAutoTags(pageTitle || '', rules);

  // Extract rating from tags and get cleaned tags
  const { rating, cleanedTags } = extractRatingFromTags(autoTags);

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
    tags: cleanedTags.length > 0 ? cleanedTags : undefined,
    rating,
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

export async function getAllImagesMetadata(): Promise<Omit<SavedImage, 'blob'>[]> {
  return imageDB.getAllMetadata();
}

export async function getImageBlob(id: string): Promise<Blob | undefined> {
  return imageDB.getBlob(id);
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
    // Extract rating from tags and get cleaned tags
    const { rating, cleanedTags } = extractRatingFromTags(tags);
    image.tags = cleanedTags.length > 0 ? cleanedTags : undefined;
    // Only update rating if a rating tag was found
    if (rating !== undefined) {
      image.rating = rating;
    }
    await imageDB.update(image);
  }
}

export async function addTagsToImages(imageIds: string[], tagsToAdd: string[]): Promise<void> {
  for (const id of imageIds) {
    const image = await imageDB.get(id);
    if (image) {
      const existingTags = image.tags || [];
      const uniqueTags = Array.from(new Set([...existingTags, ...tagsToAdd]));
      // Extract rating from combined tags and get cleaned tags
      const { rating, cleanedTags } = extractRatingFromTags(uniqueTags);
      image.tags = cleanedTags.length > 0 ? cleanedTags : undefined;
      // Only update rating if a rating tag was found
      if (rating !== undefined) {
        image.rating = rating;
      }
      await imageDB.update(image);
    }
  }
}

export async function removeTagsFromImages(imageIds: string[], tagsToRemove: string[]): Promise<void> {
  const tagsToRemoveSet = new Set(tagsToRemove);
  // Check if any rating tags are being removed
  const removingRating = tagsToRemove.some(tag => /^rating:[gsqe]$/i.test(tag));

  for (const id of imageIds) {
    const image = await imageDB.get(id);
    if (image && image.tags) {
      image.tags = image.tags.filter(tag => !tagsToRemoveSet.has(tag));
      // Clear rating if rating tag was removed
      if (removingRating) {
        image.rating = undefined;
      }
      await imageDB.update(image);
    }
  }
}

export async function updateImageRating(id: string, rating?: 'g' | 's' | 'q' | 'e'): Promise<void> {
  const image = await imageDB.get(id);
  if (image) {
    image.rating = rating;
    await imageDB.update(image);
  }
}

export async function updateImagesRating(imageIds: string[], rating?: 'g' | 's' | 'q' | 'e'): Promise<void> {
  for (const id of imageIds) {
    const image = await imageDB.get(id);
    if (image) {
      image.rating = rating;
      await imageDB.update(image);
    }
  }
}

export async function updateImagePageTitle(id: string, pageTitle?: string): Promise<void> {
  const image = await imageDB.get(id);
  if (image) {
    image.pageTitle = pageTitle;
    await imageDB.update(image);
  }
}

export async function updateImagePageUrl(id: string, pageUrl: string): Promise<void> {
  const image = await imageDB.get(id);
  if (image) {
    image.pageUrl = pageUrl;
    await imageDB.update(image);
  }
}

export async function importLocalFiles(files: File[]): Promise<SavedImage[]> {
  const importedImages: SavedImage[] = [];

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      continue;
    }

    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const dimensions = await getImageDimensions(blob);

    // Use filename without extension as page title
    const filename = file.name;
    const pageTitle = filename.substring(0, filename.lastIndexOf('.')) || filename;

    const rules = await loadTagRules();
    const autoTags = getAutoTags(pageTitle, rules);
    const { rating, cleanedTags } = extractRatingFromTags(autoTags);

    const image: SavedImage = {
      id: crypto.randomUUID(),
      blob,
      imageUrl: `file:///${filename}`,
      pageUrl: `file:///${filename}`,
      pageTitle,
      mimeType: blob.type,
      fileSize: blob.size,
      width: dimensions.width,
      height: dimensions.height,
      savedAt: Date.now(),
      tags: cleanedTags.length > 0 ? cleanedTags : undefined,
      rating,
    };

    await imageDB.add(image);
    importedImages.push(image);
  }

  return importedImages;
}
