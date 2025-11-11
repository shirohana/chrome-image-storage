import { getAllImages, deleteImage, deleteAllImages, restoreImage, permanentlyDeleteImage, emptyTrash, updateImageTags, addTagsToImages, removeTagsFromImages } from '../storage/service';
import type { SavedImage } from '../types';

// Constants
const ViewMode = {
  GRID: 'grid',
  COMPACT: 'compact',
  LIST: 'list',
} as const;

const SortField = {
  SAVED_AT: 'savedAt',
  FILE_SIZE: 'fileSize',
  DIMENSIONS: 'dimensions',
  URL: 'url',
} as const;

const SortDirection = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

// State
const state = {
  images: [] as SavedImage[],
  filteredImages: [] as SavedImage[],
  sort: 'savedAt-desc',
  typeFilter: 'all',
  tagFilters: new Set<string>(),
  excludedTagFilters: new Set<string>(),
  tagFilterMode: 'union' as 'union' | 'intersection',
  showUntaggedOnly: false,
  groupBy: 'none',
  selectedIds: new Set<string>(),
  objectUrls: new Map<string, string>(),
  currentView: 'all' as 'all' | 'trash',
  lightboxActive: false,
  currentLightboxIndex: -1,
  previewPaneVisible: false,
  lastSelectedIndex: -1,
  selectionAnchor: -1,
};

// Settings
async function loadSettings() {
  const result = await chrome.storage.local.get(['showNotifications']);
  return {
    showNotifications: result.showNotifications ?? false, // Default: OFF
  };
}

async function saveSettings(settings: { showNotifications: boolean }) {
  await chrome.storage.local.set(settings);
}

async function loadImages() {
  state.images = await getAllImages();
  populateTypeFilter();
  populateTagFilter();
  applySorting();
  applyFilters();
}

function populateTypeFilter() {
  const typeFilter = document.getElementById('type-filter') as HTMLSelectElement;
  const mimeTypes = new Set(state.images.map(img => img.mimeType));

  const mimeTypeLabels: Record<string, string> = {
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/jpg': 'JPEG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/svg+xml': 'SVG',
  };

  typeFilter.innerHTML = '<option value="all">All Types</option>';

  const sortedTypes = Array.from(mimeTypes).sort();
  sortedTypes.forEach(mimeType => {
    const label = mimeTypeLabels[mimeType] || mimeType;
    const option = document.createElement('option');
    option.value = mimeType;
    option.textContent = label;
    typeFilter.appendChild(option);
  });

  typeFilter.value = state.typeFilter;
}

function populateTagFilter() {
  const tagFilter = document.getElementById('tag-filter') as HTMLSelectElement;
  const allTags = new Set<string>();

  state.images.forEach(img => {
    if (img.tags && img.tags.length > 0) {
      img.tags.forEach(tag => allTags.add(tag));
    }
  });

  tagFilter.innerHTML = '<option value="">Select tags...</option>';

  const sortedTags = Array.from(allTags).sort();
  sortedTags.forEach(tag => {
    // Skip tags that are already selected
    if (!state.tagFilters.has(tag)) {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tag;
      tagFilter.appendChild(option);
    }
  });

  renderSelectedTags();
}

function updateTagFilterOptions() {
  const tagFilter = document.getElementById('tag-filter') as HTMLSelectElement;
  if (!tagFilter) return;

  const allTags = new Set<string>();
  state.images.forEach(img => {
    if (img.tags && img.tags.length > 0) {
      img.tags.forEach(tag => allTags.add(tag));
    }
  });

  tagFilter.innerHTML = '<option value="">Select tags...</option>';

  const sortedTags = Array.from(allTags).sort();
  sortedTags.forEach(tag => {
    // Skip tags that are already selected
    if (!state.tagFilters.has(tag)) {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tag;
      tagFilter.appendChild(option);
    }
  });

  tagFilter.value = '';
}

function renderSelectedTags() {
  const container = document.getElementById('selected-tags');
  if (!container) return;

  if (state.tagFilters.size === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = Array.from(state.tagFilters)
    .map(tag => `
      <span class="selected-tag">
        ${tag}
        <button class="remove-tag" data-tag="${tag}">&times;</button>
      </span>
    `)
    .join('');

  // Attach remove handlers
  container.querySelectorAll('.remove-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag')!;
      state.tagFilters.delete(tag);

      updateTagFilterOptions();
      renderSelectedTags();
      applyFilters();
    });
  });
}

function updateExcludeTagFilterOptions(images: SavedImage[] = state.filteredImages) {
  const excludeTagFilter = document.getElementById('exclude-tag-filter') as HTMLSelectElement;
  if (!excludeTagFilter) return;

  const allTags = new Set<string>();
  images.forEach(img => {
    if (img.tags && img.tags.length > 0) {
      img.tags.forEach(tag => allTags.add(tag));
    }
  });

  excludeTagFilter.innerHTML = '<option value="">Exclude tags...</option>';

  const sortedTags = Array.from(allTags).sort();
  sortedTags.forEach(tag => {
    // Skip tags that are already selected for inclusion or exclusion
    if (!state.excludedTagFilters.has(tag) && !state.tagFilters.has(tag)) {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tag;
      excludeTagFilter.appendChild(option);
    }
  });

  excludeTagFilter.value = '';
}

function renderExcludedTags() {
  const container = document.getElementById('excluded-tags');
  if (!container) return;

  if (state.excludedTagFilters.size === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = Array.from(state.excludedTagFilters)
    .map(tag => `
      <span class="excluded-tag">
        ${tag}
        <button class="remove-excluded-tag" data-tag="${tag}">&times;</button>
      </span>
    `)
    .join('');

  // Attach remove handlers
  container.querySelectorAll('.remove-excluded-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag')!;
      state.excludedTagFilters.delete(tag);

      updateExcludeTagFilterOptions();
      renderExcludedTags();
      applyFilters();
    });
  });
}

function applyFilters() {
  let filtered = state.images;

  // Apply view filter (all or trash)
  if (state.currentView === 'all') {
    filtered = filtered.filter(img => !img.isDeleted);
  } else {
    filtered = filtered.filter(img => img.isDeleted);
  }

  // Apply type filter
  if (state.typeFilter !== 'all') {
    filtered = filtered.filter(img => img.mimeType === state.typeFilter);
  }

  // Apply tag filter (multi-tag with union/intersection mode)
  if (state.tagFilters.size > 0) {
    if (state.tagFilterMode === 'union') {
      // Union (OR): Image has ANY of the selected tags
      filtered = filtered.filter(img =>
        img.tags && img.tags.some(tag => state.tagFilters.has(tag))
      );
    } else {
      // Intersection (AND): Image has ALL of the selected tags
      filtered = filtered.filter(img =>
        img.tags && Array.from(state.tagFilters).every(tag => img.tags!.includes(tag))
      );
    }
  }

  // Update exclude tag options based on current filtered results
  // (before applying exclude filter so dropdown shows only effective options)
  updateExcludeTagFilterOptions(filtered);

  // Apply exclude tag filter (filter out images with ANY excluded tag)
  if (state.excludedTagFilters.size > 0) {
    filtered = filtered.filter(img =>
      !img.tags || !img.tags.some(tag => state.excludedTagFilters.has(tag))
    );
  }

  // Apply untagged-only filter
  if (state.showUntaggedOnly) {
    filtered = filtered.filter(img => !img.tags || img.tags.length === 0);
  }

  // Apply search filter
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const query = searchInput.value.toLowerCase();
  if (query) {
    filtered = filtered.filter(img =>
      img.imageUrl.toLowerCase().includes(query) ||
      img.pageUrl.toLowerCase().includes(query) ||
      (img.pageTitle && img.pageTitle.toLowerCase().includes(query))
    );
  }

  // Store filtered images for select all
  state.filteredImages = filtered;

  // Clean up selection: remove IDs that are not in filtered results
  const filteredIds = new Set(filtered.map(img => img.id));
  for (const id of state.selectedIds) {
    if (!filteredIds.has(id)) {
      state.selectedIds.delete(id);
    }
  }

  renderImages(filtered);
  updateImageCount();
  updateViewBadges();
  updateSelectionCount();
  updatePreviewPane();
}

function applySorting() {
  const [field, direction] = state.sort.split('-');
  const isAsc = direction === 'asc';

  state.images.sort((a, b) => {
    let comparison = 0;

    switch (field) {
      case 'savedAt':
        comparison = a.savedAt - b.savedAt;
        break;
      case 'fileSize':
        comparison = a.fileSize - b.fileSize;
        break;
      case 'dimensions':
        comparison = (a.width * a.height) - (b.width * b.height);
        break;
      case 'url':
        comparison = a.imageUrl.localeCompare(b.imageUrl);
        break;
    }

    return isAsc ? comparison : -comparison;
  });
}

// URL lifecycle management
function getOrCreateObjectURL(image: SavedImage): string {
  if (state.objectUrls.has(image.id)) {
    return state.objectUrls.get(image.id)!;
  }
  const url = URL.createObjectURL(image.blob);
  state.objectUrls.set(image.id, url);
  return url;
}

function revokeObjectURLs() {
  for (const url of state.objectUrls.values()) {
    URL.revokeObjectURL(url);
  }
  state.objectUrls.clear();
}

// Create image card HTML (shared by grouped and ungrouped rendering)
function createImageCardHTML(image: SavedImage): string {
  const url = getOrCreateObjectURL(image);
  const date = new Date(image.savedAt).toLocaleString();
  const fileSize = formatFileSize(image.fileSize);
  const isSelected = state.selectedIds.has(image.id);

  const actions = state.currentView === 'trash'
    ? `
      <button class="btn btn-primary restore-btn" data-id="${image.id}">Restore</button>
      <button class="btn btn-danger permanent-delete-btn" data-id="${image.id}">Delete Forever</button>
    `
    : `
      <button class="btn btn-secondary download-btn" data-id="${image.id}">Download</button>
      <button class="btn btn-primary view-page-btn" data-id="${image.id}">View Page</button>
      <button class="btn btn-primary view-btn" data-id="${image.id}">View Original</button>
      <button class="btn btn-danger delete-btn" data-id="${image.id}">Delete</button>
    `;

  const tagsHTML = image.tags && image.tags.length > 0
    ? `<div class="image-tags">
        ${image.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
      </div>`
    : '';

  return `
    <div class="image-card ${isSelected ? 'selected' : ''}" data-id="${image.id}">
      <input type="checkbox" class="image-checkbox" data-id="${image.id}" ${isSelected ? 'checked' : ''}>
      <img src="${url}" alt="Saved image" class="image-preview">
      <div class="image-info">
        <div class="image-meta">
          <div><strong>Saved:</strong> ${date}</div>
          <div><strong>Size:</strong> ${fileSize}</div>
          <div><strong>Dimensions:</strong> ${image.width} × ${image.height}</div>
          <div><strong>Type:</strong> ${image.mimeType}</div>
        </div>
        ${tagsHTML}
        <div class="image-url" title="${image.imageUrl}">
          <strong>From:</strong> ${image.pageTitle || image.pageUrl}
        </div>
        <div class="image-actions">
          ${actions}
        </div>
      </div>
    </div>
  `;
}

