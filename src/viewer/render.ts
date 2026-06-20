import type { ImageMetadata } from '../types';
import { state } from './state';
import { getOrCreateObjectURL, loadImageBlob, revokeObjectURLs, revokeObjectURL, PLACEHOLDER_IMAGE } from './blobs';
import { formatFileSize } from './format';
import { groupImagesByXAccount, groupImagesByDuplicates } from './grouping';
import { createImageCardNode } from './ImageCard';

// Card markup lives in the SolidJS ImageCard component (single source of truth);
// re-exported here so existing `./render` imports keep working. createImageCardNode
// produces real DOM nodes — the hot render paths below append nodes (no string round-trip).
export { createImageCardNode };

// Intersection Observer for lazy loading images
let imageObserver: IntersectionObserver | null = null;

function setupImageObserver() {
  if (imageObserver) {
    imageObserver.disconnect();
  }

  imageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(async (entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          const imageId = img.dataset.imageId;
          if (!imageId) return;

          await loadImageBlob(imageId);
          const url = getOrCreateObjectURL(imageId);
          if (url !== PLACEHOLDER_IMAGE) {
            img.src = url;
          }
        }
      });
    },
    {
      rootMargin: '200px',
    }
  );
}

function observeImages() {
  if (!imageObserver) {
    setupImageObserver();
  }

  const images = document.querySelectorAll('.image-preview[data-image-id]');
  images.forEach(img => {
    imageObserver!.observe(img);
  });
}

/**
 * Observe a single image element for lazy loading (used after surgical card
 * updates/inserts). No-op if the observer hasn't been created yet — a full
 * render sets it up first.
 */
export function observeImage(img: Element): void {
  if (imageObserver) {
    imageObserver.observe(img);
  }
}

// Intersection Observer for lazy loading preview thumbnails
let previewThumbnailObserver: IntersectionObserver | null = null;

function setupPreviewThumbnailObserver() {
  if (previewThumbnailObserver) {
    previewThumbnailObserver.disconnect();
  }

  previewThumbnailObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(async (entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          const imageId = img.dataset.imageId;
          if (!imageId) return;

          await loadImageBlob(imageId);
          const url = getOrCreateObjectURL(imageId);
          if (url !== PLACEHOLDER_IMAGE) {
            img.src = url;
            previewThumbnailObserver!.unobserve(img);
          }
        }
      });
    },
    {
      root: null,
      rootMargin: '100px',
    }
  );
}

export function observePreviewThumbnails() {
  if (!previewThumbnailObserver) {
    setupPreviewThumbnailObserver();
  }

  const thumbnails = document.querySelectorAll('.preview-thumbnail__image[data-image-id]');
  thumbnails.forEach(img => {
    previewThumbnailObserver!.observe(img);
  });
}

export async function renderImages(images: ImageMetadata[]) {
  const grid = document.getElementById('image-grid')!;
  const emptyState = document.getElementById('empty-state')!;

  // Generate new render token to cancel any in-progress renders
  const renderToken = ++state.currentRenderToken;

  if (images.length === 0) {
    revokeObjectURLs();
    emptyState.style.display = 'block';
    grid.style.display = 'none';
    return;
  }

  // Only revoke URLs for images no longer in the filtered set
  const currentImageIds = new Set(images.map(img => img.id));
  const urlsToRevoke = Array.from(state.objectUrls.keys()).filter(
    id => !currentImageIds.has(id)
  );
  for (const id of urlsToRevoke) {
    revokeObjectURL(id);
  }

  emptyState.style.display = 'none';
  grid.style.display = '';

  if (state.groupBy === 'x-account') {
    await renderXAccountGroups(images, renderToken);
  } else if (state.groupBy === 'duplicates') {
    await renderDuplicateGroups(images, renderToken);
  } else {
    await renderUngroupedImages(images, renderToken);
  }

  // Only observe if this render is still current
  if (renderToken === state.currentRenderToken) {
    observeImages();
    // Note: Checkboxes are already correct from createImageCardNode(), no need to update
  }
}

/** Build a DocumentFragment of card nodes for a list of images. */
function buildCardFragment(images: ImageMetadata[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const image of images) {
    fragment.appendChild(createImageCardNode(image));
  }
  return fragment;
}

// Chunked rendering for large datasets - keeps UI responsive
async function renderCardsInChunks(
  container: HTMLElement,
  images: ImageMetadata[],
  renderToken: number,
  chunkSize: number = 100
): Promise<void> {
  container.innerHTML = '';

  for (let i = 0; i < images.length; i += chunkSize) {
    // Abort if a newer render has started
    if (renderToken !== state.currentRenderToken) {
      return;
    }

    // Append this chunk's card nodes
    container.appendChild(buildCardFragment(images.slice(i, i + chunkSize)));

    // Yield to browser between chunks for UI responsiveness
    if (i + chunkSize < images.length) {
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    }
  }
}

