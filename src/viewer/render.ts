import type { ImageMetadata } from '../types';
import { state } from './state';
import { getOrCreateObjectURL, loadImageBlob, revokeObjectURLs, revokeObjectURL, PLACEHOLDER_IMAGE } from './blobs';
import { formatFileSize } from './format';
import { getXAccountFromUrl, groupImagesByXAccount, groupImagesByDuplicates } from './grouping';
import { parseTagSearch, sortTags } from './tag-utils';

// Create image card HTML (shared by grouped and ungrouped rendering)
export function createImageCardHTML(image: ImageMetadata): string {
  const url = getOrCreateObjectURL(image.id);
  const date = new Date(image.savedAt).toLocaleString();
  const fileSize = formatFileSize(image.fileSize);
  const isSelected = state.selectedIds.has(image.id);

  const actions = state.currentView === 'trash'
    ? `
      <button class="button button--sm button--primary image-actions__button restore-btn" data-id="${image.id}">Restore</button>
      <button class="button button--sm button--danger image-actions__button permanent-delete-btn" data-id="${image.id}">Delete Forever</button>
    `
    : `
      <button class="button button--sm button--secondary image-actions__button download-btn" data-id="${image.id}">Save</button>
      <button class="button button--sm button--danger image-actions__button delete-btn" data-id="${image.id}">Delete</button>
    `;

  // Parse current tag search to highlight active tags and account
  const tagSearchInput = document.getElementById('tag-search-input') as HTMLInputElement;
  const activeTags = new Set<string>();
  const parsed = tagSearchInput && tagSearchInput.value ? parseTagSearch(tagSearchInput.value) : null;

  if (parsed) {
    parsed.includeTags.forEach(tag => activeTags.add(tag));
    parsed.orGroups.forEach(group => group.forEach(tag => activeTags.add(tag)));
  }

  // X account filter button
  const xAccount = getXAccountFromUrl(image.pageUrl);
  const isAccountActive = xAccount && parsed && parsed.accounts.has(xAccount);
  const accountButtonHTML = xAccount
    ? `<button class="image-account-btn${isAccountActive ? ' image-account-btn--active' : ''}" data-account="${xAccount}" title="Filter by @${xAccount}">@${xAccount}</button>`
    : '';

  const tagsHTML = image.tags && image.tags.length > 0
    ? `<div class="image-tags">
        ${sortTags(image.tags).map(tag => {
          const isActive = activeTags.has(tag);
          return `<span class="image-tags__tag${isActive ? ' image-tags__tag--active' : ''}" data-tag="${tag}">${tag}</span>`;
        }).join('')}
      </div>`
    : '';

  // Rating badge with color coding
  const ratingConfig: { [key: string]: { label: string; color: string } } = {
    'g': { label: 'G', color: '#28a745' },  // green
    's': { label: 'S', color: '#ffc107' },  // yellow
    'q': { label: 'Q', color: '#fd7e14' },  // orange
    'e': { label: 'E', color: '#dc3545' }   // red
  };

  const ratingHTML = image.rating
    ? `<div class="rating-badge" style="background-color: ${ratingConfig[image.rating].color}">${ratingConfig[image.rating].label}</div>`
    : '<div class="rating-badge rating-badge-unrated">—</div>';

  return `
    <div class="image-card${isSelected ? ' selected' : ''}" data-id="${image.id}">
      <input type="checkbox" class="image-checkbox" data-id="${image.id}"${isSelected ? ' checked' : ''}>
      ${ratingHTML}
      <img src="${url}" alt="Saved image" class="image-preview" data-image-id="${image.id}">
      <div class="image-info">
        <div class="image-meta">
          <div class="image-meta__row"><strong>Saved:</strong> ${date}</div>
          <div class="image-meta__row"><strong>Size:</strong> ${fileSize}</div>
          <div class="image-meta__row"><strong>Dimensions:</strong> ${image.width} × ${image.height}</div>
          <div class="image-meta__row"><strong>Type:</strong> ${image.mimeType}</div>
        </div>
        ${tagsHTML}
        ${accountButtonHTML}
        <div class="image-url" title="${image.pageUrl}">
          <strong>From:</strong> <a href="${image.pageUrl}" target="_blank" rel="noopener noreferrer" class="page-link">${image.pageTitle || image.pageUrl}</a>
        </div>
        <div class="image-actions">
          ${actions}
        </div>
      </div>
    </div>
  `;
}

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
    // Note: Checkboxes are already correct from createImageCardHTML(), no need to update
  }
}