function renderImages(images: SavedImage[]) {
  const grid = document.getElementById('image-grid')!;
  const emptyState = document.getElementById('empty-state')!;

  if (images.length === 0) {
    revokeObjectURLs();
    emptyState.style.display = 'block';
    grid.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  grid.style.display = '';

  if (state.groupBy === 'domain') {
    renderGroupedImages(images);
  } else if (state.groupBy === 'duplicates') {
    renderDuplicateGroups(images);
  } else {
    renderUngroupedImages(images);
  }
}

function renderUngroupedImages(images: SavedImage[]) {
  const grid = document.getElementById('image-grid')!;
  grid.innerHTML = images.map(image => createImageCardHTML(image)).join('');
}

async function handleDownload(e: Event) {
  const target = e.target as HTMLElement;
  const btn = target.closest('.download-btn') as HTMLElement;
  if (!btn) return;

  const id = btn.dataset.id!;
  const image = state.images.find(img => img.id === id);
  if (image) {
    const { getExtensionFromMimeType } = await import('./dump');
    const extension = getExtensionFromMimeType(image.mimeType);
    const filename = `${image.id}${extension}`;

    const url = URL.createObjectURL(image.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function handleViewOriginal(e: Event) {
  const target = e.target as HTMLElement;
  const btn = target.closest('.view-btn') as HTMLElement;
  if (!btn) return;

  const id = btn.dataset.id!;
  const image = state.images.find(img => img.id === id);
  if (image) {
    window.open(image.imageUrl, '_blank');
  }
}

function handleViewPage(e: Event) {
  const target = e.target as HTMLElement;
  const btn = target.closest('.view-page-btn') as HTMLElement;
  if (!btn) return;

  const id = btn.dataset.id!;
  const image = state.images.find(img => img.id === id);
  if (image) {
    window.open(image.pageUrl, '_blank');
  }
}

async function handleDelete(e: Event) {
  const target = e.target as HTMLElement;
  const btn = target.closest('.delete-btn') as HTMLElement;
  if (!btn) return;

  const id = btn.dataset.id!;
  await deleteImage(id);
  state.selectedIds.delete(id);
  await loadImages();
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
}

async function handleRestore(e: Event) {
  const target = e.target as HTMLElement;
  const btn = target.closest('.restore-btn') as HTMLElement;
  if (!btn) return;

  const id = btn.dataset.id!;
  await restoreImage(id);
  state.selectedIds.delete(id);
  await loadImages();
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
}

async function handlePermanentDelete(e: Event) {
  const target = e.target as HTMLElement;
  const btn = target.closest('.permanent-delete-btn') as HTMLElement;
  if (!btn) return;

  const id = btn.dataset.id!;
  const confirmed = confirm('Are you sure you want to permanently delete this image? This cannot be undone.');
  if (confirmed) {
    await permanentlyDeleteImage(id);
    state.selectedIds.delete(id);
    await loadImages();
  }
}

async function handleSaveTags(e: Event) {
  const target = e.target as HTMLElement;
  const btn = target.closest('.save-tags-btn') as HTMLElement;
  if (!btn) return;

  const id = btn.dataset.id!;
  const input = document.getElementById('lightbox-tag-input') as HTMLInputElement;
  if (!input) return;

  const tagsString = input.value.trim();
  const tags = tagsString
    ? tagsString.split(/\s+/).filter(tag => tag.length > 0)
    : [];

  // Remove duplicates using Set
  const uniqueTags = Array.from(new Set(tags));

  await updateImageTags(id, uniqueTags);
  await loadImages();

  const currentImage = state.filteredImages[state.currentLightboxIndex];
  if (currentImage) {
    updateLightboxMetadata(currentImage);
  }
  updatePreviewPane();
}

function handleCheckboxChange(e: Event) {
  const checkbox = e.target as HTMLInputElement;
  const id = checkbox.dataset.id!;

  if (checkbox.checked) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }

  updateSelectionCount();
  updateImageCard(id);
  updatePreviewPane();
}

function updateImageCard(id: string) {
  const card = document.querySelector(`.image-card[data-id="${id}"]`);
  if (card) {
    if (state.selectedIds.has(id)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  }
}

function updateImageCount() {
  const countEl = document.querySelector('.image-count')!;
  const count = state.images.filter(img => !img.isDeleted).length;
  countEl.textContent = `${count} image${count !== 1 ? 's' : ''}`;
}

function updateViewBadges() {
  const allImagesBadge = document.getElementById('all-images-badge')!;
  const trashBadge = document.getElementById('trash-badge')!;

  const allCount = state.images.filter(img => !img.isDeleted).length;
  const trashCount = state.images.filter(img => img.isDeleted).length;

  allImagesBadge.textContent = allCount.toString();
  trashBadge.textContent = trashCount.toString();
}

function updateSelectionCount() {
  const selectionCountEl = document.getElementById('selection-count');
  if (selectionCountEl) {
    const count = state.selectedIds.size;
    if (count > 0) {
      selectionCountEl.textContent = `${count} selected`;
      selectionCountEl.style.display = 'inline';
    } else {
      selectionCountEl.style.display = 'none';
    }
  }
}

function togglePreviewPane() {
  state.previewPaneVisible = !state.previewPaneVisible;
  const previewPane = document.getElementById('preview-pane')!;
  if (state.previewPaneVisible) {
    previewPane.classList.add('visible');
    document.body.classList.add('preview-pane-open');
  } else {
    previewPane.classList.remove('visible');
    document.body.classList.remove('preview-pane-open');
  }
  localStorage.setItem('previewPaneVisible', state.previewPaneVisible.toString());
}

function updatePreviewPane() {
  const content = document.getElementById('preview-pane-content')!;
  const selectedImages = state.filteredImages.filter(img => state.selectedIds.has(img.id));

  if (selectedImages.length === 0) {
    content.innerHTML = '<div class="preview-empty">No items selected</div>';
  } else if (selectedImages.length === 1) {
    renderSinglePreview(selectedImages[0], content);
  } else {
    renderMultiPreview(selectedImages, content);
  }
}

function renderSinglePreview(image: SavedImage, container: HTMLElement) {
  const url = getOrCreateObjectURL(image);
  const date = new Date(image.savedAt).toLocaleString();
  const fileSize = formatFileSize(image.fileSize);

  const truncateUrl = (url: string, maxLength: number = 50) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
  };

  const tagsHTML = image.tags && image.tags.length > 0
    ? image.tags.map(tag => `<span class="tag">${tag}</span>`).join('')
    : '<span class="no-tags">No tags</span>';

  container.innerHTML = `
    <div class="preview-single">
      <div class="preview-image-container">
        <img src="${url}" alt="Preview" class="preview-image">
      </div>
      <div class="preview-metadata">
        <div class="preview-meta-row">
          <span class="preview-meta-label">Dimensions</span>
          <span class="preview-meta-value">${image.width} × ${image.height}</span>
        </div>
        <div class="preview-meta-row">
          <span class="preview-meta-label">File Size</span>
          <span class="preview-meta-value">${fileSize}</span>
        </div>
        <div class="preview-meta-row">
          <span class="preview-meta-label">Type</span>
          <span class="preview-meta-value">${image.mimeType}</span>
        </div>
        <div class="preview-meta-row">
          <span class="preview-meta-label">Saved</span>
          <span class="preview-meta-value">${date}</span>
        </div>
        <div class="preview-meta-row">
          <span class="preview-meta-label">Source Page</span>
          <a href="${image.pageUrl}" target="_blank" class="preview-meta-value preview-meta-link" title="${image.pageUrl}">
            ${truncateUrl(image.pageUrl)}
          </a>
        </div>
        <div class="preview-meta-row">
          <span class="preview-meta-label">Tags</span>
          <div class="preview-meta-tags">${tagsHTML}</div>
        </div>
      </div>
      <div class="preview-actions">
        <button class="btn btn-secondary download-btn preview-download-btn" data-id="${image.id}">Download</button>
        <button class="btn btn-primary view-page-btn preview-view-page-btn" data-id="${image.id}">View Page</button>
        <button class="btn btn-primary preview-view-btn" data-id="${image.id}">View</button>
        <button class="btn btn-primary preview-danbooru-btn" data-id="${image.id}">Upload to Danbooru</button>
      </div>
    </div>
  `;

  // Attach event listeners
  const downloadBtn = container.querySelector('.preview-download-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => handleDownload({ target: downloadBtn } as any));
  }
  const viewPageBtn = container.querySelector('.preview-view-page-btn');
  if (viewPageBtn) {
    viewPageBtn.addEventListener('click', () => handleViewPage({ target: viewPageBtn } as any));
  }
  const viewBtn = container.querySelector('.preview-view-btn');
  if (viewBtn) {
    viewBtn.addEventListener('click', () => {
      const index = state.filteredImages.findIndex(img => img.id === image.id);
      if (index !== -1) openLightbox(index);
    });
  }
  const danbooruBtn = container.querySelector('.preview-danbooru-btn');
  if (danbooruBtn) {
    danbooruBtn.addEventListener('click', () => openDanbooruUploadModal(image.id));
  }
}

function renderMultiPreview(images: SavedImage[], container: HTMLElement) {
  const count = images.length;
  const thumbnails = images.map(image => {
    const url = getOrCreateObjectURL(image);
    return `
      <div class="preview-thumbnail" data-id="${image.id}">
        <img src="${url}" alt="Thumbnail">
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="preview-multi">
      <div class="preview-multi-header">
        <span class="preview-multi-count">${count} items selected</span>
      </div>
      <div class="preview-thumbnails">
        ${thumbnails}
      </div>
    </div>
  `;

  // Attach click handlers to thumbnails
  const thumbElements = container.querySelectorAll('.preview-thumbnail');
  thumbElements.forEach(thumb => {
    thumb.addEventListener('click', () => {
      const id = thumb.getAttribute('data-id')!;
      const index = state.filteredImages.findIndex(img => img.id === id);
      if (index !== -1) openLightbox(index);
    });
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return 'Unknown';
  }
}

function groupImagesByDomain(images: SavedImage[]): Map<string, SavedImage[]> {
  const groups = new Map<string, SavedImage[]>();

  for (const image of images) {
    const domain = getDomainFromUrl(image.pageUrl);
    if (!groups.has(domain)) {
      groups.set(domain, []);
    }
    groups.get(domain)!.push(image);
  }

  return groups;
}

function groupImagesByDuplicates(images: SavedImage[]): Map<string, SavedImage[]> {
  const groups = new Map<string, SavedImage[]>();

  for (const image of images) {
    // Group by dimensions AND file size
    const key = `${image.width}×${image.height}-${image.fileSize}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(image);
  }

  // Only return groups with 2+ images (actual duplicates)
  const duplicates = new Map<string, SavedImage[]>();
  for (const [key, groupImages] of groups) {
    if (groupImages.length >= 2) {
      duplicates.set(key, groupImages);
    }
  }

  return duplicates;
}

function renderGroupedImages(images: SavedImage[]) {
  const grid = document.getElementById('image-grid')!;
  const groups = groupImagesByDomain(images);
  const sortedDomains = Array.from(groups.keys()).sort();

  let html = '';
  for (const domain of sortedDomains) {
    const groupImages = groups.get(domain)!;
    const count = groupImages.length;

    html += `
      <div class="group-section">
        <div class="group-header">
          <h3 class="group-title">${domain}</h3>
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
}

function renderDuplicateGroups(images: SavedImage[]) {
  const grid = document.getElementById('image-grid')!;
  const groups = groupImagesByDuplicates(images);

  if (groups.size === 0) {
    grid.innerHTML = '<div class="empty-state" style="display: block;"><p>No duplicates found</p></div>';
    return;
  }

  const sortedKeys = Array.from(groups.keys()).sort();

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
}

function handleImageClick(e: Event) {
  const imageCard = (e.target as HTMLElement).closest('.image-card');
  if (!imageCard) return;

  const id = imageCard.getAttribute('data-id')!;
  const index = state.filteredImages.findIndex(img => img.id === id);
  if (index !== -1) {
    openLightbox(index);
  }
}

function openLightbox(index: number) {
  const image = state.filteredImages[index];
  if (!image) return;

  state.currentLightboxIndex = index;
  state.lightboxActive = true;

  updateLightboxContent(image);

  const lightbox = document.getElementById('lightbox')!;
  lightbox.classList.add('active');
}

function updateLightboxContent(image: SavedImage) {
  const lightboxImage = document.getElementById('lightbox-image') as HTMLImageElement;
  const url = getOrCreateObjectURL(image);
  lightboxImage.src = url;

  updateLightboxMetadata(image);
}

function updateLightboxMetadata(image: SavedImage) {
  const metadata = document.querySelector('.lightbox-metadata');
  if (!metadata) return;

  const date = new Date(image.savedAt).toLocaleString();
  const fileSize = formatFileSize(image.fileSize);

  const tagsValue = image.tags && image.tags.length > 0
    ? image.tags.map(tag => `<span class="tag">${tag}</span>`).join('')
    : '<span class="no-tags">No tags</span>';

  metadata.innerHTML = `
    <h3>Image Details</h3>
    <div class="metadata-row">
      <span class="metadata-label">Dimensions:</span>
      <span class="metadata-value">${image.width} × ${image.height}</span>
    </div>
    <div class="metadata-row">
      <span class="metadata-label">File Size:</span>
      <span class="metadata-value">${fileSize}</span>
    </div>
    <div class="metadata-row">
      <span class="metadata-label">Type:</span>
      <span class="metadata-value">${image.mimeType}</span>
    </div>
    <div class="metadata-row">
      <span class="metadata-label">Saved:</span>
      <span class="metadata-value">${date}</span>
    </div>
    <div class="metadata-row">
      <span class="metadata-label">Page:</span>
      <span class="metadata-value" title="${image.pageUrl}">${image.pageTitle || image.pageUrl}</span>
    </div>
    <div class="metadata-row">
      <div class="lightbox-actions">
        <button class="btn btn-secondary download-btn lightbox-download-btn" data-id="${image.id}">Download</button>
        <button class="btn btn-primary view-page-btn lightbox-view-page-btn" data-id="${image.id}">View Page</button>
        <button class="btn btn-primary view-btn lightbox-view-original-btn" data-id="${image.id}">View Original</button>
      </div>
    </div>
    <div class="metadata-row">
      <span class="metadata-label">Tags:</span>
      <div class="metadata-tags">${tagsValue}</div>
    </div>
    <div class="metadata-row">
      <div class="tag-input-container">
        <input type="text" id="lightbox-tag-input" class="tag-input" placeholder="Add tags (space-separated)..." value="${image.tags ? image.tags.join(' ') : ''}">
        <div id="tag-autocomplete" class="tag-autocomplete"></div>
      </div>
      <button class="btn btn-primary save-tags-btn" data-id="${image.id}">Save Tags</button>
    </div>
  `;

  // Attach event listener for save tags button
  const saveBtn = metadata.querySelector('.save-tags-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', handleSaveTags);
  }

  // Attach event listeners for action buttons
  const downloadBtn = metadata.querySelector('.lightbox-download-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => handleDownload({ target: downloadBtn } as any));
  }
  const viewPageBtn = metadata.querySelector('.lightbox-view-page-btn');
  if (viewPageBtn) {
    viewPageBtn.addEventListener('click', () => handleViewPage({ target: viewPageBtn } as any));
  }
  const viewOriginalBtn = metadata.querySelector('.lightbox-view-original-btn');
  if (viewOriginalBtn) {
    viewOriginalBtn.addEventListener('click', () => handleViewOriginal({ target: viewOriginalBtn } as any));
  }

  // Setup tag autocomplete
  const input = document.getElementById('lightbox-tag-input') as HTMLInputElement;
  if (input) {
    setupTagAutocomplete(input);
  }
}

function setupTagAutocomplete(input: HTMLInputElement, autocompleteId?: string, customTags?: string[]) {
  const divId = autocompleteId || 'tag-autocomplete';
  const autocompleteDiv = document.getElementById(divId);
  if (!autocompleteDiv) return;

  // Remove existing event listeners by aborting previous controller
  const controllerKey = `autocomplete_controller_${divId}`;
  if ((input as any)[controllerKey]) {
    (input as any)[controllerKey].abort();
  }
  const controller = new AbortController();
  (input as any)[controllerKey] = controller;
  const signal = controller.signal;

  // Use custom tags if provided, otherwise collect all unique tags
  let availableTags: string[];
  if (customTags) {
    availableTags = customTags.sort();
  } else {
    const allTags = new Set<string>();
    state.images.forEach(img => {
      if (img.tags && img.tags.length > 0) {
        img.tags.forEach(tag => allTags.add(tag));
      }
    });
    availableTags = Array.from(allTags).sort();
  }

  let selectedIndex = -1;
  let currentMatches: string[] = [];
  let blurTimeout: number | null = null;

  function showSuggestions() {
    const value = input.value;
    const cursorPos = input.selectionStart || 0;

    // Find the current tag being typed
    const beforeCursor = value.substring(0, cursorPos);
    const lastSpaceIndex = beforeCursor.lastIndexOf(' ');
    const currentTag = beforeCursor.substring(lastSpaceIndex + 1).trim();

    // Get already-entered tags to exclude them from suggestions
    const enteredTags = value
      .split(/\s+/)
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);

    // Filter matching tags (show all if empty, or filter by prefix)
    // Also exclude tags that are already entered
    currentMatches = availableTags.filter(tag => {
      // Exclude already-entered tags
      if (enteredTags.includes(tag.toLowerCase())) return false;

      if (currentTag.length === 0) return true;
      return tag.toLowerCase().startsWith(currentTag.toLowerCase()) &&
             tag.toLowerCase() !== currentTag.toLowerCase();
    });

    if (currentMatches.length === 0) {
      autocompleteDiv.style.display = 'none';
      return;
    }

    selectedIndex = -1;
    renderSuggestions();
    autocompleteDiv.style.display = 'block';
  }

  function renderSuggestions() {
    autocompleteDiv.innerHTML = currentMatches.slice(0, 8).map((tag, index) =>
      `<div class="tag-suggestion ${index === selectedIndex ? 'selected' : ''}" data-tag="${tag}" data-index="${index}">${tag}</div>`
    ).join('');

    // Attach click handlers
    autocompleteDiv.querySelectorAll('.tag-suggestion').forEach(suggestionEl => {
      suggestionEl.addEventListener('click', () => {
        const selectedTag = suggestionEl.getAttribute('data-tag')!;
        insertTag(selectedTag);
      });
    });
  }

  function insertTag(tag: string) {
    // Clear any pending blur timeout
    if (blurTimeout !== null) {
      clearTimeout(blurTimeout);
      blurTimeout = null;
    }

    const value = input.value;
    const cursorPos = input.selectionStart || 0;
    const beforeCursor = value.substring(0, cursorPos);
    const lastSpaceIndex = beforeCursor.lastIndexOf(' ');
    const beforeTag = value.substring(0, lastSpaceIndex + 1);
    const afterCursor = value.substring(cursorPos);
    const nextSpaceOrEnd = afterCursor.indexOf(' ');
    const afterTag = nextSpaceOrEnd >= 0 ? afterCursor.substring(nextSpaceOrEnd) : '';

    input.value = beforeTag + tag + ' ';
    input.focus();

    // Move cursor after the inserted tag
    const newCursorPos = beforeTag.length + tag.length + 1;
    input.setSelectionRange(newCursorPos, newCursorPos);

    // Re-show autocomplete with remaining tags
    showSuggestions();
  }

  input.addEventListener('input', showSuggestions, { signal });
  input.addEventListener('focus', showSuggestions, { signal });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (autocompleteDiv.style.display !== 'block') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, Math.min(currentMatches.length, 8) - 1);
      renderSuggestions();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      renderSuggestions();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (selectedIndex >= 0 && selectedIndex < currentMatches.length) {
        e.preventDefault();
        insertTag(currentMatches[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      autocompleteDiv.style.display = 'none';
      selectedIndex = -1;
    }
  }, { signal });

  // Hide autocomplete when clicking outside
  input.addEventListener('blur', () => {
    blurTimeout = window.setTimeout(() => {
      autocompleteDiv.style.display = 'none';
      selectedIndex = -1;
      blurTimeout = null;
    }, 200);
  }, { signal });

  // Clear timeout and keep open when refocusing
  input.addEventListener('focus', () => {
    if (blurTimeout !== null) {
      clearTimeout(blurTimeout);
      blurTimeout = null;
    }
  }, { signal });
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox')!;
  lightbox.classList.remove('active');
  state.lightboxActive = false;
  state.currentLightboxIndex = -1;
}

function navigateLightboxByOffset(offset: number) {
  const newIndex = state.currentLightboxIndex + offset;
  if (newIndex >= 0 && newIndex < state.filteredImages.length) {
    state.currentLightboxIndex = newIndex;
    const currentImage = state.filteredImages[state.currentLightboxIndex];

    // Update lightbox
    updateLightboxContent(currentImage);

    // Update selection to match current preview (like macOS)
    state.selectedIds.clear();
    state.selectedIds.add(currentImage.id);
    state.lastSelectedIndex = state.currentLightboxIndex;
    state.selectionAnchor = state.currentLightboxIndex;

    // Sync grid UI
    updateAllCheckboxes();
    updateSelectionCount();
    updatePreviewPane();
  }
}

function navigateNext() {
  navigateLightboxByOffset(1);
}

function navigatePrevious() {
  navigateLightboxByOffset(-1);
}

function getGridColumns(): number {
  const grid = document.getElementById('image-grid')!;
  const viewMode = grid.className;

  // In list view, treat as 1 column (vertical navigation)
  if (viewMode.includes('list')) {
    return 1;
  }

  // Get computed style to find grid column count
  const gridStyle = window.getComputedStyle(grid);
  const gridTemplateColumns = gridStyle.gridTemplateColumns;

  // Count the number of column definitions
  if (gridTemplateColumns && gridTemplateColumns !== 'none') {
    const columns = gridTemplateColumns.split(' ').length;
    return columns;
  }

  // Fallback: estimate based on view mode
  if (viewMode.includes('compact')) {
    return 6; // Approximate for compact view
  }
  return 4; // Approximate for normal grid view
}

function navigateGridByOffset(offset: number) {
  if (state.filteredImages.length === 0) return;

  let currentIndex = state.lastSelectedIndex;
  if (currentIndex === -1) {
    if (state.selectedIds.size === 1) {
      const selectedId = Array.from(state.selectedIds)[0];
      currentIndex = state.filteredImages.findIndex(img => img.id === selectedId);
    } else {
      currentIndex = 0; // Start from beginning
    }
  }

  const newIndex = currentIndex + offset;
  const clampedIndex = Math.max(0, Math.min(newIndex, state.filteredImages.length - 1));

  if (clampedIndex !== currentIndex) {
    const newImage = state.filteredImages[clampedIndex];
    state.selectedIds.clear();
    state.selectedIds.add(newImage.id);
    state.lastSelectedIndex = clampedIndex;
    state.selectionAnchor = clampedIndex;

    updateAllCheckboxes();
    updateSelectionCount();
    updatePreviewPane();
    scrollToImage(newImage.id);
  }
}

function navigateGridByOffsetExpand(offset: number) {
  if (state.filteredImages.length === 0) return;

  // If nothing selected, select first item and set as anchor
  if (state.selectedIds.size === 0 || state.selectionAnchor === -1) {
    const firstImage = state.filteredImages[0];
    state.selectedIds.clear();
    state.selectedIds.add(firstImage.id);
    state.lastSelectedIndex = 0;
    state.selectionAnchor = 0;
    updateAllCheckboxes();
    updateSelectionCount();
    updatePreviewPane();
    scrollToImage(firstImage.id);
    return;
  }

  // Move focus by offset
  const newFocus = state.lastSelectedIndex + offset;
  const clampedFocus = Math.max(0, Math.min(newFocus, state.filteredImages.length - 1));

  if (clampedFocus !== state.lastSelectedIndex) {
    state.lastSelectedIndex = clampedFocus;

    // Select range from anchor to new focus
    state.selectedIds.clear();
    const start = Math.min(state.selectionAnchor, clampedFocus);
    const end = Math.max(state.selectionAnchor, clampedFocus);
    for (let i = start; i <= end; i++) {
      state.selectedIds.add(state.filteredImages[i].id);
    }

    updateAllCheckboxes();
    updateSelectionCount();
    updatePreviewPane();
    scrollToImage(state.filteredImages[clampedFocus].id);
  }
}

function updateAllCheckboxes() {
  const allCheckboxes = document.querySelectorAll('.image-checkbox') as NodeListOf<HTMLInputElement>;
  allCheckboxes.forEach(cb => {
    const cbId = cb.dataset.id!;
    cb.checked = state.selectedIds.has(cbId);
    updateImageCard(cbId);
  });
}

function scrollToImage(id: string) {
  const card = document.querySelector(`.image-card[data-id="${id}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function handleSearch(e: Event) {
  applyFilters();
}

document.getElementById('search-input')!.addEventListener('input', handleSearch);

// Event delegation for image grid
const imageGrid = document.getElementById('image-grid')!;

imageGrid.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  const mouseEvent = e as MouseEvent;

  // Prevent default text selection on shift-click
  if (mouseEvent.shiftKey) {
    mouseEvent.preventDefault();
  }

  // Handle specific elements first (priority order)

  // 1. Action buttons
  if (target.matches('.download-btn') || target.closest('.download-btn')) {
    const btn = target.matches('.download-btn') ? target : target.closest('.download-btn');
    if (btn) handleDownload(e);
    return;
  }
  if (target.matches('.view-btn') || target.closest('.view-btn')) {
    const btn = target.matches('.view-btn') ? target : target.closest('.view-btn');
    if (btn) handleViewOriginal(e);
    return;
  }
  if (target.matches('.view-page-btn') || target.closest('.view-page-btn')) {
    const btn = target.matches('.view-page-btn') ? target : target.closest('.view-page-btn');
    if (btn) handleViewPage(e);
    return;
  }
  if (target.matches('.delete-btn') || target.closest('.delete-btn')) {
    const btn = target.matches('.delete-btn') ? target : target.closest('.delete-btn');
    if (btn) handleDelete(e);
    return;
  }
  if (target.matches('.restore-btn') || target.closest('.restore-btn')) {
    const btn = target.matches('.restore-btn') ? target : target.closest('.restore-btn');
    if (btn) handleRestore(e);
    return;
  }
  if (target.matches('.permanent-delete-btn') || target.closest('.permanent-delete-btn')) {
    const btn = target.matches('.permanent-delete-btn') ? target : target.closest('.permanent-delete-btn');
    if (btn) handlePermanentDelete(e);
    return;
  }

  // 2. Image preview (opens lightbox)
  if (target.matches('.image-preview')) {
    handleImageClick(e);
    return;
  }

  // 3. Checkbox (let the change event handle it)
  if (target.matches('.image-checkbox')) {
    return;
  }

  // 4. Anywhere else on the card → handle selection based on modifier keys
  const card = target.closest('.image-card');
  if (card) {
    const id = card.getAttribute('data-id')!;
    const clickedIndex = state.filteredImages.findIndex(img => img.id === id);

    if (mouseEvent.metaKey || mouseEvent.ctrlKey) {
      // Cmd/Ctrl + Click: Toggle item in selection
      if (state.selectedIds.has(id)) {
        state.selectedIds.delete(id);
      } else {
        state.selectedIds.add(id);
      }
      state.lastSelectedIndex = clickedIndex;
      state.selectionAnchor = clickedIndex;
    } else if (mouseEvent.shiftKey && state.selectionAnchor !== -1) {
      // Shift + Click: Select range from anchor to current
      const start = Math.min(state.selectionAnchor, clickedIndex);
      const end = Math.max(state.selectionAnchor, clickedIndex);

      state.selectedIds.clear();
      for (let i = start; i <= end; i++) {
        state.selectedIds.add(state.filteredImages[i].id);
      }
      state.lastSelectedIndex = clickedIndex;
    } else {
      // Normal click: Single-select (clear others, select this one)
      state.selectedIds.clear();
      state.selectedIds.add(id);
      state.lastSelectedIndex = clickedIndex;
      state.selectionAnchor = clickedIndex;
    }

    updateAllCheckboxes();
    updateSelectionCount();
    updatePreviewPane();
  }
});

imageGrid.addEventListener('change', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.matches('.image-checkbox')) {
    handleCheckboxChange(e);
  }
});

// Dump buttons (export selected images as ZIP)
document.getElementById('dump-all-btn')!.addEventListener('click', async () => {
  const { dumpImages } = await import('./dump');
  await dumpImages(state.images);
});

document.getElementById('dump-selected-btn')!.addEventListener('click', async () => {
  if (state.selectedIds.size === 0) return;

  const selectedImages = state.images.filter(img => state.selectedIds.has(img.id));
  const { dumpImages } = await import('./dump');
  await dumpImages(selectedImages);
});

document.getElementById('select-all-btn')!.addEventListener('click', () => {
  // Only select currently visible/filtered images
  state.filteredImages.forEach(image => {
    state.selectedIds.add(image.id);
  });
  applyFilters();
  updateSelectionCount();
  updatePreviewPane();
});

document.getElementById('deselect-all-btn')!.addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.image-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
  state.selectedIds.clear();
  applyFilters();
  updateSelectionCount();
  updatePreviewPane();
});

document.getElementById('restore-selected-btn')!.addEventListener('click', async () => {
  const count = state.selectedIds.size;
  if (count === 0) return;

  for (const id of state.selectedIds) {
    await restoreImage(id);
  }
  state.selectedIds.clear();
  updateSelectionCount();
  await loadImages();
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
});

document.getElementById('delete-selected-btn')!.addEventListener('click', async () => {
  const count = state.selectedIds.size;
  if (count === 0) return;

  for (const id of state.selectedIds) {
    await deleteImage(id);
  }
  state.selectedIds.clear();
  updateSelectionCount();
  await loadImages();
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
});

document.getElementById('delete-all-btn')!.addEventListener('click', async () => {
  const count = state.filteredImages.length;
  if (count === 0) return;

  await deleteAllImages();
  state.selectedIds.clear();
  await loadImages();
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'IMAGE_SAVED') {
    loadImages();
  }
});

// View mode switching
const grid = document.getElementById('image-grid')!;
const viewModeBtns = document.querySelectorAll('.view-mode-btn');

function setViewMode(mode: 'grid' | 'compact' | 'list') {
  if (mode === 'grid') {
    grid.className = 'image-grid';
  } else {
    grid.className = `image-grid ${mode}`;
  }

  viewModeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === mode);
  });

  localStorage.setItem('viewMode', mode);
}

viewModeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-view') as 'grid' | 'compact' | 'list';
    setViewMode(mode);
  });
});

// Load saved view mode
const savedViewMode = localStorage.getItem('viewMode') as 'grid' | 'compact' | 'list' | null;
if (savedViewMode) {
  setViewMode(savedViewMode);
}

// Type filter
const typeFilter = document.getElementById('type-filter') as HTMLSelectElement;

typeFilter.addEventListener('change', () => {
  state.typeFilter = typeFilter.value;
  applyFilters();
});

// Tag filter
const tagFilter = document.getElementById('tag-filter') as HTMLSelectElement;

tagFilter.addEventListener('change', () => {
  const selectedTag = tagFilter.value;
  if (selectedTag && !state.tagFilters.has(selectedTag)) {
    // Uncheck "Untagged only" when selecting a tag (mutually exclusive)
    state.showUntaggedOnly = false;
    untaggedOnlyCheckbox.checked = false;

    state.tagFilters.add(selectedTag);
    updateTagFilterOptions();
    renderSelectedTags();
    applyFilters();
  }
});

// Tag filter mode toggle
const tagFilterModeBtn = document.getElementById('tag-filter-mode')!;

tagFilterModeBtn.addEventListener('click', () => {
  state.tagFilterMode = state.tagFilterMode === 'union' ? 'intersection' : 'union';
  tagFilterModeBtn.textContent = state.tagFilterMode === 'union' ? 'OR' : 'AND';
  if (state.tagFilters.size > 0) {
    applyFilters();
  }
});

// Exclude tag filter
const excludeTagFilter = document.getElementById('exclude-tag-filter') as HTMLSelectElement;

excludeTagFilter.addEventListener('change', () => {
  const selectedTag = excludeTagFilter.value;
  if (selectedTag && !state.excludedTagFilters.has(selectedTag)) {
    state.excludedTagFilters.add(selectedTag);
    updateExcludeTagFilterOptions();
    renderExcludedTags();
    applyFilters();
  }
});

// Untagged-only filter
const untaggedOnlyCheckbox = document.getElementById('untagged-only-checkbox') as HTMLInputElement;

untaggedOnlyCheckbox.addEventListener('change', () => {
  state.showUntaggedOnly = untaggedOnlyCheckbox.checked;

  // Clear tag filters when "Untagged only" is checked (mutually exclusive)
  if (state.showUntaggedOnly) {
    state.tagFilters.clear();
    updateTagFilterOptions();
    renderSelectedTags();
  }

  applyFilters();
});

// Group by
const groupBySelect = document.getElementById('group-by') as HTMLSelectElement;

groupBySelect.addEventListener('change', () => {
  state.groupBy = groupBySelect.value;
  applyFilters();
});

// Sorting
const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;

sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  localStorage.setItem('sortBy', state.sort);
  applySorting();
  applyFilters();
});

// Load saved sort preference
const savedSort = localStorage.getItem('sortBy');
if (savedSort) {
  state.sort = savedSort;
  sortSelect.value = savedSort;
}

// Preview pane toggle
const previewPaneToggle = document.getElementById('preview-pane-toggle')!;
previewPaneToggle.addEventListener('click', togglePreviewPane);

const previewPaneClose = document.getElementById('preview-pane-close')!;
previewPaneClose.addEventListener('click', togglePreviewPane);

// Load saved preview pane visibility
const savedPreviewPaneVisible = localStorage.getItem('previewPaneVisible');
if (savedPreviewPaneVisible === 'true') {
  state.previewPaneVisible = true;
  const previewPane = document.getElementById('preview-pane')!;
  previewPane.classList.add('visible');
  document.body.classList.add('preview-pane-open');
}

// Lightbox controls
document.querySelector('.lightbox-close')!.addEventListener('click', closeLightbox);
document.querySelector('.lightbox-overlay')!.addEventListener('click', closeLightbox);

// Keyboard navigation
document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Don't intercept keyboard events when typing in input fields
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    // Allow Escape to close lightbox even when in input
    if (e.key === 'Escape' && state.lightboxActive) {
      e.preventDefault();
      closeLightbox();
    }
    return;
  }

  // Lightbox navigation - same visual behavior as grid
  if (state.lightboxActive) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateNext();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigatePrevious();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const columns = getGridColumns();
      navigateLightboxByOffset(columns);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const columns = getGridColumns();
      navigateLightboxByOffset(-columns);
    } else if (e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      closeLightbox();
    }
    return;
  }

  // Space key: toggle full-size preview for selected item
  if (e.key === ' ') {
    e.preventDefault();
    if (state.selectedIds.size === 1) {
      const selectedId = Array.from(state.selectedIds)[0];
      const index = state.filteredImages.findIndex(img => img.id === selectedId);
      if (index !== -1) {
        openLightbox(index);
      }
    }
    return;
  }

  // Grid navigation with arrow keys
  if (state.filteredImages.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const columns = getGridColumns();
      if (e.shiftKey) {
        navigateGridByOffsetExpand(columns);
      } else {
        navigateGridByOffset(columns);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const columns = getGridColumns();
      if (e.shiftKey) {
        navigateGridByOffsetExpand(-columns);
      } else {
        navigateGridByOffset(-columns);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) {
        navigateGridByOffsetExpand(1);
      } else {
        navigateGridByOffset(1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) {
        navigateGridByOffsetExpand(-1);
      } else {
        navigateGridByOffset(-1);
      }
    }
  }
});

// Settings panel toggle
const settingsBtn = document.getElementById('settings-btn')!;
const settingsPanel = document.getElementById('settings-panel')!;

settingsBtn.addEventListener('click', () => {
  const isVisible = settingsPanel.style.display !== 'none';
  settingsPanel.style.display = isVisible ? 'none' : 'block';
});

// Settings initialization and handling
const showNotificationsToggle = document.getElementById('show-notifications-toggle') as HTMLInputElement;

loadSettings().then(settings => {
  showNotificationsToggle.checked = settings.showNotifications;
});

showNotificationsToggle.addEventListener('change', async () => {
  await saveSettings({ showNotifications: showNotificationsToggle.checked });
});

// View toggle (All Images / Trash)
const allImagesBtn = document.getElementById('all-images-btn')!;
const trashBtn = document.getElementById('trash-btn')!;
const emptyTrashBtn = document.getElementById('empty-trash-btn')!;
const deleteAllBtn = document.getElementById('delete-all-btn')!;
const dumpAllBtn = document.getElementById('dump-all-btn')!;
const restoreSelectedBtn = document.getElementById('restore-selected-btn')!;
const deleteSelectedBtn = document.getElementById('delete-selected-btn')!;
const dumpSelectedBtn = document.getElementById('dump-selected-btn')!;

function switchView(view: 'all' | 'trash') {
  state.currentView = view;
  state.selectedIds.clear();

  // Update button states
  allImagesBtn.classList.toggle('active', view === 'all');
  trashBtn.classList.toggle('active', view === 'trash');

  // Show/hide appropriate buttons
  if (view === 'trash') {
    emptyTrashBtn.style.display = 'inline-block';
    restoreSelectedBtn.style.display = 'inline-block';
    deleteAllBtn.style.display = 'none';
    dumpAllBtn.style.display = 'none';
    deleteSelectedBtn.style.display = 'none';
    dumpSelectedBtn.style.display = 'none';
  } else {
    emptyTrashBtn.style.display = 'none';
    restoreSelectedBtn.style.display = 'none';
    deleteAllBtn.style.display = 'inline-block';
    dumpAllBtn.style.display = 'inline-block';
    deleteSelectedBtn.style.display = 'inline-block';
    dumpSelectedBtn.style.display = 'inline-block';
  }

  applyFilters();
}

allImagesBtn.addEventListener('click', () => switchView('all'));
trashBtn.addEventListener('click', () => switchView('trash'));

// Empty trash
emptyTrashBtn.addEventListener('click', async () => {
  const trashedCount = state.images.filter(img => img.isDeleted).length;
  if (trashedCount === 0) return;

  const confirmed = confirm(`Are you sure you want to permanently delete all ${trashedCount} image${trashedCount !== 1 ? 's' : ''} in trash? This cannot be undone.`);
  if (confirmed) {
    await emptyTrash();
    await loadImages();
  }
});

// Bulk tagging modal
const bulkTagModal = document.getElementById('bulk-tag-modal')!;
const bulkTagSelectedBtn = document.getElementById('tag-selected-btn')!;
const bulkTagCloseBtn = document.querySelector('.bulk-tag-close')!;
const bulkTagOverlay = document.querySelector('.bulk-tag-overlay')!;
const bulkTagCancelBtn = document.getElementById('bulk-tag-cancel-btn')!;
const bulkTagSaveBtn = document.getElementById('bulk-tag-save-btn')!;
const bulkAddTagsInput = document.getElementById('bulk-add-tags-input') as HTMLInputElement;
const bulkRemoveTagsInput = document.getElementById('bulk-remove-tags-input') as HTMLInputElement;

function openBulkTagModal() {
  if (state.selectedIds.size === 0) return;

  bulkAddTagsInput.value = '';
  bulkRemoveTagsInput.value = '';

  bulkTagModal.classList.add('active');

  // Setup autocomplete for add input (all tags)
  setupTagAutocomplete(bulkAddTagsInput, 'bulk-add-autocomplete');

  // Setup autocomplete for remove input (only tags from selected images)
  const selectedImages = state.images.filter(img => state.selectedIds.has(img.id));
  const selectedImageTags = new Set<string>();
  selectedImages.forEach(img => {
    if (img.tags && img.tags.length > 0) {
      img.tags.forEach(tag => selectedImageTags.add(tag));
    }
  });
  const selectedImageTagsArray = Array.from(selectedImageTags);
  setupTagAutocomplete(bulkRemoveTagsInput, 'bulk-remove-autocomplete', selectedImageTagsArray);

  // Focus the first input
  bulkAddTagsInput.focus();
}

function closeBulkTagModal() {
  bulkTagModal.classList.remove('active');
}

async function saveBulkTags() {
  if (state.selectedIds.size === 0) {
    closeBulkTagModal();
    return;
  }

  const selectedImageIds = Array.from(state.selectedIds);

  // Parse add tags
  const addTagsString = bulkAddTagsInput.value.trim();
  const tagsToAdd = addTagsString
    ? addTagsString.split(/\s+/).filter(tag => tag.length > 0)
    : [];

  // Parse remove tags
  const removeTagsString = bulkRemoveTagsInput.value.trim();
  const tagsToRemove = removeTagsString
    ? removeTagsString.split(/\s+/).filter(tag => tag.length > 0)
    : [];

  // Remove duplicates
  const uniqueTagsToAdd = Array.from(new Set(tagsToAdd));
  const uniqueTagsToRemove = Array.from(new Set(tagsToRemove));

  // Apply operations
  if (uniqueTagsToAdd.length > 0) {
    await addTagsToImages(selectedImageIds, uniqueTagsToAdd);
  }

  if (uniqueTagsToRemove.length > 0) {
    await removeTagsFromImages(selectedImageIds, uniqueTagsToRemove);
  }

  // Reload images and close modal
  await loadImages();
  updatePreviewPane();
  closeBulkTagModal();
}

bulkTagSelectedBtn.addEventListener('click', openBulkTagModal);
bulkTagCloseBtn.addEventListener('click', closeBulkTagModal);
bulkTagOverlay.addEventListener('click', closeBulkTagModal);
bulkTagCancelBtn.addEventListener('click', closeBulkTagModal);
bulkTagSaveBtn.addEventListener('click', saveBulkTags);

// Handle Enter key in bulk tag inputs
bulkAddTagsInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    const autocompleteDiv = document.getElementById('bulk-add-autocomplete');
    if (!autocompleteDiv || autocompleteDiv.style.display !== 'block') {
      e.preventDefault();
      saveBulkTags();
    }
  }
});

bulkRemoveTagsInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    const autocompleteDiv = document.getElementById('bulk-remove-autocomplete');
    if (!autocompleteDiv || autocompleteDiv.style.display !== 'block') {
      e.preventDefault();
      saveBulkTags();
    }
  }
});

// Database Import/Export handlers
document.getElementById('export-database-btn')!.addEventListener('click', async () => {
  try {
    const { exportDatabase } = await import('../storage/sqlite-import-export');
    const blob = await exportDatabase(state.images);
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `image-storage-backup-${Date.now()}.db`;
    a.click();

    URL.revokeObjectURL(url);

    alert(`Database exported successfully!\n${state.images.length} images backed up.`);
  } catch (error) {
    console.error('Export failed:', error);
    alert('Export failed. See console for details.');
  }
});

document.getElementById('import-database-btn')!.addEventListener('click', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.db,.sqlite,.sqlite3';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const { analyzeImport, closeImportDatabase } = await import('../storage/sqlite-import-export');
      const analysis = await analyzeImport(file, state.images);

      if (analysis.totalCount === 0) {
        closeImportDatabase(analysis.db);
        alert('No images found in the database file.');
        return;
      }

      if (analysis.conflictCount === 0) {
        // No conflicts, direct import
        const confirmed = window.confirm(
          `Import ${analysis.newCount} new images?`
        );
        if (!confirmed) {
          closeImportDatabase(analysis.db);
          return;
        }

        const { importDatabase } = await import('../storage/sqlite-import-export');
        const importedImages = await importDatabase(file, 'skip');
        closeImportDatabase(analysis.db);
        await importImagesToIndexedDB(importedImages);
        await loadImages();

        alert(`Import complete!\n${analysis.newCount} images added.`);
      } else {
        // Show conflict resolution modal (db will be closed by modal handlers)
        showImportConflictModal(file, analysis);
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed. See console for details.');
    }
  };

  input.click();
});

// Helper to import SavedImages to IndexedDB
async function importImagesToIndexedDB(images: SavedImage[]) {
  const { imageDB } = await import('../storage/db');
  for (const image of images) {
    await imageDB.update(image);  // Uses put() which inserts or updates
  }
}

// Import conflict modal handlers
function showImportConflictModal(file: File, analysis: any) {
  const modal = document.getElementById('import-conflict-modal')!;
  const summary = document.getElementById('import-conflict-summary')!;

  summary.textContent = `Found ${analysis.totalCount} images in backup:\n• ${analysis.newCount} new images\n• ${analysis.conflictCount} conflicts (same image ID exists)`;

  modal.classList.add('active');

  // Store for handlers (including db for blob fetching)
  (modal as any).__importData = { file, analysis };
}

async function closeImportConflictModal() {
  const modal = document.getElementById('import-conflict-modal')!;
  const importData = (modal as any).__importData;

  // Close the database if it exists
  if (importData?.analysis?.db) {
    const { closeImportDatabase } = await import('../storage/sqlite-import-export');
    closeImportDatabase(importData.analysis.db);
  }

  modal.classList.remove('active');
}

document.getElementById('import-skip-all-btn')!.addEventListener('click', async () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { file, analysis } = (modal as any).__importData;

  modal.classList.remove('active');

  try {
    const { importDatabase, closeImportDatabase } = await import('../storage/sqlite-import-export');
    const importedImages = await importDatabase(file, 'skip');
    closeImportDatabase(analysis.db);

    // Filter out conflicts (only import new images)
    const existingIds = new Set(state.images.map(img => img.id));
    const newImages = importedImages.filter(img => !existingIds.has(img.id));

    await importImagesToIndexedDB(newImages);
    await loadImages();

    alert(`Import complete!\n${analysis.newCount} new images added.\n${analysis.conflictCount} conflicts skipped.`);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Import failed. See console for details.');
  }
});

document.getElementById('import-override-all-btn')!.addEventListener('click', async () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { file, analysis } = (modal as any).__importData;

  const confirmed = window.confirm(
    `This will override ${analysis.conflictCount} existing images. Continue?`
  );
  if (!confirmed) return;

  modal.classList.remove('active');

  try {
    const { importDatabase, closeImportDatabase } = await import('../storage/sqlite-import-export');
    const importedImages = await importDatabase(file, 'override');
    closeImportDatabase(analysis.db);
    await importImagesToIndexedDB(importedImages);
    await loadImages();

    alert(`Import complete!\n${analysis.newCount} new images added.\n${analysis.conflictCount} images overridden.`);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Import failed. See console for details.');
  }
});

document.getElementById('import-review-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { file, analysis } = (modal as any).__importData;

  modal.classList.remove('active');
  showImportReviewModal(file, analysis.db, analysis.conflicts, 0);
});

document.getElementById('import-cancel-btn')!.addEventListener('click', closeImportConflictModal);
document.querySelector('.import-conflict-close')!.addEventListener('click', closeImportConflictModal);

// Import review modal (granular control)
async function showImportReviewModal(file: File, db: any, conflicts: any[], index: number) {
  const modal = document.getElementById('import-review-modal')!;
  const progress = document.getElementById('import-review-progress')!;
  const existingPreview = document.getElementById('import-existing-preview')!;
  const importedPreview = document.getElementById('import-imported-preview')!;

  progress.textContent = `Conflict ${index + 1} of ${conflicts.length}`;

  const conflict = conflicts[index];

  // Render existing image preview
  const existingUrl = getOrCreateObjectURL(conflict.existingImage);
  const existingDate = new Date(conflict.existingImage.savedAt).toLocaleString();
  const existingTags = conflict.existingImage.tags?.join(', ') || 'None';
  existingPreview.innerHTML = `
    <img src="${existingUrl}" alt="Existing" style="max-width: 100%; margin-bottom: 10px;">
    <div><strong>Saved:</strong> ${existingDate}</div>
    <div><strong>Size:</strong> ${formatFileSize(conflict.existingImage.fileSize)}</div>
    <div><strong>Dimensions:</strong> ${conflict.existingImage.width} × ${conflict.existingImage.height}</div>
    <div><strong>Type:</strong> ${conflict.existingImage.mimeType}</div>
    <div><strong>Tags:</strong> ${existingTags}</div>
    <div style="margin-top: 8px; font-size: 0.85em; color: #666; word-break: break-all;"><strong>URL:</strong> ${conflict.existingImage.imageUrl}</div>
  `;

  // Fetch and render imported image preview
  const { getImageBlobFromDatabase, getImageMetadataFromDatabase } = await import('../storage/sqlite-import-export');
  const importedBlob = getImageBlobFromDatabase(db, conflict.id);
  const importedMetadata = getImageMetadataFromDatabase(db, conflict.id);

  const importedDate = new Date(conflict.importedMetadata.savedAt).toLocaleString();
  const importedTags = conflict.importedMetadata.tags?.join(', ') || 'None';

  if (importedBlob && importedMetadata) {
    const importedUrl = URL.createObjectURL(importedBlob);
    importedPreview.innerHTML = `
      <img src="${importedUrl}" alt="Imported" style="max-width: 100%; margin-bottom: 10px;">
      <div><strong>Saved:</strong> ${importedDate}</div>
      <div><strong>Size:</strong> ${formatFileSize(importedMetadata.fileSize)}</div>
      <div><strong>Dimensions:</strong> ${importedMetadata.width} × ${importedMetadata.height}</div>
      <div><strong>Type:</strong> ${importedMetadata.mimeType}</div>
      <div><strong>Tags:</strong> ${importedTags}</div>
      <div style="margin-top: 8px; font-size: 0.85em; color: #666; word-break: break-all;"><strong>URL:</strong> ${conflict.importedMetadata.imageUrl}</div>
    `;
  } else {
    importedPreview.innerHTML = `
      <div style="padding: 10px; background: #f0f0f0; margin-bottom: 10px;">Preview not available</div>
      <div><strong>Saved:</strong> ${importedDate}</div>
      <div><strong>Tags:</strong> ${importedTags}</div>
      <div style="margin-top: 8px; font-size: 0.85em; color: #666; word-break: break-all;"><strong>URL:</strong> ${conflict.importedMetadata.imageUrl}</div>
    `;
  }

  modal.classList.add('active');

  // Store for handlers
  (modal as any).__reviewData = { file, db, conflicts, index, decisions: new Map() };
}

async function closeImportReviewModal() {
  const modal = document.getElementById('import-review-modal')!;
  const reviewData = (modal as any).__reviewData;

  // Close the database if it exists
  if (reviewData?.db) {
    const { closeImportDatabase } = await import('../storage/sqlite-import-export');
    closeImportDatabase(reviewData.db);
  }

  modal.classList.remove('active');
}

document.getElementById('import-keep-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-review-modal')!;
  const { file, db, conflicts, index, decisions } = (modal as any).__reviewData;

  // Mark this conflict as "keep existing"
  decisions.set(conflicts[index].id, 'keep');

  // Move to next conflict or finish
  if (index + 1 < conflicts.length) {
    showImportReviewModal(file, db, conflicts, index + 1);
  } else {
    finishGranularImport(file, db, conflicts, decisions);
  }
});

document.getElementById('import-override-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-review-modal')!;
  const { file, db, conflicts, index, decisions } = (modal as any).__reviewData;

  // Mark this conflict as "override"
  decisions.set(conflicts[index].id, 'override');

  // Move to next conflict or finish
  if (index + 1 < conflicts.length) {
    showImportReviewModal(file, db, conflicts, index + 1);
  } else {
    finishGranularImport(file, db, conflicts, decisions);
  }
});

async function finishGranularImport(file: File, db: any, conflicts: any[], decisions: Map<string, 'keep' | 'override'>) {
  const modal = document.getElementById('import-review-modal')!;
  modal.classList.remove('active');

  try {
    const { importDatabase, closeImportDatabase } = await import('../storage/sqlite-import-export');
    const allImportedImages = await importDatabase(file, 'override');
    closeImportDatabase(db);

    // Filter based on decisions
    const existingIds = new Set(state.images.map(img => img.id));
    const imagesToImport = allImportedImages.filter(img => {
      if (!existingIds.has(img.id)) {
        // New image, always import
        return true;
      }
      // Conflict: check decision
      return decisions.get(img.id) === 'override';
    });

    await importImagesToIndexedDB(imagesToImport);
    await loadImages();

    const overrideCount = Array.from(decisions.values()).filter(d => d === 'override').length;
    const keepCount = conflicts.length - overrideCount;
    const newCount = allImportedImages.length - conflicts.length;

    alert(`Import complete!\n${newCount} new images added.\n${overrideCount} images overridden.\n${keepCount} conflicts skipped.`);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Import failed. See console for details.');
  }
}

document.getElementById('import-review-cancel-btn')!.addEventListener('click', closeImportReviewModal);
document.querySelector('.import-review-close')!.addEventListener('click', closeImportReviewModal);

// ============================================
// Danbooru Upload Feature
// ============================================
//
// Upload flow:
// 1. User clicks "Upload to Danbooru" in preview pane
// 2. Modal opens with auto-filled metadata (tags, artist, source)
// 3. User reviews/edits and clicks "Upload to Danbooru"
// 4. Create upload with image URL → Danbooru downloads the image
// 5. Poll upload status until processing completes
// 6. Create post with tags/rating/source using upload_media_asset_id
// 7. Add artist commentary (title/description) as separate API call
// 8. Show success toast
//
// API Endpoints:
// - POST /uploads.json - Create upload from URL
// - GET /uploads/{id}.json - Check upload status
// - POST /posts.json - Create post from media asset
// - PUT /posts/{id}/artist_commentary/create_or_update.json - Add commentary

// Constants
const DANBOORU_POLL_MAX_ATTEMPTS = 20; // 40 seconds total
const DANBOORU_POLL_DELAY_MS = 2000;

interface DanbooruSettings {
  danbooruUrl: string;
  danbooruUsername: string;
  danbooruApiKey: string;
}

async function loadDanbooruSettings(): Promise<DanbooruSettings> {
  const result = await chrome.storage.local.get(['danbooruUrl', 'danbooruUsername', 'danbooruApiKey']);
  return {
    danbooruUrl: result.danbooruUrl || '',
    danbooruUsername: result.danbooruUsername || '',
    danbooruApiKey: result.danbooruApiKey || '',
  };
}

async function saveDanbooruSettings(settings: DanbooruSettings) {
  await chrome.storage.local.set(settings);
}

// Load settings on page load
const danbooruUrlInput = document.getElementById('danbooru-url-input') as HTMLInputElement;
const danbooruUsernameInput = document.getElementById('danbooru-username-input') as HTMLInputElement;
const danbooruApiKeyInput = document.getElementById('danbooru-apikey-input') as HTMLInputElement;
const danbooruApiKeyToggle = document.getElementById('danbooru-apikey-toggle')!;

loadDanbooruSettings().then(settings => {
  danbooruUrlInput.value = settings.danbooruUrl;
  danbooruUsernameInput.value = settings.danbooruUsername;
  danbooruApiKeyInput.value = settings.danbooruApiKey;
});

// Save on change
danbooruUrlInput.addEventListener('change', async () => {
  const settings = await loadDanbooruSettings();
  settings.danbooruUrl = danbooruUrlInput.value.trim();
  await saveDanbooruSettings(settings);
});

danbooruUsernameInput.addEventListener('change', async () => {
  const settings = await loadDanbooruSettings();
  settings.danbooruUsername = danbooruUsernameInput.value.trim();
  await saveDanbooruSettings(settings);
});

danbooruApiKeyInput.addEventListener('change', async () => {
  const settings = await loadDanbooruSettings();
  settings.danbooruApiKey = danbooruApiKeyInput.value.trim();
  await saveDanbooruSettings(settings);
});

// Toggle API key visibility
danbooruApiKeyToggle.addEventListener('click', () => {
  const isPassword = danbooruApiKeyInput.type === 'password';
  danbooruApiKeyInput.type = isPassword ? 'text' : 'password';
});

// Toast notification system
function showToast(message: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: ${type === 'success' ? '#4CAF50' : '#f44336'};
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 9999;
    font-size: 14px;
    font-weight: 500;
    animation: slideIn 0.3s ease-out;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Add toast animations to page
if (!document.getElementById('toast-styles')) {
  const style = document.createElement('style');
  style.id = 'toast-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// URL parsing helper for artist extraction
function extractArtistFromUrl(url: string): { artist?: string; source?: string } {
  const result: { artist?: string; source?: string } = {};

  // Pixiv
  const pixivUser = url.match(/pixiv\.net\/(?:en\/)?users\/(\d+)/);
  const pixivArtwork = url.match(/pixiv\.net\/(?:en\/)?artworks\/(\d+)/);
  if (pixivUser) {
    result.artist = `pixiv_user_${pixivUser[1]}`;
    result.source = url;
  } else if (pixivArtwork) {
    result.source = url;
  }

  // Twitter/X
  const twitter = url.match(/(?:twitter|x)\.com\/([^/]+)/);
  if (twitter && !['i', 'home', 'search'].includes(twitter[1])) {
    result.artist = twitter[1];
    result.source = url;
  }

  // Fanbox
  const fanbox = url.match(/([^.]+)\.fanbox\.cc/);
  if (fanbox) {
    result.artist = `${fanbox[1]}_fanbox`;
    result.source = url;
  }

  // DeviantArt
  const deviantart = url.match(/deviantart\.com\/([^/]+)/);
  if (deviantart) {
    result.artist = deviantart[1];
    result.source = url;
  }

  // ArtStation
  const artstation = url.match(/artstation\.com\/(?:artwork\/|[^/]+$)/);
  if (artstation) {
    result.source = url;
  }

  return result;
}

// Modal control
const danbooruModal = document.getElementById('danbooru-upload-modal')!;
const danbooruOverlay = document.querySelector('.danbooru-upload-overlay')!;
const danbooruCloseBtn = document.querySelector('.danbooru-upload-close')!;
const danbooruCancelBtn = document.getElementById('danbooru-upload-cancel-btn')!;
const danbooruSubmitBtn = document.getElementById('danbooru-upload-submit-btn')!;

let currentUploadImageId: string | null = null;

function closeDanbooruModal() {
  danbooruModal.classList.remove('active');
  currentUploadImageId = null;
}

danbooruOverlay.addEventListener('click', closeDanbooruModal);
danbooruCloseBtn.addEventListener('click', closeDanbooruModal);
danbooruCancelBtn.addEventListener('click', closeDanbooruModal);

async function openDanbooruUploadModal(imageId: string) {
  const settings = await loadDanbooruSettings();

  if (!settings.danbooruUrl || !settings.danbooruUsername || !settings.danbooruApiKey) {
    alert('Please configure Danbooru settings first (click the ⚙ button)');
    return;
  }

  const image = state.images.find(img => img.id === imageId);
  if (!image) return;

  currentUploadImageId = imageId;

  // Set preview image
  const previewImg = document.getElementById('danbooru-preview-image') as HTMLImageElement;
  const url = getOrCreateObjectURL(image);
  previewImg.src = url;

  // Auto-fill metadata
  const tagsInput = document.getElementById('danbooru-tags-input') as HTMLInputElement;
  const artistInput = document.getElementById('danbooru-artist-input') as HTMLInputElement;
  const copyrightInput = document.getElementById('danbooru-copyright-input') as HTMLInputElement;
  const characterInput = document.getElementById('danbooru-character-input') as HTMLInputElement;
  const sourceInput = document.getElementById('danbooru-source-input') as HTMLInputElement;
  const descriptionInput = document.getElementById('danbooru-description-input') as HTMLTextAreaElement;

  // Auto-fill tags from existing tags
  tagsInput.value = image.tags?.join(', ') || '';

  // Extract artist from URL
  const extracted = extractArtistFromUrl(image.pageUrl);
  artistInput.value = extracted.artist || '';
  sourceInput.value = extracted.source || image.pageUrl;

  // Fill description with page title
  descriptionInput.value = image.pageTitle || '';

  // Reset other fields
  copyrightInput.value = '';
  characterInput.value = '';

  // Reset rating to General
  const ratingGeneral = document.querySelector('input[name="danbooru-rating"][value="g"]') as HTMLInputElement;
  if (ratingGeneral) ratingGeneral.checked = true;

  // Show modal
  danbooruModal.classList.add('active');
}

// Upload to Danbooru
danbooruSubmitBtn.addEventListener('click', async () => {
  if (!currentUploadImageId) return;

  const image = state.images.find(img => img.id === currentUploadImageId);
  if (!image) return;

  const settings = await loadDanbooruSettings();
  const tagsInput = document.getElementById('danbooru-tags-input') as HTMLInputElement;
  const artistInput = document.getElementById('danbooru-artist-input') as HTMLInputElement;
  const copyrightInput = document.getElementById('danbooru-copyright-input') as HTMLInputElement;
  const characterInput = document.getElementById('danbooru-character-input') as HTMLInputElement;
  const sourceInput = document.getElementById('danbooru-source-input') as HTMLInputElement;

  // Get selected rating from radio buttons
  const selectedRating = document.querySelector('input[name="danbooru-rating"]:checked') as HTMLInputElement;
  const rating = selectedRating ? selectedRating.value : 'g';

  // Combine all tags
  const generalTags = tagsInput.value.split(/\s+/).filter(Boolean);
  const artistTags = artistInput.value.trim() ? [artistInput.value.trim()] : [];
  const copyrightTags = copyrightInput.value.trim() ? [copyrightInput.value.trim()] : [];
  const characterTags = characterInput.value.trim() ? [characterInput.value.trim()] : [];

  const allTags = [...generalTags, ...artistTags, ...copyrightTags, ...characterTags];
  const tagString = allTags.join(' ');

  if (!tagString) {
    alert('Please add at least one tag');
    return;
  }

  // Disable button during upload
  danbooruSubmitBtn.disabled = true;
  danbooruSubmitBtn.textContent = 'Uploading...';

  try {
    // Step 1: Create upload with source URL
    const uploadFormData = new FormData();
    uploadFormData.append('upload[source]', image.imageUrl);
    uploadFormData.append('upload[referer_url]', image.pageUrl);

    const uploadResponse = await fetch(`${settings.danbooruUrl}/uploads.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${settings.danbooruUsername}:${settings.danbooruApiKey}`),
      },
      body: uploadFormData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}\n${errorText}`);
    }

    const uploadResult = await uploadResponse.json();
    console.log('Upload created:', uploadResult);
    console.log('Upload ID:', uploadResult.id, 'Status:', uploadResult.status, 'Post ID:', uploadResult.post_id);

    // Step 2: Wait for upload to be processed and get media asset
    if (uploadResult.id) {
      // Upload needs processing, poll for completion
      console.log('Upload needs processing, starting poll...');
      showToast('Upload created, waiting for processing...', 'success');
      const uploadMediaAssetId = await pollUploadStatus(settings, uploadResult.id);
      if (uploadMediaAssetId) {
        console.log('Got upload_media_asset_id, creating post with tags...');
        const descriptionInput = document.getElementById('danbooru-description-input') as HTMLTextAreaElement;
        const postId = await createDanbooruPost(
          settings,
          uploadMediaAssetId,
          tagString,
          rating,
          sourceInput.value
        );

        // Add artist commentary if we have title or description
        const pageTitle = image.pageTitle || '';
        const description = descriptionInput.value;
        if (postId && (pageTitle.trim() || description.trim())) {
          await createArtistCommentary(settings, postId, pageTitle, description);
        }

        closeDanbooruModal();
        showToast('Successfully uploaded and tagged!', 'success');
      } else {
        console.warn('Polling completed but no upload_media_asset_id returned');
        closeDanbooruModal();
        showToast('Upload created but could not auto-tag. Please tag manually on Danbooru.', 'success');
      }
    } else {
      console.error('Unexpected upload response format:', uploadResult);
      closeDanbooruModal();
      showToast('Upload created! Check Danbooru to complete.', 'success');
    }
  } catch (error) {
    console.error('Danbooru upload error:', error);
    showToast(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  } finally {
    danbooruSubmitBtn.disabled = false;
    danbooruSubmitBtn.textContent = 'Upload to Danbooru';
  }
});

async function pollUploadStatus(settings: DanbooruSettings, uploadId: number): Promise<number | null> {
  console.log(`Polling upload ${uploadId} for completion...`);

  for (let i = 0; i < DANBOORU_POLL_MAX_ATTEMPTS; i++) {
    await new Promise(resolve => setTimeout(resolve, DANBOORU_POLL_DELAY_MS));

    try {
      const response = await fetch(`${settings.danbooruUrl}/uploads/${uploadId}.json`, {
        headers: {
          'Authorization': 'Basic ' + btoa(`${settings.danbooruUsername}:${settings.danbooruApiKey}`),
        },
      });

      if (response.ok) {
        const upload = await response.json();
        const uploadMediaAssetId = upload.upload_media_assets?.[0]?.id;
        const mediaAssetId = upload.upload_media_assets?.[0]?.media_asset_id;
        console.log(`Poll attempt ${i + 1}/${DANBOORU_POLL_MAX_ATTEMPTS}: status="${upload.status}", upload_media_asset_id=${uploadMediaAssetId || 'null'}, media_asset_id=${mediaAssetId || 'null'}`);

        // Check for error status
        if (upload.status === 'error') {
          console.error('Upload processing error:', upload.error);
          return null;
        }

        // If status is completed and we have upload_media_asset_id, return it
        if (upload.status === 'completed' && uploadMediaAssetId && mediaAssetId) {
          console.log(`Upload completed! upload_media_asset_id: ${uploadMediaAssetId}, media_asset_id: ${mediaAssetId}`);
          return uploadMediaAssetId;
        }
      } else {
        console.error(`Failed to fetch upload status: ${response.status}`);
      }
    } catch (error) {
      console.error('Error polling upload status:', error);
    }
  }

  console.warn(`Upload polling timed out after ${DANBOORU_POLL_MAX_ATTEMPTS * DANBOORU_POLL_DELAY_MS / 1000} seconds`);
  return null;
}

async function createDanbooruPost(
  settings: DanbooruSettings,
  uploadMediaAssetId: number,
  tagString: string,
  rating: string,
  source: string
): Promise<number | null> {
  const postData: any = {
    upload_media_asset_id: uploadMediaAssetId,
  };

  if (tagString.trim()) {
    postData.tag_string = tagString.trim();
  }

  if (rating) {
    postData.rating = rating;
  }

  if (source.trim()) {
    postData.source = source.trim();
  }

  console.log('Creating post with JSON:', postData);

  const response = await fetch(`${settings.danbooruUrl}/posts.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${settings.danbooruUsername}:${settings.danbooruApiKey}`),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to create post:', response.status, errorText);
    throw new Error('Upload succeeded but post creation failed. Please create post manually on Danbooru.');
  }

  const post = await response.json();
  console.log('Post created successfully! Post ID:', post.id);
  console.log('Full post response:', post);
  return post.id;
}

async function createArtistCommentary(
  settings: DanbooruSettings,
  postId: number,
  originalTitle: string,
  originalDescription: string
) {
  const commentaryData: any = {};

  if (originalTitle.trim()) {
    commentaryData.original_title = originalTitle.trim();
  }

  if (originalDescription.trim()) {
    commentaryData.original_description = originalDescription.trim();
  }

  console.log('Creating artist commentary for post', postId, ':', commentaryData);

  try {
    const response = await fetch(`${settings.danbooruUrl}/posts/${postId}/artist_commentary/create_or_update.json`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Basic ' + btoa(`${settings.danbooruUsername}:${settings.danbooruApiKey}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commentaryData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to create artist commentary:', response.status, errorText);
      // Don't throw - commentary is optional, post was already created successfully
      return;
    }

    // Check if response has content before parsing JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const text = await response.text();
      if (text && text.trim()) {
        const commentary = JSON.parse(text);
        console.log('Artist commentary created successfully:', commentary);
      } else {
        console.log('Artist commentary created successfully (no response body)');
      }
    } else {
      console.log('Artist commentary created successfully (response status:', response.status, ')');
    }
  } catch (error) {
    console.error('Error creating artist commentary:', error);
    // Don't throw - commentary is optional, post was already created successfully
  }
}

