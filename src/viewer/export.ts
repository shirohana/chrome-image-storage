import JSZip from 'jszip';
import type { SavedImage, ImageMetadata } from '../types';

export async function exportImages(images: SavedImage[]): Promise<void> {
  const zip = new JSZip();

  const metadata: ImageMetadata[] = [];
  const imagesFolder = zip.folder('images')!;

  for (const image of images) {
    const extension = getExtensionFromMimeType(image.mimeType);
    const filename = `${image.id}${extension}`;

    imagesFolder.file(filename, image.blob);

    metadata.push({
      id: image.id,
      imageUrl: image.imageUrl,
      pageUrl: image.pageUrl,
      pageTitle: image.pageTitle,
      mimeType: image.mimeType,
      fileSize: image.fileSize,
      width: image.width,
      height: image.height,
      savedAt: image.savedAt,
      tags: image.tags,
      isDeleted: image.isDeleted,
    });
  }

  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `image-storage-export-${Date.now()}.zip`;
  a.click();

  URL.revokeObjectURL(url);
}

function getExtensionFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
  };
  return map[mimeType] || '.jpg';
}