// Chunked rendering for large datasets - keeps UI responsive
async function renderCardsInChunks(
  container: HTMLElement,
  htmlChunks: string[],
  renderToken: number,
  chunkSize: number = 100
): Promise<void> {
  container.innerHTML = '';

  for (let i = 0; i < htmlChunks.length; i += chunkSize) {
    // Abort if a newer render has started
    if (renderToken !== state.currentRenderToken) {
      return;
    }

    const chunk = htmlChunks.slice(i, i + chunkSize).join('');
    const fragment = document.createElement('div');
    fragment.innerHTML = chunk;

    // Move nodes from fragment to container
    while (fragment.firstChild) {
      container.appendChild(fragment.firstChild);
    }

    // Yield to browser between chunks for UI responsiveness
    if (i + chunkSize < htmlChunks.length) {
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
    grid.innerHTML = images.map(image => createImageCardHTML(image)).join('');
    return;
  }

  // For large datasets (500+), render in chunks to keep UI responsive
  const htmlChunks = images.map(image => createImageCardHTML(image));
  await renderCardsInChunks(grid, htmlChunks, renderToken, 100);
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
    let html = '';
    for (const account of sortedAccounts) {
      const groupImages = groups.get(account)!;
      const count = groupImages.length;

      html += `
        <div class="group-section">
          <div class="group-header">
            <h3 class="group-title">@${account}</h3>
            <span class="group-count">${count} image${count !== 1 ? 's' : ''}</span>
          </div>
          <div class="group-content image-grid">
      `;

      html += groupImages.map(image => createImageCardHTML(image)).join('');

      html += `
          </div>
        </div>
      `;
    }
    grid.innerHTML = html;
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

      const groupSection = document.createElement('div');
      groupSection.className = 'group-section';

      const groupHeader = document.createElement('div');
      groupHeader.className = 'group-header';
      groupHeader.innerHTML = `
        <h3 class="group-title">@${account}</h3>
        <span class="group-count">${count} image${count !== 1 ? 's' : ''}</span>
      `;

      const groupContent = document.createElement('div');
      groupContent.className = 'group-content image-grid';

      groupSection.appendChild(groupHeader);
      groupSection.appendChild(groupContent);
      grid.appendChild(groupSection);

      // Render cards in chunks
      const htmlChunks = groupImages.map(image => createImageCardHTML(image));
      await renderCardsInChunks(groupContent, htmlChunks, renderToken, 100);
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
    let html = '';
    for (const key of sortedKeys) {
      const groupImages = groups.get(key)!;
      const count = groupImages.length;
      const [dimensions, fileSize] = key.split('-');
      const fileSizeFormatted = formatFileSize(Number(fileSize));

      html += `
        <div class="group-section">
          <div class="group-header">
            <h3 class="group-title">${dimensions}, ${fileSizeFormatted}</h3>
            <span class="group-count">${count} duplicates</span>
          </div>
          <div class="group-content image-grid">
      `;

      html += groupImages.map(image => createImageCardHTML(image)).join('');

      html += `
          </div>
        </div>
      `;
    }
    grid.innerHTML = html;
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

      const groupSection = document.createElement('div');
      groupSection.className = 'group-section';

      const groupHeader = document.createElement('div');
      groupHeader.className = 'group-header';
      groupHeader.innerHTML = `
        <h3 class="group-title">${dimensions}, ${fileSizeFormatted}</h3>
        <span class="group-count">${count} duplicates</span>
      `;

      const groupContent = document.createElement('div');
      groupContent.className = 'group-content image-grid';

      groupSection.appendChild(groupHeader);
      groupSection.appendChild(groupContent);
      grid.appendChild(groupSection);

      // Render cards in chunks
      const htmlChunks = groupImages.map(image => createImageCardHTML(image));
      await renderCardsInChunks(groupContent, htmlChunks, renderToken, 100);
    }
  }
}