// Tag Rules Management
import {
  loadTagRules,
  addTagRule,
  updateTagRule,
  deleteTagRule,
  type TagRule
} from '../storage/tag-rules';

const tagRulesList = document.getElementById('tag-rules-list')!;
const ruleNameInput = document.getElementById('rule-name-input') as HTMLInputElement;
const rulePatternInput = document.getElementById('rule-pattern-input') as HTMLInputElement;
const ruleRegexToggle = document.getElementById('rule-regex-toggle') as HTMLInputElement;
const ruleTagsInput = document.getElementById('rule-tags-input') as HTMLInputElement;
const addRuleBtn = document.getElementById('add-rule-btn')!;
const cancelRuleBtn = document.getElementById('cancel-rule-btn')!;

let editingRuleId: string | null = null;

async function renderTagRules() {
  const rules = await loadTagRules();

  if (rules.length === 0) {
    tagRulesList.innerHTML = '<p class="no-rules-message">No auto-tagging rules configured yet.</p>';
    return;
  }

  tagRulesList.innerHTML = rules.map(rule => `
    <div class="tag-rule-card ${!rule.enabled ? 'disabled' : ''}" data-rule-id="${rule.id}">
      <div class="tag-rule-header">
        <div class="tag-rule-info">
          <strong>${escapeHtml(rule.name)}</strong>
          <span class="tag-rule-pattern">
            ${rule.pattern === '' ? '(matches all)' : escapeHtml(rule.pattern)}
            ${rule.isRegex ? '<span class="regex-badge">regex</span>' : ''}
          </span>
        </div>
        <div class="tag-rule-actions">
          <label class="toggle-switch">
            <input type="checkbox" class="rule-enabled-toggle" ${rule.enabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <button class="btn-icon edit-rule-btn" title="Edit rule">✎</button>
          <button class="btn-icon delete-rule-btn" title="Delete rule">×</button>
        </div>
      </div>
      <div class="tag-rule-tags">
        ${rule.tags.map(tag => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join('')}
      </div>
    </div>
  `).join('');

  attachRuleEventListeners();
}

