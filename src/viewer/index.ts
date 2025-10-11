import { getAllImages, deleteImage, deleteAllImages, restoreImage, permanentlyDeleteImage, emptyTrash } from '../storage/service';
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
  groupBy: 'none',
  selectedIds: new Set<string>(),
  objectUrls: new Map<string, string>(),
  currentView: 'all' as 'all' | 'trash',
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

  renderImages(filtered);
  updateImageCount();
  updateViewBadges();
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
      <button class="btn btn-primary view-btn" data-id="${image.id}">View Original</button>
      <button class="btn btn-danger delete-btn" data-id="${image.id}">Delete</button>
    `;

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
  } else {
    renderUngroupedImages(images);
  }
}

function renderUngroupedImages(images: SavedImage[]) {
  const grid = document.getElementById('image-grid')!;
  grid.innerHTML = images.map(image => createImageCardHTML(image)).join('');
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

function handleImageClick(e: Event) {
  const imageCard = (e.target as HTMLElement).closest('.image-card');
  if (!imageCard) return;

  const id = imageCard.getAttribute('data-id')!;
  const image = state.images.find(img => img.id === id);
  if (image) {
    openLightbox(image);
  }
}

function openLightbox(image: SavedImage) {
  const lightbox = document.getElementById('lightbox')!;
  const lightboxImage = document.getElementById('lightbox-image') as HTMLImageElement;
  const url = URL.createObjectURL(image.blob);

  lightboxImage.src = url;
  lightbox.classList.add('active');
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox')!;
  lightbox.classList.remove('active');
}

function handleSearch(e: Event) {
  applyFilters();
}

document.getElementById('search-input')!.addEventListener('input', handleSearch);

// Event delegation for image grid
const imageGrid = document.getElementById('image-grid')!;

imageGrid.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;

  // Handle specific elements first (priority order)

  // 1. Action buttons
  if (target.matches('.view-btn') || target.closest('.view-btn')) {
    const btn = target.matches('.view-btn') ? target : target.closest('.view-btn');
    if (btn) handleViewOriginal(e);
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

  // 4. Anywhere else on the card → toggle selection
  const card = target.closest('.image-card');
  if (card) {
    const id = card.getAttribute('data-id')!;

    // Toggle selection state
    if (state.selectedIds.has(id)) {
      state.selectedIds.delete(id);
    } else {
      state.selectedIds.add(id);
    }

    // Update checkbox to reflect new state
    const checkbox = card.querySelector('.image-checkbox') as HTMLInputElement;
    if (checkbox) {
      checkbox.checked = state.selectedIds.has(id);
    }

    updateSelectionCount();
    updateImageCard(id);
  }
});

imageGrid.addEventListener('change', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.matches('.image-checkbox')) {
    handleCheckboxChange(e);
  }
});

document.getElementById('export-btn')!.addEventListener('click', async () => {
  const { exportImages } = await import('./export');
  await exportImages(state.images);
});

document.getElementById('export-selected-btn')!.addEventListener('click', async () => {
  if (state.selectedIds.size === 0) return;

  const selectedImages = state.images.filter(img => state.selectedIds.has(img.id));
  const { exportImages } = await import('./export');
  await exportImages(selectedImages);
});

document.getElementById('select-all-btn')!.addEventListener('click', () => {
  // Only select currently visible/filtered images
  state.filteredImages.forEach(image => {
    state.selectedIds.add(image.id);
  });
  applyFilters();
  updateSelectionCount();
});

document.getElementById('deselect-all-btn')!.addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.image-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
  state.selectedIds.clear();
  applyFilters();
  updateSelectionCount();
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

// Lightbox controls
document.querySelector('.lightbox-close')!.addEventListener('click', closeLightbox);
document.querySelector('.lightbox-overlay')!.addEventListener('click', closeLightbox);

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
const exportBtn = document.getElementById('export-btn')!;
const restoreSelectedBtn = document.getElementById('restore-selected-btn')!;
const deleteSelectedBtn = document.getElementById('delete-selected-btn')!;
const exportSelectedBtn = document.getElementById('export-selected-btn')!;

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
    exportBtn.style.display = 'none';
    deleteSelectedBtn.style.display = 'none';
    exportSelectedBtn.style.display = 'none';
  } else {
    emptyTrashBtn.style.display = 'none';
    restoreSelectedBtn.style.display = 'none';
    deleteAllBtn.style.display = 'inline-block';
    exportBtn.style.display = 'inline-block';
    deleteSelectedBtn.style.display = 'inline-block';
    exportSelectedBtn.style.display = 'inline-block';
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

loadImages();
