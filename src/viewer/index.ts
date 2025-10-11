import { getAllImages, deleteImage, deleteAllImages } from '../storage/service';
import type { SavedImage } from '../types';

let allImages: SavedImage[] = [];
let currentSort = 'savedAt-desc';
let currentTypeFilter = 'all';
let selectedImageIds = new Set<string>();

async function loadImages() {
  allImages = await getAllImages();
  populateTypeFilter();
  applySorting();
  applyFilters();
}

function populateTypeFilter() {
  const typeFilter = document.getElementById('type-filter') as HTMLSelectElement;
  const mimeTypes = new Set(allImages.map(img => img.mimeType));

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

  typeFilter.value = currentTypeFilter;
}

function applyFilters() {
  let filtered = allImages;

  // Apply type filter
  if (currentTypeFilter !== 'all') {
    filtered = filtered.filter(img => img.mimeType === currentTypeFilter);
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

  renderImages(filtered);
  updateImageCount();
}

function applySorting() {
  const [field, direction] = currentSort.split('-');
  const isAsc = direction === 'asc';

  allImages.sort((a, b) => {
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

function renderImages(images: SavedImage[]) {
  const grid = document.getElementById('image-grid')!;
  const emptyState = document.getElementById('empty-state')!;

  if (images.length === 0) {
    emptyState.style.display = 'block';
    grid.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  grid.style.display = '';

  grid.innerHTML = images.map(image => {
    const url = URL.createObjectURL(image.blob);
    const date = new Date(image.savedAt).toLocaleString();
    const fileSize = formatFileSize(image.fileSize);
    const isSelected = selectedImageIds.has(image.id);

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
            <button class="btn btn-primary view-btn" data-id="${image.id}">View Original</button>
            <button class="btn btn-danger delete-btn" data-id="${image.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', handleViewOriginal);
  });

  grid.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDelete);
  });

  grid.querySelectorAll('.image-preview').forEach(img => {
    img.addEventListener('click', handleImageClick);
  });

  grid.querySelectorAll('.image-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', handleCheckboxChange);
  });
}

function handleViewOriginal(e: Event) {
  const id = (e.target as HTMLElement).dataset.id!;
  const image = allImages.find(img => img.id === id);
  if (image) {
    window.open(image.imageUrl, '_blank');
  }
}

async function handleDelete(e: Event) {
  const id = (e.target as HTMLElement).dataset.id!;
  await deleteImage(id);
  selectedImageIds.delete(id);
  await loadImages();
}

function handleCheckboxChange(e: Event) {
  const checkbox = e.target as HTMLInputElement;
  const id = checkbox.dataset.id!;

  if (checkbox.checked) {
    selectedImageIds.add(id);
  } else {
    selectedImageIds.delete(id);
  }

  updateSelectionCount();
  updateImageCard(id);
}

function updateImageCard(id: string) {
  const card = document.querySelector(`.image-card[data-id="${id}"]`);
  if (card) {
    if (selectedImageIds.has(id)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  }
}

function updateImageCount() {
  const countEl = document.querySelector('.image-count')!;
  const count = allImages.length;
  countEl.textContent = `${count} image${count !== 1 ? 's' : ''}`;
}

function updateSelectionCount() {
  const selectionCountEl = document.getElementById('selection-count');
  if (selectionCountEl) {
    const count = selectedImageIds.size;
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

function handleImageClick(e: Event) {
  const imageCard = (e.target as HTMLElement).closest('.image-card');
  if (!imageCard) return;

  const id = imageCard.getAttribute('data-id')!;
  const image = allImages.find(img => img.id === id);
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

document.getElementById('export-btn')!.addEventListener('click', async () => {
  const { exportImages } = await import('./export');
  await exportImages(allImages);
});

document.getElementById('export-selected-btn')!.addEventListener('click', async () => {
  if (selectedImageIds.size === 0) return;

  const selectedImages = allImages.filter(img => selectedImageIds.has(img.id));
  const { exportImages } = await import('./export');
  await exportImages(selectedImages);
});

document.getElementById('select-all-btn')!.addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.image-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach(checkbox => {
    checkbox.checked = true;
    selectedImageIds.add(checkbox.dataset.id!);
  });
  applyFilters();
  updateSelectionCount();
});

document.getElementById('deselect-all-btn')!.addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.image-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
  selectedImageIds.clear();
  applyFilters();
  updateSelectionCount();
});

document.getElementById('delete-selected-btn')!.addEventListener('click', async () => {
  const count = selectedImageIds.size;
  if (count === 0) return;

  const confirmed = confirm(`Are you sure you want to delete ${count} selected image${count !== 1 ? 's' : ''}? This cannot be undone.`);
  if (confirmed) {
    for (const id of selectedImageIds) {
      await deleteImage(id);
    }
    selectedImageIds.clear();
    await loadImages();
  }
});

document.getElementById('delete-all-btn')!.addEventListener('click', async () => {
  const count = allImages.length;
  if (count === 0) return;

  const confirmed = confirm(`Are you sure you want to delete all ${count} image${count !== 1 ? 's' : ''}? This cannot be undone.`);
  if (confirmed) {
    await deleteAllImages();
    selectedImageIds.clear();
    await loadImages();
  }
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
  currentTypeFilter = typeFilter.value;
  applyFilters();
});

// Sorting
const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;

sortSelect.addEventListener('change', () => {
  currentSort = sortSelect.value;
  localStorage.setItem('sortBy', currentSort);
  applySorting();
  applyFilters();
});

// Load saved sort preference
const savedSort = localStorage.getItem('sortBy');
if (savedSort) {
  currentSort = savedSort;
  sortSelect.value = savedSort;
}

// Lightbox controls
document.querySelector('.lightbox-close')!.addEventListener('click', closeLightbox);
document.querySelector('.lightbox-overlay')!.addEventListener('click', closeLightbox);

loadImages();