function attachRuleEventListeners() {
  const ruleCards = tagRulesList.querySelectorAll('.tag-rule-card');

  ruleCards.forEach(card => {
    const ruleId = card.getAttribute('data-rule-id')!;

    const enableToggle = card.querySelector('.rule-enabled-toggle') as HTMLInputElement;
    enableToggle.addEventListener('change', async () => {
      await updateTagRule(ruleId, { enabled: enableToggle.checked });
      await renderTagRules();
    });

    const editBtn = card.querySelector('.edit-rule-btn');
    editBtn?.addEventListener('click', async () => {
      const rules = await loadTagRules();
      const rule = rules.find(r => r.id === ruleId);
      if (rule) {
        editingRuleId = ruleId;
        ruleNameInput.value = rule.name;
        rulePatternInput.value = rule.pattern;
        ruleRegexToggle.checked = rule.isRegex;
        ruleTagsInput.value = rule.tags.join(' ');
        addRuleBtn.textContent = 'Update Rule';
        cancelRuleBtn.style.display = 'inline-block';
        ruleNameInput.focus();
      }
    });

    const deleteBtn = card.querySelector('.delete-rule-btn');
    deleteBtn?.addEventListener('click', async () => {
      if (confirm('Delete this rule?')) {
        await deleteTagRule(ruleId);
        await renderTagRules();
      }
    });
  });
}