async function renderUngroupedImages(images: ImageMetadata[], renderToken: number) {
  const grid = document.getElementById('image-grid')!;
  // Restore grid layout for ungrouped display
  grid.style.display = '';

  // For small datasets, use fast synchronous path
  if (images.length < 500) {
    grid.innerHTML = '';
    grid.appendChild(buildCardFragment(images));
    return;
  }

  // For large datasets (500+), render in chunks to keep UI responsive
  await renderCardsInChunks(grid, images, renderToken, 100);
}

async function renderXAccountGroups(images: ImageMetadata[], renderToken: number) {
  const grid = document.getElementById('image-grid')!;
  const groups = groupImagesByXAccount(images);

  if (groups.size === 0) {
    grid.innerHTML = '<div class="empty-state" style="display: block;"><p>No images from X/Twitter accounts found</p></div>';
    return;
  }

  // Remove grid layout from outer container (let group-content handle it)
  grid.style.display = 'block';

  // Sort accounts by image count (descending), then alphabetically
  const sortedAccounts = Array.from(groups.entries())
    .sort((a, b) => {
      const countDiff = b[1].length - a[1].length;
      if (countDiff !== 0) return countDiff;
      return a[0].localeCompare(b[0]);
    })
    .map(([account]) => account);

  // Count total cards to determine rendering strategy
  const totalCards = images.length;

  if (totalCards < 500) {
    // Fast path for small datasets
    grid.innerHTML = '';
    for (const account of sortedAccounts) {
      const groupImages = groups.get(account)!;
      const count = groupImages.length;

      const { section, content } = createGroupSection(
        `@${account}`,
        `${count} image${count !== 1 ? 's' : ''}`
      );
      content.appendChild(buildCardFragment(groupImages));
      grid.appendChild(section);
    }
  } else {
    // Chunked rendering for large datasets
    grid.innerHTML = '';
    for (const account of sortedAccounts) {
      // Abort if a newer render has started
      if (renderToken !== state.currentRenderToken) {
        return;
      }

      const groupImages = groups.get(account)!;
      const count = groupImages.length;

      const { section, content } = createGroupSection(
        `@${account}`,
        `${count} image${count !== 1 ? 's' : ''}`
      );
      grid.appendChild(section);

      // Render cards in chunks
      await renderCardsInChunks(content, groupImages, renderToken, 100);
    }
  }
}

async function renderDuplicateGroups(images: ImageMetadata[], renderToken: number) {
  const grid = document.getElementById('image-grid')!;
  const groups = groupImagesByDuplicates(images);

  if (groups.size === 0) {
    grid.innerHTML = '<div class="empty-state" style="display: block;"><p>No duplicates found</p></div>';
    return;
  }

  // Remove grid layout from outer container (let group-content handle it)
  grid.style.display = 'block';

  const sortedKeys = Array.from(groups.keys()).sort();
  const totalCards = images.length;

  if (totalCards < 500) {
    // Fast path for small datasets
    grid.innerHTML = '';
    for (const key of sortedKeys) {
      const groupImages = groups.get(key)!;
      const count = groupImages.length;
      const [dimensions, fileSize] = key.split('-');
      const fileSizeFormatted = formatFileSize(Number(fileSize));

      const { section, content } = createGroupSection(
        `${dimensions}, ${fileSizeFormatted}`,
        `${count} duplicates`
      );
      content.appendChild(buildCardFragment(groupImages));
      grid.appendChild(section);
    }
  } else {
    // Chunked rendering for large datasets
    grid.innerHTML = '';
    for (const key of sortedKeys) {
      // Abort if a newer render has started
      if (renderToken !== state.currentRenderToken) {
        return;
      }

      const groupImages = groups.get(key)!;
      const count = groupImages.length;
      const [dimensions, fileSize] = key.split('-');
      const fileSizeFormatted = formatFileSize(Number(fileSize));

      const { section, content } = createGroupSection(
        `${dimensions}, ${fileSizeFormatted}`,
        `${count} duplicates`
      );
      grid.appendChild(section);

      // Render cards in chunks
      await renderCardsInChunks(content, groupImages, renderToken, 100);
    }
  }
}

/**
 * Build a group-section DOM subtree: a `group-section` wrapping a `group-header`
 * (`group-title` + `group-count`) and an empty `group-content image-grid`.
 * Returns the outer section and the inner content container to append cards into.
 */
function createGroupSection(title: string, countLabel: string): { section: HTMLElement; content: HTMLElement } {
  const section = document.createElement('div');
  section.className = 'group-section';

  const header = document.createElement('div');
  header.className = 'group-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'group-title';
  titleEl.textContent = title;

  const countEl = document.createElement('span');
  countEl.className = 'group-count';
  countEl.textContent = countLabel;

  header.appendChild(titleEl);
  header.appendChild(countEl);

  const content = document.createElement('div');
  content.className = 'group-content image-grid';

  section.appendChild(header);
  section.appendChild(content);

  return { section, content };
}