addRuleBtn.addEventListener('click', async () => {
  const name = ruleNameInput.value.trim();
  const pattern = rulePatternInput.value.trim();
  const isRegex = ruleRegexToggle.checked;
  const tagsText = ruleTagsInput.value.trim();

  if (!name) {
    alert('Please enter a rule name');
    return;
  }

  const tags = tagsText ? tagsText.split(/\s+/).filter(t => t) : [];

  if (tags.length === 0) {
    alert('Please enter at least one tag');
    return;
  }

  if (editingRuleId) {
    await updateTagRule(editingRuleId, { name, pattern, isRegex, tags });
    editingRuleId = null;
    addRuleBtn.textContent = 'Add Rule';
    cancelRuleBtn.style.display = 'none';
  } else {
    await addTagRule({ name, pattern, isRegex, tags, enabled: true });
  }

  ruleNameInput.value = '';
  rulePatternInput.value = '';
  ruleRegexToggle.checked = false;
  ruleTagsInput.value = '';

  await renderTagRules();
});

cancelRuleBtn.addEventListener('click', () => {
  editingRuleId = null;
  ruleNameInput.value = '';
  rulePatternInput.value = '';
  ruleRegexToggle.checked = false;
  ruleTagsInput.value = '';
  addRuleBtn.textContent = 'Add Rule';
  cancelRuleBtn.style.display = 'none';
});

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

renderTagRules();

loadImages();
