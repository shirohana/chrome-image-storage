import { getAllImages, getAllImagesMetadata, getImageBlob, getImage, deleteImage, deleteAllImages, restoreImage, permanentlyDeleteImage, emptyTrash, updateImageTags, addTagsToImages, removeTagsFromImages } from '../storage/service';
import type { SavedImage, ImageMetadata } from '../types';
import { parseTagSearch, removeTagFromQuery, sortTags } from './tag-utils';
import { getXAccountFromUrl, groupImagesByXAccount, groupImagesByDuplicates, getVisualOrder, type GroupBy } from './grouping';
import { formatFileSize, extractArtistFromUrl, debounce } from './format';
import { offsetIndexClamped, offsetIndexBounded } from './navigation-math';
import { filterImages, computeRatingCounts, sortImages } from './filters';
import { state } from './state';
import { showToast } from './toast';
import { setupTagAutocomplete } from './autocomplete';
import { openDanbooruUploadModal } from './danbooru';
import { PLACEHOLDER_IMAGE, getOrCreateObjectURL, loadImageBlob, revokeObjectURLs, revokeObjectURL } from './blobs';
import './notes';
import { renderTagRules, newlyImportedRuleIds } from './tag-rules-ui';

// Context menu state
let ratingContextMenu: HTMLElement | null = null;
let tagContextMenu: HTMLElement | null = null;
let contextMenuTargetImageId: string | null = null;
let contextMenuTargetTag: string | null = null;

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

// Search state persistence
async function saveSearchState() {
  const urlSearch = (document.getElementById('url-search-input') as HTMLInputElement)?.value || '';
  const tagSearch = (document.getElementById('tag-search-input') as HTMLInputElement)?.value || '';
  await chrome.storage.local.set({
    urlSearch,
    tagSearch,
  });
}

async function restoreSearchState() {
  const result = await chrome.storage.local.get(['urlSearch', 'tagSearch']);
  const urlSearchInput = document.getElementById('url-search-input') as HTMLInputElement;
  const tagSearchInput = document.getElementById('tag-search-input') as HTMLInputElement;

  if (urlSearchInput && result.urlSearch) {
    urlSearchInput.value = result.urlSearch;
  }

  if (tagSearchInput && result.tagSearch) {
    tagSearchInput.value = result.tagSearch;
  }
}

// View settings persistence (sort, groupBy)
async function saveViewSettings() {
  await chrome.storage.local.set({
    sortBy: state.sort,
    groupBy: state.groupBy,
  });
}

async function restoreViewSettings() {
  const result = await chrome.storage.local.get(['sortBy', 'groupBy']);

  if (result.sortBy) {
    state.sort = result.sortBy;
    const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;
    if (sortSelect) sortSelect.value = result.sortBy;
  }

  if (result.groupBy) {
    state.groupBy = result.groupBy;
    const groupBySelect = document.getElementById('group-by') as HTMLSelectElement;
    if (groupBySelect) groupBySelect.value = result.groupBy;
  }
}

async function loadImages() {
  state.images = await getAllImagesMetadata();
  applySorting();
  applyFilters();

  // Update tag autocomplete with newly loaded tags
  if (typeof updateTagAutocompleteAvailableTags === 'function') {
    updateTagAutocompleteAvailableTags();
  }
}

/**
 * Loads a single image from database and adds it to state.
 * Used when a new image is saved to avoid reloading all metadata.
 */
async function loadSingleImage(imageId: string) {
  const savedImage = await getImage(imageId);
  if (!savedImage) return;

  // Strip blob to keep only metadata
  const { blob, ...metadata } = savedImage;

  // Check if image already exists in state
  const existingIndex = state.images.findIndex(img => img.id === imageId);

  if (existingIndex !== -1) {
    // Update existing image
    state.images[existingIndex] = metadata;
  } else {
    // Add new image
    state.images.push(metadata);
  }

  // Re-sort to place image in correct position
  applySorting();

  // For grouped modes, do full re-render (complexity of surgical insert not worth it)
  if (state.groupBy !== 'none') {
    await applyFilters();
    // Update tag autocomplete with newly added tags
    if (typeof updateTagAutocompleteAvailableTags === 'function') {
      updateTagAutocompleteAvailableTags();
    }
    return;
  }

  // For ungrouped mode: surgical insertion to avoid full re-render
  // Re-filter without rendering
  applyFiltersWithoutRender();

  // Check if image is in filtered results
  const newIndex = state.filteredImages.findIndex(img => img.id === imageId);
  const isVisible = newIndex !== -1;

  if (isVisible) {
    // Image is visible after filtering: insert it surgically
    insertNewImageCard(imageId, newIndex);
  }
  // If filtered out: no visual update needed

  // Update all UI counters and badges
  updateImageCount();
  updateViewBadges();
  updateSelectionCount();
  updatePreviewPane();
  updateRatingPills();

  // Update tag autocomplete with newly added tags
  if (typeof updateTagAutocompleteAvailableTags === 'function') {
    updateTagAutocompleteAvailableTags();
  }
}

/**
 * Updates a single image card in the DOM without re-rendering the entire grid.
 */
function updateSingleImageCardInDOM(imageId: string): void {
  const existingCard = document.querySelector(`.image-card[data-id="${imageId}"]`);
  if (!existingCard) return;

  const image = state.images.find(img => img.id === imageId);
  if (!image) return;

  const newCardHTML = createImageCardHTML(image);
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = newCardHTML;
  const newCard = tempDiv.firstElementChild as HTMLElement;

  existingCard.replaceWith(newCard);

  // Re-observe the new image for lazy loading
  const img = newCard.querySelector('.image-preview[data-image-id]');
  if (img && imageObserver) {
    imageObserver.observe(img);
  }
}

/**
 * Inserts a single image card at the specified position in the DOM.
 * Used for surgical updates to avoid full grid re-renders.
 */
function insertNewImageCard(imageId: string, targetIndex: number): void {
  const image = state.images.find(img => img.id === imageId);
  if (!image) return;

  const grid = document.getElementById('image-grid')!;
  const existingCard = grid.querySelector(`.image-card[data-id="${imageId}"]`);

  // If card already exists, use existing update logic
  if (existingCard) {
    updateSingleImageCardInDOM(imageId);
    return;
  }

  // Create new card HTML
  const cardHTML = createImageCardHTML(image);
  const existingCards = grid.querySelectorAll('.image-card');

  if (existingCards.length === 0) {
    // Empty grid: just set innerHTML
    grid.innerHTML = cardHTML;
  } else if (targetIndex >= existingCards.length) {
    // Append at end
    grid.insertAdjacentHTML('beforeend', cardHTML);
  } else {
    // Insert before the card currently at targetIndex
    existingCards[targetIndex].insertAdjacentHTML('beforebegin', cardHTML);
  }

  // Set up lazy loading observer for the new card
  const newCard = grid.querySelector(`.image-card[data-id="${imageId}"]`);
  if (newCard && imageObserver) {
    const img = newCard.querySelector('.image-preview[data-image-id]');
    if (img) {
      imageObserver.observe(img);
    }
  }
}

/**
 * Updates image metadata in local state after database update, then re-renders.
 * Synchronizes local state with database changes and sets updatedAt timestamp.
 * Only triggers filtering if the field affects filter results.
 */
async function syncImageMetadataToState<T extends keyof ImageMetadata>(
  imageId: string,
  field: T,
  value: ImageMetadata[T]
): Promise<void> {
  const imageInState = state.images.find(img => img.id === imageId);
  if (imageInState) {
    (imageInState as any)[field] = value;
    imageInState.updatedAt = Date.now();
  }

  // Only re-filter if the field affects filtering
  const filteringFields: (keyof ImageMetadata)[] = ['tags', 'rating', 'pageUrl', 'isDeleted'];
  if (filteringFields.includes(field)) {
    // Check image's position before filtering
    const oldIndex = state.filteredImages.findIndex(img => img.id === imageId);
    const wasVisible = oldIndex !== -1;

    // Re-run filter logic
    applyFiltersWithoutRender();

    // Check image's position after filtering
    const newIndex = state.filteredImages.findIndex(img => img.id === imageId);
    const isVisible = newIndex !== -1;

    // Only do surgical update if image stayed at same position
    if (wasVisible && isVisible && oldIndex === newIndex) {
      // Image still visible at same position: just update this one card
      updateSingleImageCardInDOM(imageId);
      updateImageCount();
      updateViewBadges();
      updateSelectionCount();
      updatePreviewPane();
      updateRatingPills();
    } else {
      // Filter membership or position changed: do full re-render
      await renderImages(state.filteredImages);
      updateImageCount();
      updateViewBadges();
      updateSelectionCount();
      updatePreviewPane();
      updateRatingPills();
    }
  } else {
    // Non-filtering fields: just update preview pane
    updatePreviewPane();
  }
}

// TagCountFilter moved to tag-utils.ts

// Update tag sidebar with tags from filtered images
function updateTagSidebar(images: ImageMetadata[] = state.filteredImages) {
  const sidebar = document.getElementById('tag-sidebar-list');
  if (!sidebar) return;

  // Parse current tag search to determine active tags
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  const parsed = input ? parseTagSearch(input.value) : {
    includeTags: [],
    excludeTags: [],
    orGroups: [],
    ratings: new Set(),
    fileTypes: new Set(),
    tagCount: null,
    includeUnrated: false
  };

  // Build sets for quick lookup
  const includedTags = new Set<string>(parsed.includeTags);
  parsed.orGroups.forEach(group => group.forEach(tag => includedTags.add(tag)));
  const excludedTags = new Set<string>(parsed.excludeTags);

  // Count tags
  const tagCounts = new Map<string, number>();
  images.forEach(img => {
    if (img.tags && img.tags.length > 0) {
      img.tags.forEach(tag => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    }
  });

  // Add included tags to the list with count 0 (so they show even when filtered out)
  includedTags.forEach(tag => {
    if (!tagCounts.has(tag)) {
      tagCounts.set(tag, 0);
    }
  });

  // Add excluded tags to the list with count 0 (so they show even when filtered out)
  excludedTags.forEach(tag => {
    if (!tagCounts.has(tag)) {
      tagCounts.set(tag, 0);
    }
  });

  // Sort: selected tags (included/excluded) first, then by count, then alphabetically
  const sortedTags = Array.from(tagCounts.entries())
    .sort((a, b) => {
      const aSelected = includedTags.has(a[0]) || excludedTags.has(a[0]);
      const bSelected = includedTags.has(b[0]) || excludedTags.has(b[0]);

      // Selected tags come first
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;

      // Within selected or unselected groups, sort by count then alphabetically
      if (b[1] !== a[1]) {
        return b[1] - a[1]; // Count descending
      }
      return a[0].localeCompare(b[0]); // Name ascending
    });

  // Render tag list with highlighting
  sidebar.innerHTML = sortedTags
    .map(([tag, count]) => {
      const isIncluded = includedTags.has(tag);
      const isExcluded = excludedTags.has(tag);
      const itemClass = isIncluded ? 'tag-sidebar-item tag-sidebar-item--included' :
                        isExcluded ? 'tag-sidebar-item tag-sidebar-item--excluded' :
                        'tag-sidebar-item';

      return `
        <div class="${itemClass}">
          <button class="tag-sidebar-item__action-btn tag-sidebar-item__add-btn" data-tag="${tag}" title="Include this tag">+</button>
          <button class="tag-sidebar-item__action-btn tag-sidebar-item__exclude-btn" data-tag="${tag}" title="Exclude this tag">−</button>
          <span class="tag-sidebar-item__name" data-tag="${tag}">${tag}</span>
          <span class="tag-sidebar-item__count">${count}</span>
        </div>
      `;
    })
    .join('');

  // Attach click handlers for + buttons
  sidebar.querySelectorAll('.tag-sidebar-item__add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag')!;
      addTagToSearch(tag);
    });
  });

  // Attach click handlers for - buttons
  sidebar.querySelectorAll('.tag-sidebar-item__exclude-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag')!;
      excludeTagFromSearch(tag);
    });
  });

  // Attach click handlers for tag names (to toggle tags)
  sidebar.querySelectorAll('.tag-sidebar-item__name').forEach(span => {
    span.addEventListener('click', () => {
      const tag = span.getAttribute('data-tag')!;
      if (includedTags.has(tag)) {
        removeIncludedTagFromSearch(tag);
      } else if (excludedTags.has(tag)) {
        removeExcludedTagFromSearch(tag);
      } else {
        // Unselected tag - add it
        addTagToSearch(tag);
      }
    });
  });
}

// Toggle tag in search input (for clicking tags on image cards)
function toggleTagInSearch(tag: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();
  const parsed = parseTagSearch(current);

  // Check if tag is currently active (in includeTags or orGroups)
  const isActive = parsed.includeTags.includes(tag) ||
                   parsed.orGroups.some(group => group.includes(tag));

  if (isActive) {
    // Remove tag from search
    input.value = removeTagFromQuery(current, tag);
  } else {
    // Add tag to search
    if (current) {
      input.value = `${current} ${tag}`;
    } else {
      input.value = tag;
    }
  }

  applyFiltersAndSave();
}

// Add tag to search input (for sidebar + button)
function addTagToSearch(tag: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();
  const parsed = parseTagSearch(current);

  // Check if tag already included (prevent duplicates)
  const isIncluded = parsed.includeTags.includes(tag) ||
                     parsed.orGroups.some(group => group.includes(tag));
  if (isIncluded) return;

  if (current) {
    input.value = `${current} ${tag}`;
  } else {
    input.value = tag;
  }
  applyFiltersAndSave();
}

// Exclude tag from search input (for sidebar - button)
function excludeTagFromSearch(tag: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();
  const parsed = parseTagSearch(current);

  // Check if tag already excluded (prevent duplicates)
  if (parsed.excludeTags.includes(tag)) return;

  // If tag is currently included, remove it first
  const isIncluded = parsed.includeTags.includes(tag) ||
                     parsed.orGroups.some(group => group.includes(tag));

  let newValue = current;
  if (isIncluded) {
    // Remove the included tag first
    newValue = removeTagFromQuery(current, tag);
  }

  // Add the exclusion
  if (newValue) {
    input.value = `${newValue} -${tag}`;
  } else {
    input.value = `-${tag}`;
  }
  applyFiltersAndSave();
}

// Remove included tag from search input (for clicking included tag name in sidebar)
function removeIncludedTagFromSearch(tag: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();
  input.value = removeTagFromQuery(current, tag);
  applyFiltersAndSave();
}

// Remove excluded tag from search input (for clicking excluded tag name)
function removeExcludedTagFromSearch(tag: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();
  const tokens = current.split(/\s+/);
  const excludedPattern = `-${tag}`;

  // Filter out the excluded tag
  const newTokens = tokens.filter(token => token !== excludedPattern);

  input.value = newTokens.join(' ').trim();
  applyFiltersAndSave();
}

// Account sidebar functions (for X/Twitter account filtering)
function updateAccountSidebar(images: ImageMetadata[] = state.filteredImages) {
  const sidebar = document.getElementById('account-sidebar-list');
  if (!sidebar) return;

  // Parse current tag search to determine active accounts
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  const parsed = input ? parseTagSearch(input.value) : {
    includeTags: [],
    excludeTags: [],
    orGroups: [],
    ratings: new Set(),
    fileTypes: new Set(),
    tagCount: null,
    includeUnrated: false,
    accounts: new Set(),
    excludeAccounts: new Set()
  };

  // Build sets for quick lookup
  const includedAccounts = new Set<string>(parsed.accounts);
  const excludedAccounts = new Set<string>(parsed.excludeAccounts);

  // Count accounts
  const accountCounts = new Map<string, number>();
  images.forEach(img => {
    const account = getXAccountFromUrl(img.pageUrl);
    if (account) {
      accountCounts.set(account, (accountCounts.get(account) || 0) + 1);
    }
  });

  // Add included accounts to the list with count 0 (so they show even when filtered out)
  includedAccounts.forEach(account => {
    if (!accountCounts.has(account)) {
      accountCounts.set(account, 0);
    }
  });

  // Add excluded accounts to the list with count 0 (so they show even when filtered out)
  excludedAccounts.forEach(account => {
    if (!accountCounts.has(account)) {
      accountCounts.set(account, 0);
    }
  });

  // Sort: selected accounts (included/excluded) first, then by count (desc), then alphabetically
  const sortedAccounts = Array.from(accountCounts.entries())
    .sort((a, b) => {
      const aSelected = includedAccounts.has(a[0]) || excludedAccounts.has(a[0]);
      const bSelected = includedAccounts.has(b[0]) || excludedAccounts.has(b[0]);

      // Selected accounts come first
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;

      // Within selected or unselected groups, sort by count then alphabetically
      if (b[1] !== a[1]) {
        return b[1] - a[1]; // Count descending
      }
      return a[0].localeCompare(b[0]); // Name ascending
    });

  // Render account list with highlighting
  sidebar.innerHTML = sortedAccounts
    .map(([account, count]) => {
      const isIncluded = includedAccounts.has(account);
      const isExcluded = excludedAccounts.has(account);
      const itemClass = isIncluded ? 'account-sidebar-item account-sidebar-item--included' :
                        isExcluded ? 'account-sidebar-item account-sidebar-item--excluded' :
                        'account-sidebar-item';

      return `
        <div class="${itemClass}">
          <button class="account-sidebar-item__action-btn account-sidebar-item__add-btn" data-account="${account}" title="Include this account">+</button>
          <button class="account-sidebar-item__action-btn account-sidebar-item__exclude-btn" data-account="${account}" title="Exclude this account">−</button>
          <span class="account-sidebar-item__name" data-account="${account}">@${account}</span>
          <span class="account-sidebar-item__count">${count}</span>
        </div>
      `;
    })
    .join('');

  // Attach click handlers for + buttons
  sidebar.querySelectorAll('.account-sidebar-item__add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const account = btn.getAttribute('data-account')!;
      addAccountToSearch(account);
    });
  });

  // Attach click handlers for - buttons
  sidebar.querySelectorAll('.account-sidebar-item__exclude-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const account = btn.getAttribute('data-account')!;
      excludeAccountFromSearch(account);
    });
  });

  // Attach click handlers for account names (to toggle accounts)
  sidebar.querySelectorAll('.account-sidebar-item__name').forEach(span => {
    span.addEventListener('click', () => {
      const account = span.getAttribute('data-account')!;
      if (includedAccounts.has(account)) {
        removeAccountFromSearch(account);
      } else if (excludedAccounts.has(account)) {
        removeExcludedAccountFromSearch(account);
      } else {
        // Unselected account - add it
        addAccountToSearch(account);
      }
    });
  });
}

function toggleAccountInSearch(account: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();
  const parsed = parseTagSearch(current);

  // Check if account is currently active
  const isActive = parsed.accounts.has(account);

  if (isActive) {
    // Remove account from search
    removeAccountFromSearch(account);
  } else {
    // Add account to search
    input.value = current ? `${current} account:${account}` : `account:${account}`;
  }

  applyFiltersAndSave();
}

function addAccountToSearch(account: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();

  // Check if already in search
  const accountPattern = new RegExp(`\\baccount:${account}\\b`, 'i');
  if (accountPattern.test(current)) {
    return; // Already present
  }

  // Append to search
  input.value = current ? `${current} account:${account}` : `account:${account}`;
  applyFiltersAndSave();
}

function excludeAccountFromSearch(account: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  // Remove from included accounts first
  removeAccountFromSearch(account);

  const current = input.value.trim();

  // Check if already excluded
  const excludedPattern = new RegExp(`-account:${account}\\b`, 'i');
  if (excludedPattern.test(current)) {
    return; // Already excluded
  }

  // Add exclusion
  input.value = current ? `${current} -account:${account}` : `-account:${account}`;
  applyFiltersAndSave();
}

function removeAccountFromSearch(account: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();

  // Remove account:xxx pattern
  const accountPattern = new RegExp(`\\baccount:${account}\\b`, 'gi');
  let newValue = current.replace(accountPattern, '').trim();

  // Clean up multiple spaces
  newValue = newValue.replace(/\s+/g, ' ');

  input.value = newValue;
  applyFiltersAndSave();
}

function removeExcludedAccountFromSearch(account: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();

  // Remove -account:xxx pattern
  const excludedPattern = new RegExp(`-account:${account}\\b`, 'gi');
  let newValue = current.replace(excludedPattern, '').trim();

  // Clean up multiple spaces
  newValue = newValue.replace(/\s+/g, ' ');

  input.value = newValue;
  applyFiltersAndSave();
}

// Toggle rating in search input (for rating filter pills)
function toggleRatingInSearch(rating: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();
  const parsed = parseTagSearch(current);

  // Check if this rating is already active
  const isActive = rating === 'unrated'
    ? parsed.includeUnrated
    : parsed.ratings.has(rating);

  if (isActive) {
    // Remove this rating from search
    if (rating === 'unrated') {
      // Remove is:unrated
      const newValue = current.replace(/\bis:unrated\b/gi, '').replace(/\s+/g, ' ').trim();
      input.value = newValue;
    } else {
      // Remove rating from rating: metatag
      const remainingRatings = Array.from(parsed.ratings).filter(r => r !== rating).sort();

      // Remove old rating: pattern - match comma-separated list first, then single values
      let newValue = current.replace(/rating:([gsqe](?:,[gsqe])+|general|sensitive|questionable|explicit|[gsqe])/gi, '').replace(/\s+/g, ' ').trim();

      // Add back remaining ratings if any
      if (remainingRatings.length > 0) {
        const ratingStr = `rating:${remainingRatings.join(',')}`;
        newValue = newValue ? `${newValue} ${ratingStr}` : ratingStr;
      }

      input.value = newValue;
    }
  } else {
    // Add this rating to search
    if (rating === 'unrated') {
      // Add is:unrated
      const newValue = current ? `${current} is:unrated` : 'is:unrated';
      input.value = newValue;
    } else {
      // Add to existing rating: or create new one
      const existingRatings = Array.from(parsed.ratings);
      existingRatings.push(rating);
      existingRatings.sort(); // Sort for consistent ordering

      // Remove old rating: pattern - match comma-separated list first, then single values
      let newValue = current.replace(/rating:([gsqe](?:,[gsqe])+|general|sensitive|questionable|explicit|[gsqe])/gi, '').replace(/\s+/g, ' ').trim();

      // Add new rating list
      const ratingStr = `rating:${existingRatings.join(',')}`;
      newValue = newValue ? `${newValue} ${ratingStr}` : ratingStr;

      input.value = newValue;
    }
  }

  applyFiltersAndSave();
}

// Update rating pill UI to reflect current search state and counts
function updateRatingPills() {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const parsed = parseTagSearch(input.value.trim());

  // Calculate rating counts based on current filters (excluding rating filter)
  const ratingCounts = getRatingCounts();

  // Update each pill's active state and count
  const pills = document.querySelectorAll('.rating-filter-pill');
  pills.forEach((pill) => {
    const rating = pill.getAttribute('data-rating');
    if (!rating) return;

    const isActive = rating === 'unrated'
      ? parsed.includeUnrated
      : parsed.ratings.has(rating);

    if (isActive) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }

    // Update count
    const countSpan = pill.querySelector('.rating-count');
    if (countSpan) {
      const count = ratingCounts[rating as keyof typeof ratingCounts] || 0;
      countSpan.textContent = count.toString();
    }
  });
}

// Calculate rating counts for all images matching current filters (excluding rating filter)
// NOTE: This intentionally duplicates filter logic from applyFilters() but EXCLUDES rating filter.
// This allows showing counts for each rating based on current search/tag/account filters.
// If you modify applyFilters(), update this function to match (except for rating filter).
function getRatingCounts(): { g: number; s: number; q: number; e: number; unrated: number } {
  const urlSearchInput = document.getElementById('url-search-input') as HTMLInputElement;
  const tagSearchInput = document.getElementById('tag-search-input') as HTMLInputElement;
  return computeRatingCounts(state.images, {
    view: state.currentView,
    urlSearch: urlSearchInput?.value ?? '',
    tagSearch: tagSearchInput?.value ?? '',
  });
}

// parseTagSearch moved to tag-utils.ts

/**
 * Runs filter logic and updates state.filteredImages without rendering.
 */
function applyFiltersWithoutRender(): void {
  // Re-sort first so updated images move to correct position
  applySorting();

  const urlSearchInput = document.getElementById('url-search-input') as HTMLInputElement;
  const tagSearchInput = document.getElementById('tag-search-input') as HTMLInputElement;

  const filtered = filterImages(state.images, {
    view: state.currentView,
    urlSearch: urlSearchInput?.value ?? '',
    tagSearch: tagSearchInput?.value ?? '',
  });

  // Store filtered images for select all
  state.filteredImages = filtered;

  // Clean up selection: remove IDs that are not in filtered results
  const filteredIds = new Set(filtered.map(img => img.id));
  for (const id of state.selectedIds) {
    if (!filteredIds.has(id)) {
      state.selectedIds.delete(id);
    }
  }

  // Update sidebars based on grouping mode
  const tagSidebar = document.getElementById('tag-sidebar');
  const accountSidebar = document.getElementById('account-sidebar');

  if (state.groupBy === 'x-account') {
    // Show BOTH account sidebar and tag sidebar
    updateAccountSidebar(filtered);
    updateTagSidebar(filtered);
    if (accountSidebar) accountSidebar.style.display = '';
  } else {
    // Show only tag sidebar, hide account sidebar
    updateTagSidebar(filtered);
    if (accountSidebar) accountSidebar.style.display = 'none';
  }
}

async function applyFilters() {
  applyFiltersWithoutRender();

  // Update counters immediately after filtering (before rendering)
  updateImageCount();
  updateViewBadges();
  updateSelectionCount();
  updatePreviewPane();
  updateRatingPills();

  // Render images (async - chunked for large datasets)
  await renderImages(state.filteredImages);
}

// Apply filters and save search state (for search input modifications)
async function applyFiltersAndSave() {
  await applyFilters();
  saveSearchState();
}

function applySorting() {
  sortImages(state.images, state.sort);
}

// Placeholder for unloaded images
// Context menu for rating changes
function createRatingContextMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.id = 'rating-context-menu';
  menu.className = 'rating-context-menu';

  const ratingOptions = [
    { value: 'g', label: 'G', color: '#28a745' },
    { value: 's', label: 'S', color: '#ffc107' },
    { value: 'q', label: 'Q', color: '#fd7e14' },
    { value: 'e', label: 'E', color: '#dc3545' },
    { value: '', label: 'Unrated', color: '#6c757d' }
  ];

  menu.innerHTML = ratingOptions.map(opt => `
    <button class="rating-context-menu__option" data-rating="${opt.value}">
      <span class="rating-context-menu__badge" style="background-color: ${opt.color}"></span>
      <span class="rating-context-menu__label">${opt.label}</span>
    </button>
  `).join('');

  return menu;
}

// Context menu for tag removal
function createTagContextMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.id = 'tag-context-menu';
  menu.className = 'tag-context-menu';

  menu.innerHTML = `
    <button class="tag-context-menu__option tag-context-menu__option--remove">
      <span class="tag-context-menu__label">Remove tag</span>
    </button>
  `;

  return menu;
}

function positionContextMenu(menu: HTMLElement, x: number, y: number): void {
  // Show menu temporarily to measure dimensions
  menu.style.display = 'block';
  const rect = menu.getBoundingClientRect();

  // Calculate position, keeping menu within viewport
  let left = x;
  let top = y;

  // Prevent overflow on right
  if (left + rect.width > window.innerWidth) {
    left = window.innerWidth - rect.width - 10;
  }

  // Prevent overflow on bottom
  if (top + rect.height > window.innerHeight) {
    top = window.innerHeight - rect.height - 10;
  }

  // Prevent overflow on left/top
  left = Math.max(10, left);
  top = Math.max(10, top);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeContextMenus(): void {
  if (ratingContextMenu) {
    ratingContextMenu.style.display = 'none';
  }
  if (tagContextMenu) {
    tagContextMenu.style.display = 'none';
  }
  contextMenuTargetImageId = null;
  contextMenuTargetTag = null;
}

// Create image card HTML (shared by grouped and ungrouped rendering)
function createImageCardHTML(image: ImageMetadata): string {
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

function observePreviewThumbnails() {
  if (!previewThumbnailObserver) {
    setupPreviewThumbnailObserver();
  }

  const thumbnails = document.querySelectorAll('.preview-thumbnail__image[data-image-id]');
  thumbnails.forEach(img => {
    previewThumbnailObserver!.observe(img);
  });
}

async function renderImages(images: ImageMetadata[]) {
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

async function handleDownload(e: Event) {
  const target = e.target as HTMLElement;
  const btn = target.closest('.download-btn') as HTMLElement;
  if (!btn) return;

  const id = btn.dataset.id!;
  const image = state.images.find(img => img.id === id);
  if (image) {
    await loadImageBlob(id);
    const blob = state.loadedBlobs.get(id);
    if (!blob) return;

    const { getExtensionFromMimeType } = await import('./dump');
    const extension = getExtensionFromMimeType(image.mimeType);
    const filename = `${image.id}${extension}`;

    const url = URL.createObjectURL(blob);
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
  const input = document.getElementById('lightbox-tag-input') as HTMLTextAreaElement;
  if (!input) return;

  const tagsString = input.value.trim();
  const tags = tagsString
    ? tagsString.split(/\s+/).filter(tag => tag.length > 0)
    : [];

  // Remove duplicates using Set
  const uniqueTags = Array.from(new Set(tags));

  await updateImageTags(id, uniqueTags);

  // Update local state (same pattern as rating updates)
  const imageInState = state.images.find(img => img.id === id);
  if (imageInState) {
    // Extract rating from tags if present (same logic as updateImageTags in service.ts)
    const ratingTag = uniqueTags.find(tag => /^rating:[gsqe]$/i.test(tag));
    const cleanedTags = uniqueTags.filter(tag => !/^rating:[gsqe]$/i.test(tag));

    imageInState.tags = cleanedTags.length > 0 ? cleanedTags : undefined;
    if (ratingTag) {
      const match = ratingTag.match(/^rating:([gsqe])$/i);
      if (match) {
        imageInState.rating = match[1].toLowerCase() as 'g' | 's' | 'q' | 'e';
      }
    }
    imageInState.updatedAt = Date.now();
  }

  // Update lightbox metadata to show new tags
  if (imageInState) {
    updateLightboxMetadata(imageInState);
  }

  // Re-render grid to reflect changes
  applyFilters();
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
  const countEl = document.querySelector('.header__image-count')!;
  const totalCount = state.images.filter(img => !img.isDeleted).length;
  const filteredCount = state.filteredImages.length;

  if (filteredCount === totalCount) {
    countEl.textContent = `${totalCount} image${totalCount !== 1 ? 's' : ''}`;
  } else {
    countEl.textContent = `Showing ${filteredCount} of ${totalCount} images`;
  }
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
  updateButtonStates();
}

function updateButtonStates() {
  const hasSelection = state.selectedIds.size > 0;
  const tagSelectedBtn = document.getElementById('tag-selected-btn') as HTMLButtonElement;
  const deleteSelectedBtn = document.getElementById('delete-selected-btn') as HTMLButtonElement;
  const dumpSelectedBtn = document.getElementById('dump-selected-btn') as HTMLButtonElement;
  const restoreSelectedBtn = document.getElementById('restore-selected-btn') as HTMLButtonElement;
  const deselectAllBtn = document.getElementById('deselect-all-btn') as HTMLButtonElement;

  if (tagSelectedBtn) tagSelectedBtn.disabled = !hasSelection;
  if (deleteSelectedBtn) deleteSelectedBtn.disabled = !hasSelection;
  if (dumpSelectedBtn) dumpSelectedBtn.disabled = !hasSelection;
  if (restoreSelectedBtn) restoreSelectedBtn.disabled = !hasSelection;
  if (deselectAllBtn) deselectAllBtn.disabled = !hasSelection;
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

async function updatePreviewPane() {
  const content = document.getElementById('preview-pane-content')!;
  const selectedImages = state.filteredImages.filter(img => state.selectedIds.has(img.id));

  if (selectedImages.length === 0) {
    content.innerHTML = '<div class="preview-empty">No items selected</div>';
  } else if (selectedImages.length === 1) {
    await renderSinglePreview(selectedImages[0], content);
  } else {
    await renderMultiPreview(selectedImages, content);
  }
}

async function renderSinglePreview(image: ImageMetadata, container: HTMLElement) {
  await loadImageBlob(image.id);
  const url = getOrCreateObjectURL(image.id);
  const date = new Date(image.savedAt).toLocaleString();
  const fileSize = formatFileSize(image.fileSize);

  const truncateUrl = (url: string, maxLength: number = 50) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
  };

  const tagsHTML = image.tags && image.tags.length > 0
    ? sortTags(image.tags).map(tag => `<span class="preview-meta-tags__tag">${tag}</span>`).join('')
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
          <span class="preview-meta-label">Page Title</span>
          <input type="text" class="preview-meta-input" id="preview-page-title-${image.id}" value="${image.pageTitle || ''}" placeholder="Enter page title">
        </div>
        <div class="preview-meta-row">
          <span class="preview-meta-label">Page URL</span>
          <input type="url" class="preview-meta-input" id="preview-page-url-${image.id}" value="${image.pageUrl}" placeholder="Enter page URL">
        </div>
        <div class="preview-meta-row">
          <span class="preview-meta-label">Image URL</span>
          <span class="preview-meta-value preview-meta-readonly" title="${image.imageUrl}">${truncateUrl(image.imageUrl)}</span>
        </div>
        <div class="preview-meta-row">
          <span class="preview-meta-label">Tags</span>
          <div class="preview-meta-tags">${tagsHTML}</div>
        </div>
        <div class="preview-meta-row">
          <div class="tag-input-container">
            <textarea id="preview-tag-input-${image.id}" class="preview-tag-input" placeholder="Add tags (space-separated)..." rows="3">${image.tags ? sortTags(image.tags).join(' ') : ''}</textarea>
            <div id="preview-tag-autocomplete-${image.id}" class="tag-autocomplete"></div>
          </div>
        </div>
        <div class="preview-meta-row">
          <span class="preview-meta-label">Rating</span>
          <div class="preview-rating-selector">
            <label class="rating-radio">
              <input class="rating-radio__input" type="radio" name="preview-rating-${image.id}" value="g" ${image.rating === 'g' ? 'checked' : ''}>
              <span class="rating-radio__label">G</span>
            </label>
            <label class="rating-radio">
              <input class="rating-radio__input" type="radio" name="preview-rating-${image.id}" value="s" ${image.rating === 's' ? 'checked' : ''}>
              <span class="rating-radio__label">S</span>
            </label>
            <label class="rating-radio">
              <input class="rating-radio__input" type="radio" name="preview-rating-${image.id}" value="q" ${image.rating === 'q' ? 'checked' : ''}>
              <span class="rating-radio__label">Q</span>
            </label>
            <label class="rating-radio">
              <input class="rating-radio__input" type="radio" name="preview-rating-${image.id}" value="e" ${image.rating === 'e' ? 'checked' : ''}>
              <span class="rating-radio__label">E</span>
            </label>
            <label class="rating-radio">
              <input class="rating-radio__input" type="radio" name="preview-rating-${image.id}" value="" ${!image.rating ? 'checked' : ''}>
              <span class="rating-radio__label">-</span>
            </label>
          </div>
        </div>
      </div>
      <div class="preview-actions">
        <button class="button button--sm button--secondary preview-actions__button view-page-btn preview-view-page-btn" data-id="${image.id}">Source</button>
        <button class="button button--sm button--secondary preview-actions__button preview-view-btn" data-id="${image.id}">View</button>
        <button class="button button--sm button--secondary preview-actions__button download-btn preview-download-btn" data-id="${image.id}">Save</button>
        <button class="button button--sm button--primary preview-actions__button preview-danbooru-btn" data-id="${image.id}">Danbooru</button>
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
      const visualOrder = getVisualOrder(state.filteredImages, state.groupBy);
      const index = visualOrder.findIndex(img => img.id === image.id);
      if (index !== -1) openLightbox(index);
    });
  }
  const danbooruBtn = container.querySelector('.preview-danbooru-btn');
  if (danbooruBtn) {
    danbooruBtn.addEventListener('click', () => openDanbooruUploadModal(image.id));
  }

  // Attach rating change listeners
  const ratingRadios = container.querySelectorAll(`input[name="preview-rating-${image.id}"]`);
  ratingRadios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      const ratingValue = target.value || undefined;
      const { updateImageRating } = await import('../storage/service');
      await updateImageRating(image.id, ratingValue as any);
      await syncImageMetadataToState(image.id, 'rating', ratingValue as any);
    });
  });

  // Attach metadata auto-save on blur for preview sidebar
  const previewPageTitleInput = document.getElementById(`preview-page-title-${image.id}`) as HTMLInputElement;
  const previewPageUrlInput = document.getElementById(`preview-page-url-${image.id}`) as HTMLInputElement;

  if (previewPageTitleInput) {
    previewPageTitleInput.addEventListener('blur', async () => {
      const newPageTitle = previewPageTitleInput.value.trim() || undefined;
      const { updateImagePageTitle } = await import('../storage/service');
      await updateImagePageTitle(image.id, newPageTitle);
      await syncImageMetadataToState(image.id, 'pageTitle', newPageTitle);
    });
  }

  if (previewPageUrlInput) {
    previewPageUrlInput.addEventListener('blur', async () => {
      const newPageUrl = previewPageUrlInput.value.trim();

      if (!newPageUrl) {
        alert('Page URL cannot be empty');
        previewPageUrlInput.value = image.pageUrl;
        return;
      }

      const { updateImagePageUrl } = await import('../storage/service');
      await updateImagePageUrl(image.id, newPageUrl);
      await syncImageMetadataToState(image.id, 'pageUrl', newPageUrl);
    });
  }

  // Attach tag input with autocomplete and auto-save on blur
  const previewTagInput = document.getElementById(`preview-tag-input-${image.id}`) as HTMLTextAreaElement;
  if (previewTagInput) {
    setupTagAutocomplete(previewTagInput, `preview-tag-autocomplete-${image.id}`, {
      onEnterComplete: async () => {
        // Save tags when Enter is pressed with complete token
        const tagsString = previewTagInput.value.trim();
        const tags = tagsString
          ? tagsString.split(/\s+/).filter(tag => tag.length > 0)
          : [];

        // Remove duplicates using Set
        const uniqueTags = Array.from(new Set(tags));

        const { updateImageTags } = await import('../storage/service');
        await updateImageTags(image.id, uniqueTags);
        await syncImageMetadataToState(image.id, 'tags', uniqueTags);
      }
    });

    // Append space on focus for easier tag appending
    previewTagInput.addEventListener('focus', () => {
      const value = previewTagInput.value;
      if (value.length > 0 && !value.endsWith(' ')) {
        previewTagInput.value = value + ' ';
        // Move cursor to end
        previewTagInput.setSelectionRange(previewTagInput.value.length, previewTagInput.value.length);
      }
    });

    // Auto-save on blur
    previewTagInput.addEventListener('blur', async () => {
      const tagsString = previewTagInput.value.trim();
      const tags = tagsString
        ? tagsString.split(/\s+/).filter(tag => tag.length > 0)
        : [];

      // Remove duplicates using Set
      const uniqueTags = Array.from(new Set(tags));

      const { updateImageTags } = await import('../storage/service');
      await updateImageTags(image.id, uniqueTags);
      await syncImageMetadataToState(image.id, 'tags', uniqueTags);
    });
  }
}

async function renderMultiPreview(images: ImageMetadata[], container: HTMLElement) {
  const count = images.length;

  // Use placeholder initially, load lazily with IntersectionObserver
  const thumbnails = images.map(image => {
    return `
      <div class="preview-thumbnail" data-id="${image.id}">
        <img class="preview-thumbnail__image" src="${PLACEHOLDER_IMAGE}" data-image-id="${image.id}" alt="Thumbnail">
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
      <div class="preview-bulk-tag">
        <div class="preview-bulk-tag__section">
          <label class="preview-bulk-tag__label">Add tags</label>
          <input type="text" class="preview-bulk-tag__input" id="preview-add-tags-input" placeholder="Enter tags to add">
          <div id="preview-add-autocomplete" class="tag-autocomplete"></div>
        </div>
        <div class="preview-bulk-tag__section">
          <label class="preview-bulk-tag__label">Remove tags</label>
          <input type="text" class="preview-bulk-tag__input" id="preview-remove-tags-input" placeholder="Enter tags to remove">
          <div id="preview-remove-autocomplete" class="tag-autocomplete"></div>
          <div id="preview-remove-quick-tags" class="preview-remove-quick-tags"></div>
        </div>
        <div class="preview-bulk-tag__section">
          <label class="preview-bulk-tag__label">Set rating</label>
          <div class="preview-bulk-tag__ratings">
            <label class="preview-bulk-tag__rating">
              <input type="radio" name="preview-bulk-rating" value="g">
              <span>G</span>
            </label>
            <label class="preview-bulk-tag__rating">
              <input type="radio" name="preview-bulk-rating" value="s">
              <span>S</span>
            </label>
            <label class="preview-bulk-tag__rating">
              <input type="radio" name="preview-bulk-rating" value="q">
              <span>Q</span>
            </label>
            <label class="preview-bulk-tag__rating">
              <input type="radio" name="preview-bulk-rating" value="e">
              <span>E</span>
            </label>
            <label class="preview-bulk-tag__rating">
              <input type="radio" name="preview-bulk-rating" value="unrated">
              <span>-</span>
            </label>
            <label class="preview-bulk-tag__rating">
              <input type="radio" name="preview-bulk-rating" value="" checked>
              <span>×</span>
            </label>
          </div>
        </div>
        <button class="preview-bulk-tag__button preview-bulk-tag__button--primary" id="preview-bulk-save-btn">
          Apply Changes
        </button>
      </div>
    </div>
  `;

  // Attach click handlers to thumbnails
  const thumbElements = container.querySelectorAll('.preview-thumbnail');
  thumbElements.forEach(thumb => {
    thumb.addEventListener('click', () => {
      const id = thumb.getAttribute('data-id')!;
      const visualOrder = getVisualOrder(state.filteredImages, state.groupBy);
      const index = visualOrder.findIndex(img => img.id === id);
      if (index !== -1) openLightbox(index);
    });
  });

  // Setup lazy loading for preview thumbnails
  observePreviewThumbnails();

  // Setup bulk tagging
  setupPreviewBulkTagging(images);
}

function setupPreviewBulkTagging(images: ImageMetadata[]) {
  const addInput = document.getElementById('preview-add-tags-input') as HTMLInputElement;
  const removeInput = document.getElementById('preview-remove-tags-input') as HTMLInputElement;
  const saveBtn = document.getElementById('preview-bulk-save-btn') as HTMLButtonElement;

  if (!addInput || !removeInput || !saveBtn) return;

  // Setup autocomplete for add input (all tags)
  setupTagAutocomplete(addInput, 'preview-add-autocomplete', {
    onEnterComplete: () => {
      removeInput.focus();
    }
  });

  // Setup autocomplete for remove input (only tags from selected images)
  const selectedImageTags = new Set<string>();
  images.forEach(img => {
    if (img.tags && img.tags.length > 0) {
      img.tags.forEach(tag => selectedImageTags.add(tag));
    }
  });
  const selectedImageTagsArray = Array.from(selectedImageTags);
  setupTagAutocomplete(removeInput, 'preview-remove-autocomplete', {
    customTags: selectedImageTagsArray,
    onEnterComplete: () => {
      removeInput.blur();
    }
  });

  // Populate quick remove tag pills
  populatePreviewQuickRemoveTags(images);

  // Save button click handler
  saveBtn.addEventListener('click', applyPreviewBulkTags);
}

async function applyPreviewBulkTags() {
  const addInput = document.getElementById('preview-add-tags-input') as HTMLInputElement;
  const removeInput = document.getElementById('preview-remove-tags-input') as HTMLInputElement;

  if (!addInput || !removeInput || state.selectedIds.size === 0) return;

  const selectedImageIds = Array.from(state.selectedIds);

  // Parse add tags
  const addTagsString = addInput.value.trim();
  const tagsToAdd = addTagsString
    ? addTagsString.split(/\s+/).filter(tag => tag.length > 0)
    : [];

  // Parse remove tags
  const removeTagsString = removeInput.value.trim();
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

  // Apply rating if selected
  const selectedRating = document.querySelector('input[name="preview-bulk-rating"]:checked') as HTMLInputElement;
  if (selectedRating && selectedRating.value !== '') {
    const { updateImagesRating } = await import('../storage/service');
    const ratingValue = selectedRating.value === 'unrated' ? undefined : selectedRating.value as ('g' | 's' | 'q' | 'e');
    await updateImagesRating(selectedImageIds, ratingValue);
  }

  // Clear inputs
  addInput.value = '';
  removeInput.value = '';

  // Reset rating to "No Change"
  const noChangeRating = document.querySelector('input[name="preview-bulk-rating"][value=""]') as HTMLInputElement;
  if (noChangeRating) noChangeRating.checked = true;

  // Reload images and update preview
  await loadImages();
  updatePreviewPane();
}

function populatePreviewQuickRemoveTags(images: ImageMetadata[]) {
  const quickTagsContainer = document.getElementById('preview-remove-quick-tags');
  const removeInput = document.getElementById('preview-remove-tags-input') as HTMLInputElement;

  if (!quickTagsContainer || !removeInput) return;

  quickTagsContainer.innerHTML = '';

  // Get tag frequency from selected images
  const tagFrequency = new Map<string, number>();

  images.forEach(img => {
    if (img.tags && img.tags.length > 0) {
      img.tags.forEach(tag => {
        tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
      });
    }
  });

  // Sort by frequency and take top tags
  const sortedTags = Array.from(tagFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(entry => entry[0]);

  if (sortedTags.length === 0) {
    quickTagsContainer.style.display = 'none';
    return;
  }

  quickTagsContainer.style.display = '';

  sortedTags.forEach(tag => {
    const pill = document.createElement('button');
    pill.className = 'preview-remove-quick-tags__pill';
    const count = tagFrequency.get(tag)!;
    pill.textContent = `${tag} (${count})`;
    pill.type = 'button';
    pill.dataset.tag = tag;
    pill.addEventListener('click', () => {
      toggleTagInInput(removeInput, tag);
      updatePreviewQuickRemoveTagsState();
      removeInput.focus();
    });
    quickTagsContainer.appendChild(pill);
  });

  // Update initial state
  updatePreviewQuickRemoveTagsState();

  // Listen to input changes to update pill states
  removeInput.addEventListener('input', updatePreviewQuickRemoveTagsState);
}

function updatePreviewQuickRemoveTagsState() {
  const quickTagsContainer = document.getElementById('preview-remove-quick-tags');
  const removeInput = document.getElementById('preview-remove-tags-input') as HTMLInputElement;

  if (!quickTagsContainer || !removeInput) return;

  const inputValue = removeInput.value.trim();
  const tagsInInput = inputValue ? inputValue.split(/\s+/) : [];

  quickTagsContainer.querySelectorAll('.preview-remove-quick-tags__pill').forEach(pill => {
    const pillElement = pill as HTMLButtonElement;
    const tag = pillElement.dataset.tag!;
    if (tagsInInput.includes(tag)) {
      pillElement.classList.add('preview-remove-quick-tags__pill--active');
    } else {
      pillElement.classList.remove('preview-remove-quick-tags__pill--active');
    }
  });
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

/**
 * Returns images in their visual rendering order.
 * This matches the DOM order when grouping is enabled.
 */
function handleImageClick(e: Event) {
  const imageCard = (e.target as HTMLElement).closest('.image-card');
  if (!imageCard) return;

  const id = imageCard.getAttribute('data-id')!;
  const visualOrder = getVisualOrder(state.filteredImages, state.groupBy);
  const index = visualOrder.findIndex(img => img.id === id);
  if (index !== -1) {
    openLightbox(index);
  }
}

function openLightbox(index: number) {
  const visualOrder = getVisualOrder(state.filteredImages, state.groupBy);
  const image = visualOrder[index];
  if (!image) return;

  state.currentLightboxIndex = index;
  state.lightboxActive = true;

  updateLightboxContent(image);

  const lightbox = document.getElementById('lightbox')!;
  lightbox.classList.add('active');
}

async function updateLightboxContent(image: ImageMetadata) {
  await loadImageBlob(image.id);
  const lightboxImage = document.getElementById('lightbox-image') as HTMLImageElement;
  const url = getOrCreateObjectURL(image.id);
  lightboxImage.src = url;

  updateLightboxMetadata(image);
}

function updateLightboxMetadata(image: ImageMetadata) {
  const metadata = document.querySelector('.lightbox-metadata');
  if (!metadata) return;

  const date = new Date(image.savedAt).toLocaleString();
  const fileSize = formatFileSize(image.fileSize);

  const tagsValue = image.tags && image.tags.length > 0
    ? sortTags(image.tags).map(tag => `<span class="metadata-tags__tag">${tag}</span>`).join('')
    : '<span class="no-tags">No tags</span>';

  // Get rating display info
  const getRatingInfo = (rating?: string) => {
    switch (rating) {
      case 'g': return { text: 'General', badge: 'G', color: '#4caf50' };
      case 's': return { text: 'Sensitive', badge: 'S', color: '#ff9800' };
      case 'q': return { text: 'Questionable', badge: 'Q', color: '#ff5722' };
      case 'e': return { text: 'Explicit', badge: 'E', color: '#f44336' };
      default: return { text: 'Unrated', badge: '—', color: '#9e9e9e' };
    }
  };

  const ratingInfo = getRatingInfo(image.rating);

  metadata.innerHTML = `
    <h3>Image Details</h3>
    <div class="metadata-row">
      <div class="lightbox-actions">
        <button class="button button--sm button--secondary view-page-btn lightbox-view-page-btn" data-id="${image.id}">Source</button>
        <button class="button button--sm button--secondary view-btn lightbox-view-original-btn" data-id="${image.id}">Raw</button>
        <button class="button button--sm button--secondary download-btn lightbox-download-btn" data-id="${image.id}">Save</button>
        <button class="button button--sm button--primary lightbox-edit-metadata-btn" data-id="${image.id}">Edit</button>
      </div>
    </div>
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
    <div class="metadata-row" id="lightbox-page-title-row-${image.id}">
      <span class="metadata-label">Page Title:</span>
      <span class="metadata-value">${image.pageTitle || '(not set)'}</span>
    </div>
    <div class="metadata-row" id="lightbox-page-url-row-${image.id}">
      <span class="metadata-label">Page URL:</span>
      <span class="metadata-value" title="${image.pageUrl}">${image.pageUrl}</span>
    </div>
    <div class="metadata-row">
      <span class="metadata-label">Image URL:</span>
      <span class="metadata-value metadata-readonly" title="${image.imageUrl}">${image.imageUrl}</span>
    </div>
    <div class="metadata-row">
      <span class="metadata-label">Rating:</span>
      <div class="metadata-rating-display">
        <span class="metadata-rating-badge" style="background-color: ${ratingInfo.color}">${ratingInfo.badge}</span>
        <span class="rating-text">${ratingInfo.text}</span>
      </div>
    </div>
    <div class="metadata-row">
      <span class="metadata-label">Change Rating:</span>
      <div class="lightbox-rating-selector">
        <label class="rating-radio">
          <input class="rating-radio__input" type="radio" name="lightbox-rating-${image.id}" value="g" ${image.rating === 'g' ? 'checked' : ''}>
          <span class="rating-radio__label">G</span>
        </label>
        <label class="rating-radio">
          <input class="rating-radio__input" type="radio" name="lightbox-rating-${image.id}" value="s" ${image.rating === 's' ? 'checked' : ''}>
          <span class="rating-radio__label">S</span>
        </label>
        <label class="rating-radio">
          <input class="rating-radio__input" type="radio" name="lightbox-rating-${image.id}" value="q" ${image.rating === 'q' ? 'checked' : ''}>
          <span class="rating-radio__label">Q</span>
        </label>
        <label class="rating-radio">
          <input class="rating-radio__input" type="radio" name="lightbox-rating-${image.id}" value="e" ${image.rating === 'e' ? 'checked' : ''}>
          <span class="rating-radio__label">E</span>
        </label>
        <label class="rating-radio">
          <input class="rating-radio__input" type="radio" name="lightbox-rating-${image.id}" value="" ${!image.rating ? 'checked' : ''}>
          <span class="rating-radio__label">-</span>
        </label>
      </div>
    </div>
    <div class="metadata-row">
      <span class="metadata-label">Tags:</span>
      <div class="metadata-tags">${tagsValue}</div>
    </div>
    <div class="metadata-row">
      <div class="tag-input-container">
        <textarea id="lightbox-tag-input" class="tag-input" placeholder="Add tags (space-separated)..." rows="3">${image.tags ? sortTags(image.tags).join(' ') : ''}</textarea>
        <div id="tag-autocomplete" class="tag-autocomplete"></div>
      </div>
    </div>
  `;

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

  // Attach metadata edit/save toggle listener for lightbox
  const editMetadataBtn = metadata.querySelector('.lightbox-edit-metadata-btn') as HTMLButtonElement;
  let isEditMode = false;

  if (editMetadataBtn) {
    editMetadataBtn.addEventListener('click', async () => {
      if (!isEditMode) {
        // Switch to edit mode
        const pageTitleRow = document.getElementById(`lightbox-page-title-row-${image.id}`);
        const pageUrlRow = document.getElementById(`lightbox-page-url-row-${image.id}`);

        if (pageTitleRow && pageUrlRow) {
          pageTitleRow.innerHTML = `
            <span class="metadata-label">Page Title:</span>
            <input type="text" class="lightbox-meta-input" id="lightbox-page-title-input-${image.id}" value="${image.pageTitle || ''}" placeholder="Enter page title">
          `;
          pageUrlRow.innerHTML = `
            <span class="metadata-label">Page URL:</span>
            <input type="url" class="lightbox-meta-input" id="lightbox-page-url-input-${image.id}" value="${image.pageUrl}" placeholder="Enter page URL">
          `;

          editMetadataBtn.textContent = 'Save Metadata';
          editMetadataBtn.classList.remove('button--secondary');
          editMetadataBtn.classList.add('button--primary');
          isEditMode = true;
        }
      } else {
        // Save and switch back to display mode
        const pageTitleInput = document.getElementById(`lightbox-page-title-input-${image.id}`) as HTMLInputElement;
        const pageUrlInput = document.getElementById(`lightbox-page-url-input-${image.id}`) as HTMLInputElement;

        if (pageTitleInput && pageUrlInput) {
          const newPageTitle = pageTitleInput.value.trim() || undefined;
          const newPageUrl = pageUrlInput.value.trim();

          if (!newPageUrl) {
            alert('Page URL cannot be empty');
            return;
          }

          const { updateImagePageTitle, updateImagePageUrl } = await import('../storage/service');
          await updateImagePageTitle(image.id, newPageTitle);
          await updateImagePageUrl(image.id, newPageUrl);

          await syncImageMetadataToState(image.id, 'pageTitle', newPageTitle);
          await syncImageMetadataToState(image.id, 'pageUrl', newPageUrl);

          // Update lightbox metadata display
          const imageInState = state.images.find(img => img.id === image.id);
          updateLightboxMetadata(imageInState || image);
        }
      }
    });
  }

  // Attach rating change listeners
  const ratingRadios = metadata.querySelectorAll(`input[name="lightbox-rating-${image.id}"]`);
  ratingRadios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      const ratingValue = target.value || undefined;
      const { updateImageRating } = await import('../storage/service');
      await updateImageRating(image.id, ratingValue as any);

      await syncImageMetadataToState(image.id, 'rating', ratingValue as any);

      // Update lightbox metadata display
      const imageInState = state.images.find(img => img.id === image.id);
      updateLightboxMetadata(imageInState || image);
    });
  });

  // Setup tag autocomplete with save callback
  const input = document.getElementById('lightbox-tag-input') as HTMLTextAreaElement;
  if (input) {
    setupTagAutocomplete(input, 'tag-autocomplete', {
      onEnterComplete: async () => {
        // Save tags when Enter is pressed with complete token
        const tagsString = input.value.trim();
        const tags = tagsString
          ? tagsString.split(/\s+/).filter(tag => tag.length > 0)
          : [];

        // Remove duplicates using Set
        const uniqueTags = Array.from(new Set(tags));

        await updateImageTags(image.id, uniqueTags);

        await syncImageMetadataToState(image.id, 'tags', uniqueTags);

        // Update lightbox metadata display
        const imageInState = state.images.find(img => img.id === image.id);
        updateLightboxMetadata(imageInState || image);
      }
    });

    // Append space on focus for easier tag appending
    input.addEventListener('focus', () => {
      const value = input.value;
      if (value.length > 0 && !value.endsWith(' ')) {
        input.value = value + ' ';
        // Move cursor to end
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox')!;
  lightbox.classList.remove('active');
  state.lightboxActive = false;
  state.currentLightboxIndex = -1;
}

function navigateLightboxByOffset(offset: number) {
  const visualOrder = getVisualOrder(state.filteredImages, state.groupBy);

  // Get all visible image cards in DOM order (respects grouping)
  const allCards = Array.from(document.querySelectorAll('.image-card')) as HTMLElement[];
  if (allCards.length === 0) return;

  // Find current lightbox image's card in DOM
  const currentImage = visualOrder[state.currentLightboxIndex];
  if (!currentImage) return;

  const currentCardIndex = allCards.findIndex(card => card.dataset.id === currentImage.id);
  if (currentCardIndex === -1) return;

  // Calculate new position in DOM order (bounded: edges do nothing)
  const newCardIndex = offsetIndexBounded(currentCardIndex, offset, allCards.length);
  if (newCardIndex === null) return;

  // Get new image from DOM card
  const newCard = allCards[newCardIndex];
  const newImageId = newCard.dataset.id!;
  const newArrayIndex = visualOrder.findIndex(img => img.id === newImageId);
  if (newArrayIndex === -1) return;

  // Update lightbox with new image
  state.currentLightboxIndex = newArrayIndex;
  const newImage = visualOrder[newArrayIndex];
  updateLightboxContent(newImage);

  // Update selection to match current preview (like macOS)
  state.selectedIds.clear();
  state.selectedIds.add(newImageId);
  state.lastSelectedIndex = newArrayIndex;
  state.selectionAnchor = newArrayIndex;

  // Sync grid UI
  updateAllCheckboxes();
  updateSelectionCount();
  updatePreviewPane();
  scrollToImage(newImageId);
}

function navigateNext() {
  navigateLightboxByOffset(1);
}

function navigatePrevious() {
  navigateLightboxByOffset(-1);
}

function getGridColumns(): number {
  // When grouping is enabled, the grid layout is on .group-content, not #image-grid
  let gridElement: HTMLElement;

  if (state.groupBy !== 'none') {
    // Find the first .group-content element (all groups use same grid)
    const firstGroupContent = document.querySelector('.group-content') as HTMLElement;
    if (!firstGroupContent) {
      return 4; // Fallback if no groups exist
    }
    gridElement = firstGroupContent;
  } else {
    // Normal ungrouped view
    gridElement = document.getElementById('image-grid')!;
  }

  const gridStyle = window.getComputedStyle(gridElement);
  const gridTemplateColumns = gridStyle.gridTemplateColumns;

  // Count the number of column definitions
  if (gridTemplateColumns && gridTemplateColumns !== 'none') {
    const columns = gridTemplateColumns.split(' ').length;
    return columns;
  }

  // Fallback estimate for grid view
  return 4;
}

function navigateGridByOffset(offset: number) {
  if (state.filteredImages.length === 0) return;

  // Get all visible image cards in DOM order
  const allCards = Array.from(document.querySelectorAll('.image-card')) as HTMLElement[];
  if (allCards.length === 0) return;

  // Find current card
  let currentCard: HTMLElement | null = null;
  if (state.selectedIds.size === 1) {
    const selectedId = Array.from(state.selectedIds)[0];
    currentCard = allCards.find(card => card.dataset.id === selectedId) || null;
  }

  // If no current selection, start from first card
  if (!currentCard) {
    currentCard = allCards[0];
  }

  const currentIndex = allCards.indexOf(currentCard);

  // Horizontal (offset = ±1) and vertical (offset = ±columns) both clamp to bounds
  const clampedIndex = offsetIndexClamped(currentIndex, offset, allCards.length);
  selectCard(allCards[clampedIndex]);
}

function selectCard(card: HTMLElement) {
  const id = card.dataset.id!;
  const visualOrder = getVisualOrder(state.filteredImages, state.groupBy);
  const index = visualOrder.findIndex(img => img.id === id);

  state.selectedIds.clear();
  state.selectedIds.add(id);
  state.lastSelectedIndex = index;
  state.selectionAnchor = index;

  updateAllCheckboxes();
  updateSelectionCount();
  updatePreviewPane();
  scrollToImage(id);
}

function navigateGridByOffsetExpand(offset: number) {
  if (state.filteredImages.length === 0) return;

  const visualOrder = getVisualOrder(state.filteredImages, state.groupBy);

  // Get all visible image cards in DOM order
  const allCards = Array.from(document.querySelectorAll('.image-card')) as HTMLElement[];
  if (allCards.length === 0) return;

  // If nothing selected, select first item and set as anchor
  if (state.selectedIds.size === 0 || state.selectionAnchor === -1) {
    const firstCard = allCards[0];
    const firstId = firstCard.dataset.id!;
    const firstIndex = visualOrder.findIndex(img => img.id === firstId);

    state.selectedIds.clear();
    state.selectedIds.add(firstId);
    state.lastSelectedIndex = firstIndex;
    state.selectionAnchor = firstIndex;
    updateAllCheckboxes();
    updateSelectionCount();
    updatePreviewPane();
    scrollToImage(firstId);
    return;
  }

  // Find current card in DOM order
  const lastSelectedId = visualOrder[state.lastSelectedIndex]?.id;
  if (!lastSelectedId) return;

  const currentCardIndex = allCards.findIndex(card => card.dataset.id === lastSelectedId);
  if (currentCardIndex === -1) return;

  // Calculate new focus position in DOM order (clamped, like grid navigation)
  const clampedFocusIndex = offsetIndexClamped(currentCardIndex, offset, allCards.length);

  if (clampedFocusIndex !== currentCardIndex) {
    const newFocusCard = allCards[clampedFocusIndex];
    const newFocusId = newFocusCard.dataset.id!;
    const newFocusArrayIndex = visualOrder.findIndex(img => img.id === newFocusId);

    state.lastSelectedIndex = newFocusArrayIndex;

    // Select range from anchor to new focus (using visual order for consistency)
    state.selectedIds.clear();
    const start = Math.min(state.selectionAnchor, newFocusArrayIndex);
    const end = Math.max(state.selectionAnchor, newFocusArrayIndex);
    for (let i = start; i <= end; i++) {
      state.selectedIds.add(visualOrder[i].id);
    }

    updateAllCheckboxes();
    updateSelectionCount();
    updatePreviewPane();
    scrollToImage(newFocusId);
  }
}

function updateAllCheckboxes() {
  // Read current checkbox state from DOM and compare with desired state
  const allCheckboxes = document.querySelectorAll('.image-checkbox') as NodeListOf<HTMLInputElement>;

  // Update only checkboxes that differ from desired state
  allCheckboxes.forEach(cb => {
    const cbId = cb.dataset.id!;
    const shouldBeChecked = state.selectedIds.has(cbId);

    if (cb.checked !== shouldBeChecked) {
      cb.checked = shouldBeChecked;
      const card = cb.closest('.image-card');
      if (card) {
        if (shouldBeChecked) {
          card.classList.add('selected');
        } else {
          card.classList.remove('selected');
        }
      }
    }
  });
}

function scrollToImage(id: string) {
  const card = document.querySelector(`.image-card[data-id="${id}"]`) as HTMLElement;
  if (!card) return;

  card.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
}

// Debounce utility for performance
// Search input event listeners with debouncing
const urlSearchInput = document.getElementById('url-search-input') as HTMLInputElement;
const tagSearchInput = document.getElementById('tag-search-input') as HTMLInputElement;

const debouncedApplyFilters = debounce(() => applyFiltersAndSave(), 200);
const debouncedTagSearch = debounce(() => applyFiltersAndSave(), 200);

// Store the tag autocomplete update function globally
let updateTagAutocompleteAvailableTags: (() => void) | undefined;

if (urlSearchInput) {
  urlSearchInput.addEventListener('input', debouncedApplyFilters);
}

if (tagSearchInput) {
  tagSearchInput.addEventListener('input', debouncedTagSearch);
  const { updateAvailableTags } = setupTagAutocomplete(tagSearchInput, 'tag-search-autocomplete', {
    enableDanbooruSyntax: true
  });
  updateTagAutocompleteAvailableTags = updateAvailableTags!;
}

// Rating filter pill event listeners
const ratingPills = document.querySelectorAll('.rating-filter-pill');
ratingPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const rating = pill.getAttribute('data-rating');
    if (rating) {
      toggleRatingInSearch(rating);
    }
  });
});

// Event delegation for image grid
const imageGrid = document.getElementById('image-grid')!;

// Initialize context menus
ratingContextMenu = createRatingContextMenu();
tagContextMenu = createTagContextMenu();
document.body.appendChild(ratingContextMenu);
document.body.appendChild(tagContextMenu);

// Show appropriate context menu based on target element
imageGrid.addEventListener('contextmenu', (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const card = target.closest('.image-card');

  if (!card) return;

  const imageId = card.getAttribute('data-id');
  if (!imageId) return;

  // Check what element was right-clicked
  // 1. Image preview or rating badge → show rating menu
  if (target.matches('.image-preview') || target.closest('.rating-badge')) {
    e.preventDefault();
    closeContextMenus(); // Close any open menu first
    contextMenuTargetImageId = imageId;
    positionContextMenu(ratingContextMenu!, e.clientX, e.clientY);
    ratingContextMenu!.style.display = 'block';
    return;
  }

  // 2. Tag → show tag removal menu
  if (target.matches('.image-tags__tag')) {
    e.preventDefault();
    const tag = target.getAttribute('data-tag');
    if (!tag) return;

    closeContextMenus(); // Close any open menu first
    contextMenuTargetImageId = imageId;
    contextMenuTargetTag = tag;
    positionContextMenu(tagContextMenu!, e.clientX, e.clientY);
    tagContextMenu!.style.display = 'block';
    return;
  }

  // 3. Other areas of card → allow browser's default context menu
  // Close custom menus if open
  closeContextMenus();
});

// Handle rating option clicks
ratingContextMenu.addEventListener('click', async (e: Event) => {
  const target = e.target as HTMLElement;
  const option = target.closest('.rating-context-menu__option') as HTMLElement;

  if (!option || !contextMenuTargetImageId) return;

  const ratingValue = option.getAttribute('data-rating') || undefined;

  const { updateImageRating } = await import('../storage/service');
  await updateImageRating(contextMenuTargetImageId, ratingValue as any);

  await syncImageMetadataToState(contextMenuTargetImageId, 'rating', ratingValue as any);

  closeContextMenus();
});

// Handle tag removal clicks
tagContextMenu.addEventListener('click', async (e: Event) => {
  const target = e.target as HTMLElement;
  const option = target.closest('.tag-context-menu__option');

  if (!option || !contextMenuTargetImageId || !contextMenuTargetTag) return;

  const image = state.images.find(img => img.id === contextMenuTargetImageId);
  if (!image || !image.tags) return;

  const updatedTags = image.tags.filter(t => t !== contextMenuTargetTag);

  const { updateImageTags } = await import('../storage/service');
  await updateImageTags(contextMenuTargetImageId, updatedTags);

  await syncImageMetadataToState(contextMenuTargetImageId, 'tags', updatedTags);

  closeContextMenus();
});

// Close context menus on click outside
document.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  const clickedInRatingMenu = ratingContextMenu?.contains(target);
  const clickedInTagMenu = tagContextMenu?.contains(target);

  if (!clickedInRatingMenu && !clickedInTagMenu) {
    closeContextMenus();
  }
});

// Close context menus on ESC key
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    closeContextMenus();
  }
});

// Close context menus on scroll
imageGrid.addEventListener('scroll', () => {
  closeContextMenus();
}, { passive: true });

// Also close on window scroll (in case of page-level scrolling)
window.addEventListener('scroll', () => {
  closeContextMenus();
}, { passive: true, capture: true }); // Passive for performance, capture to catch all scroll events

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

  // 2. Account button - toggle account filter
  if (target.matches('.image-account-btn')) {
    const account = target.getAttribute('data-account');
    if (account) {
      e.stopPropagation(); // Prevent card selection
      toggleAccountInSearch(account);
    }
    return;
  }

  // 3. Tag clicks - toggle tag in search input
  if (target.matches('.image-tags__tag')) {
    const tag = target.getAttribute('data-tag');
    if (tag) {
      e.stopPropagation(); // Prevent card selection
      toggleTagInSearch(tag);
    }
    return;
  }

  // 4. Image preview (opens lightbox)
  if (target.matches('.image-preview')) {
    handleImageClick(e);
    return;
  }

  // 5. Checkbox (let the change event handle it)
  if (target.matches('.image-checkbox')) {
    return;
  }

  // 6. Anywhere else on the card → handle selection based on modifier keys
  const card = target.closest('.image-card');
  if (card) {
    const id = card.getAttribute('data-id')!;
    const visualOrder = getVisualOrder(state.filteredImages, state.groupBy);
    const clickedIndex = visualOrder.findIndex(img => img.id === id);

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
        state.selectedIds.add(visualOrder[i].id);
      }
      state.lastSelectedIndex = clickedIndex;
    } else {
      // Normal click: Toggle if single-selected, otherwise single-select
      if (state.selectedIds.has(id) && state.selectedIds.size === 1) {
        // If this is the only selected item, deselect it
        state.selectedIds.delete(id);
      } else {
        // Single-select this item (clear others, select this one)
        state.selectedIds.clear();
        state.selectedIds.add(id);
      }
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

// Dump button (export selected images as ZIP)
document.getElementById('dump-selected-btn')!.addEventListener('click', async () => {
  if (state.selectedIds.size === 0) return;

  const allImages = await getAllImages();
  const selectedImages = allImages.filter(img => state.selectedIds.has(img.id));
  const { dumpImages } = await import('./dump');
  await dumpImages(selectedImages);
});

document.getElementById('select-all-btn')!.addEventListener('click', () => {
  // Only select currently visible/filtered images
  state.filteredImages.forEach(image => {
    state.selectedIds.add(image.id);
  });
  updateAllCheckboxes();
  updateSelectionCount();
  updatePreviewPane();
});

document.getElementById('deselect-all-btn')!.addEventListener('click', () => {
  state.selectedIds.clear();
  updateAllCheckboxes();
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'IMAGE_SAVED') {
    loadSingleImage(message.imageId);
  }
});

// Group by
const groupBySelect = document.getElementById('group-by') as HTMLSelectElement;

groupBySelect.addEventListener('change', () => {
  state.groupBy = groupBySelect.value as GroupBy;
  saveViewSettings();
  applyFilters();
});

// Sorting
const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;

sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  saveViewSettings();
  applySorting();
  applyFilters();
});

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

// Allow clicking on empty space in lightbox content to close
const lightboxContent = document.querySelector('.lightbox-content')!;
lightboxContent.addEventListener('click', (e) => {
  if (e.target === lightboxContent) {
    closeLightbox();
  }
});

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
      const visualOrder = getVisualOrder(state.filteredImages, state.groupBy);
      const index = visualOrder.findIndex(img => img.id === selectedId);
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

settingsBtn.addEventListener('click', async () => {
  const isVisible = settingsPanel.style.display !== 'none';
  settingsPanel.style.display = isVisible ? 'none' : 'block';

  if (isVisible && newlyImportedRuleIds.size > 0) {
    newlyImportedRuleIds.clear();
    await renderTagRules();
  }
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
    deleteSelectedBtn.style.display = 'none';
    dumpSelectedBtn.style.display = 'none';
  } else {
    emptyTrashBtn.style.display = 'none';
    restoreSelectedBtn.style.display = 'none';
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

  // Reset rating to "No Change"
  const noChangeRating = document.querySelector('input[name="bulk-rating"][value=""]') as HTMLInputElement;
  if (noChangeRating) noChangeRating.checked = true;

  bulkTagModal.classList.add('active');

  // Setup autocomplete for add input (all tags) - Enter focuses next input
  setupTagAutocomplete(bulkAddTagsInput, 'bulk-add-autocomplete', {
    onEnterComplete: () => {
      bulkRemoveTagsInput.focus();
    }
  });

  // Setup autocomplete for remove input (only tags from selected images) - Enter blurs
  const selectedImages = state.images.filter(img => state.selectedIds.has(img.id));
  const selectedImageTags = new Set<string>();
  selectedImages.forEach(img => {
    if (img.tags && img.tags.length > 0) {
      img.tags.forEach(tag => selectedImageTags.add(tag));
    }
  });
  const selectedImageTagsArray = Array.from(selectedImageTags);
  setupTagAutocomplete(bulkRemoveTagsInput, 'bulk-remove-autocomplete', {
    customTags: selectedImageTagsArray,
    onEnterComplete: () => {
      bulkRemoveTagsInput.blur();
    }
  });

  // Populate quick remove tag pills
  populateQuickRemoveTags(selectedImageTags);

  // Focus the first input
  bulkAddTagsInput.focus();
}

function populateQuickRemoveTags(selectedImageTags: Set<string>) {
  const quickTagsContainer = document.getElementById('bulk-remove-quick-tags')!;
  quickTagsContainer.innerHTML = '';

  // Get tag frequency from selected images
  const selectedImages = state.images.filter(img => state.selectedIds.has(img.id));
  const tagFrequency = new Map<string, number>();

  selectedImages.forEach(img => {
    if (img.tags && img.tags.length > 0) {
      img.tags.forEach(tag => {
        tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
      });
    }
  });

  // Sort by frequency and take top tags
  const sortedTags = Array.from(tagFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(entry => entry[0]);

  if (sortedTags.length === 0) {
    quickTagsContainer.style.display = 'none';
    return;
  }

  quickTagsContainer.style.display = '';

  sortedTags.forEach(tag => {
    const pill = document.createElement('button');
    pill.className = 'bulk-remove-quick-tags__pill';
    const count = tagFrequency.get(tag)!;
    pill.textContent = `${tag} (${count})`;
    pill.type = 'button';
    pill.dataset.tag = tag;
    pill.addEventListener('click', () => {
      toggleTagInInput(bulkRemoveTagsInput, tag);
      updateQuickRemoveTagsState();
      bulkRemoveTagsInput.focus();
    });
    quickTagsContainer.appendChild(pill);
  });

  // Update initial state
  updateQuickRemoveTagsState();

  // Listen to input changes to update pill states
  bulkRemoveTagsInput.addEventListener('input', updateQuickRemoveTagsState);
}

function updateQuickRemoveTagsState() {
  const quickTagsContainer = document.getElementById('bulk-remove-quick-tags')!;
  const inputValue = bulkRemoveTagsInput.value.trim();
  const tagsInInput = inputValue ? inputValue.split(/\s+/) : [];

  quickTagsContainer.querySelectorAll('.bulk-remove-quick-tags__pill').forEach(pill => {
    const pillElement = pill as HTMLButtonElement;
    const tag = pillElement.dataset.tag!;
    if (tagsInInput.includes(tag)) {
      pillElement.classList.add('bulk-remove-quick-tags__pill--active');
    } else {
      pillElement.classList.remove('bulk-remove-quick-tags__pill--active');
    }
  });
}

function toggleTagInInput(input: HTMLInputElement, tag: string) {
  const currentValue = input.value.trim();
  const existingTags = currentValue ? currentValue.split(/\s+/) : [];

  if (existingTags.includes(tag)) {
    // Remove tag
    const newTags = existingTags.filter(t => t !== tag);
    input.value = newTags.join(' ');
  } else {
    // Add tag
    const newValue = existingTags.length > 0
      ? `${currentValue} ${tag}`
      : tag;
    input.value = newValue;
  }
}

function closeBulkTagModal() {
  bulkTagModal.classList.remove('active');
  // Remove event listener to prevent duplicates
  bulkRemoveTagsInput.removeEventListener('input', updateQuickRemoveTagsState);
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

  // Apply rating if selected
  const selectedRating = document.querySelector('input[name="bulk-rating"]:checked') as HTMLInputElement;
  if (selectedRating && selectedRating.value !== '') {
    const { updateImagesRating } = await import('../storage/service');
    const ratingValue = selectedRating.value === 'unrated' ? undefined : selectedRating.value as ('g' | 's' | 'q' | 'e');
    await updateImagesRating(selectedImageIds, ratingValue);
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

// Database Import/Export handlers
// Import local files button handler
document.getElementById('import-local-files-btn')!.addEventListener('click', async () => {
  // Create hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;

  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) return;

    try {
      const { importLocalFiles } = await import('../storage/service');
      const importedImages = await importLocalFiles(files);

      // Reload images to reflect the new imports
      await loadImages();
    } catch (error) {
      console.error('Failed to import files:', error);
      alert(`Failed to import files: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  fileInput.click();
});

document.getElementById('export-database-btn')!.addEventListener('click', async () => {
  try {
    // Check if File System Access API is available
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support folder selection. Please use Chrome/Edge 86+ or enable the feature flag.');
      return;
    }

    // Ask user to select export folder
    const dirHandle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads'
    });

    // Show progress modal
    const progressModal = document.getElementById('export-progress-modal')!;
    const progressText = document.getElementById('export-progress-text')!;
    const progressFill = document.getElementById('export-progress-fill')!;
    const progressDetail = document.getElementById('export-progress-detail')!;

    progressModal.classList.add('active');
    progressText.textContent = 'Preparing export...';
    progressFill.style.width = '0%';
    progressDetail.textContent = '';

    const { exportDatabase } = await import('../storage/sqlite-import-export');
    const allImagesMetadata = await getAllImagesMetadata();

    const timestamp = Date.now();
    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    const backupFolderName = `image-storage-backup-${dateStr}-${timestamp}`;

    // Create backup folder
    const backupDir = await dirHandle.getDirectoryHandle(backupFolderName, { create: true });

    const chunks = await exportDatabase(allImagesMetadata, (current, total) => {
      const percent = Math.round((current / total) * 100);
      progressText.textContent = `Exporting images...`;
      progressFill.style.width = `${percent}%`;
      progressDetail.textContent = `${current} / ${total} images`;
    });

    // Write each chunk to the backup folder
    progressText.textContent = 'Writing files...';
    progressDetail.textContent = `${chunks.length} file(s)`;

    for (let i = 0; i < chunks.length; i++) {
      const fileName = chunks.length === 1
        ? 'database.db'
        : `database-part${i + 1}of${chunks.length}.db`;

      progressDetail.textContent = `Writing ${fileName}...`;

      const fileHandle = await backupDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(chunks[i]);
      await writable.close();
    }

    // Write manifest file with backup metadata
    progressDetail.textContent = 'Writing manifest...';

    const manifest = {
      exportedAt: timestamp,
      totalImages: state.images.length,
      files: chunks.length,
      version: '1.0'
    };

    const manifestHandle = await backupDir.getFileHandle('manifest.json', { create: true });
    const manifestWritable = await manifestHandle.createWritable();
    await manifestWritable.write(JSON.stringify(manifest, null, 2));
    await manifestWritable.close();

    // Close progress modal
    progressModal.classList.remove('active');

    const message = chunks.length === 1
      ? `Backup completed!\n${state.images.length} images exported to:\n${backupFolderName}/database.db`
      : `Backup completed!\n${state.images.length} images exported to:\n${backupFolderName}/ (${chunks.length} files)`;

    alert(message);
  } catch (error) {
    // Close progress modal on error
    const progressModal = document.getElementById('export-progress-modal')!;
    progressModal.classList.remove('active');

    console.error('Export failed:', error);
    if (error instanceof Error && error.name === 'AbortError') {
      // User cancelled folder selection
      return;
    }
    alert('Export failed. See console for details.');
  }
});

document.getElementById('import-database-btn')!.addEventListener('click', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.db,.sqlite,.sqlite3';
  input.multiple = true; // Allow multiple file selection

  input.onchange = async () => {
    const files = Array.from(input.files || []);
    if (files.length === 0) return;

    try {
      const { analyzeImport, closeImportDatabase } = await import('../storage/sqlite-import-export');

      // Analyze all files and aggregate results
      const analyses = [];
      let totalNew = 0;
      let totalConflicts = 0;
      let totalImages = 0;
      const allConflicts = [];

      for (const file of files) {
        const analysis = await analyzeImport(file, state.images);
        analyses.push({ file, analysis });
        totalNew += analysis.newCount;
        totalConflicts += analysis.conflictCount;
        totalImages += analysis.totalCount;
        allConflicts.push(...analysis.conflicts);
      }

      if (totalImages === 0) {
        // Close all databases
        for (const { analysis } of analyses) {
          closeImportDatabase(analysis.db);
        }
        alert('No images found in the selected files.');
        return;
      }

      if (totalConflicts === 0) {
        // No conflicts, direct import all files
        const fileText = files.length === 1 ? 'file' : `${files.length} files`;
        const confirmed = window.confirm(
          `Import ${totalNew} new images from ${fileText}?`
        );
        if (!confirmed) {
          for (const { analysis } of analyses) {
            closeImportDatabase(analysis.db);
          }
          return;
        }

        const { importDatabase } = await import('../storage/sqlite-import-export');

        // Import all files sequentially
        for (const { file, analysis } of analyses) {
          const importedImages = await importDatabase(file, 'skip');
          closeImportDatabase(analysis.db);
          await importImagesToIndexedDB(importedImages);
        }

        await loadImages();

        alert(`Import complete!\n${totalNew} images added from ${files.length} file(s).`);
      } else {
        // Show conflict resolution modal for all files (dbs will be closed by modal handlers)
        showImportConflictModal(analyses, { totalNew, totalConflicts, totalImages, allConflicts });
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
function showImportConflictModal(analyses: any[], aggregatedData: any) {
  const modal = document.getElementById('import-conflict-modal')!;
  const summary = document.getElementById('import-conflict-summary')!;

  const fileText = analyses.length === 1 ? 'file' : `${analyses.length} files`;
  summary.textContent = `Found ${aggregatedData.totalImages} images in ${fileText}:\n• ${aggregatedData.totalNew} new images\n• ${aggregatedData.totalConflicts} conflicts (same image ID exists)`;

  modal.classList.add('active');

  // Store for handlers (including dbs for blob fetching)
  (modal as any).__importData = { analyses, aggregatedData };
}

async function closeImportConflictModal() {
  const modal = document.getElementById('import-conflict-modal')!;
  const importData = (modal as any).__importData;

  // Close all databases if they exist
  if (importData?.analyses) {
    const { closeImportDatabase } = await import('../storage/sqlite-import-export');
    for (const { analysis } of importData.analyses) {
      if (analysis?.db) {
        closeImportDatabase(analysis.db);
      }
    }
  }

  modal.classList.remove('active');
}

document.getElementById('import-skip-all-btn')!.addEventListener('click', async () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { analyses, aggregatedData } = (modal as any).__importData;

  modal.classList.remove('active');

  try {
    const { importDatabase, closeImportDatabase } = await import('../storage/sqlite-import-export');
    const existingIds = new Set(state.images.map(img => img.id));

    // Import all files, skipping conflicts
    for (const { file, analysis } of analyses) {
      const importedImages = await importDatabase(file, 'skip');
      closeImportDatabase(analysis.db);

      // Filter out conflicts (only import new images)
      const newImages = importedImages.filter(img => !existingIds.has(img.id));

      await importImagesToIndexedDB(newImages);
    }

    await loadImages();

    alert(`Import complete!\n${aggregatedData.totalNew} new images added.\n${aggregatedData.totalConflicts} conflicts skipped.`);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Import failed. See console for details.');
  }
});

document.getElementById('import-override-all-btn')!.addEventListener('click', async () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { analyses, aggregatedData } = (modal as any).__importData;

  const confirmed = window.confirm(
    `This will override ${aggregatedData.totalConflicts} existing images. Continue?`
  );
  if (!confirmed) return;

  modal.classList.remove('active');

  try {
    const { importDatabase, closeImportDatabase } = await import('../storage/sqlite-import-export');

    // Import all files, overriding conflicts
    for (const { file, analysis } of analyses) {
      const importedImages = await importDatabase(file, 'override');
      closeImportDatabase(analysis.db);
      await importImagesToIndexedDB(importedImages);
    }

    await loadImages();

    alert(`Import complete!\n${aggregatedData.totalNew} new images added.\n${aggregatedData.totalConflicts} images overridden.`);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Import failed. See console for details.');
  }
});

document.getElementById('import-review-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-conflict-modal')!;
  const { analyses, aggregatedData } = (modal as any).__importData;

  modal.classList.remove('active');

  // For review mode with multiple files, we need to keep track of which file each conflict belongs to
  // Create enhanced conflicts array with file and db references
  const enhancedConflicts = analyses.flatMap(({ file, analysis }) =>
    analysis.conflicts.map((conflict: any) => ({
      ...conflict,
      file,
      db: analysis.db
    }))
  );

  showImportReviewModal(analyses, enhancedConflicts, 0);
});

document.getElementById('import-cancel-btn')!.addEventListener('click', closeImportConflictModal);
document.querySelector('.import-conflict-close')!.addEventListener('click', closeImportConflictModal);

// Import review modal (granular control)
async function showImportReviewModal(analyses: any[], conflicts: any[], index: number) {
  const modal = document.getElementById('import-review-modal')!;
  const progress = document.getElementById('import-review-progress')!;
  const existingPreview = document.getElementById('import-existing-preview')!;
  const importedPreview = document.getElementById('import-imported-preview')!;

  progress.textContent = `Conflict ${index + 1} of ${conflicts.length}`;

  const conflict = conflicts[index];

  // Render existing image preview
  await loadImageBlob(conflict.existingImage.id);
  const existingUrl = getOrCreateObjectURL(conflict.existingImage.id);
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

  // Fetch and render imported image preview (use conflict.db from enhanced conflicts)
  const { getImageBlobFromDatabase, getImageMetadataFromDatabase } = await import('../storage/sqlite-import-export');
  const importedBlob = getImageBlobFromDatabase(conflict.db, conflict.id);
  const importedMetadata = getImageMetadataFromDatabase(conflict.db, conflict.id);

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
  (modal as any).__reviewData = { analyses, conflicts, index, decisions: new Map() };
}

async function closeImportReviewModal() {
  const modal = document.getElementById('import-review-modal')!;
  const reviewData = (modal as any).__reviewData;

  // Close all databases if they exist
  if (reviewData?.analyses) {
    const { closeImportDatabase } = await import('../storage/sqlite-import-export');
    for (const { analysis } of reviewData.analyses) {
      if (analysis?.db) {
        closeImportDatabase(analysis.db);
      }
    }
  }

  modal.classList.remove('active');
}

document.getElementById('import-keep-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-review-modal')!;
  const { analyses, conflicts, index, decisions } = (modal as any).__reviewData;

  // Mark this conflict as "keep existing"
  decisions.set(conflicts[index].id, 'keep');

  // Move to next conflict or finish
  if (index + 1 < conflicts.length) {
    showImportReviewModal(analyses, conflicts, index + 1);
  } else {
    finishGranularImport(analyses, conflicts, decisions);
  }
});

document.getElementById('import-override-btn')!.addEventListener('click', () => {
  const modal = document.getElementById('import-review-modal')!;
  const { analyses, conflicts, index, decisions } = (modal as any).__reviewData;

  // Mark this conflict as "override"
  decisions.set(conflicts[index].id, 'override');

  // Move to next conflict or finish
  if (index + 1 < conflicts.length) {
    showImportReviewModal(analyses, conflicts, index + 1);
  } else {
    finishGranularImport(analyses, conflicts, decisions);
  }
});

async function finishGranularImport(analyses: any[], conflicts: any[], decisions: Map<string, 'keep' | 'override'>) {
  const modal = document.getElementById('import-review-modal')!;
  modal.classList.remove('active');

  try {
    const { importDatabase, closeImportDatabase } = await import('../storage/sqlite-import-export');
    const existingIds = new Set(state.images.map(img => img.id));

    let totalNew = 0;
    let totalOverride = 0;

    // Import all files with decisions applied
    for (const { file, analysis } of analyses) {
      const allImportedImages = await importDatabase(file, 'override');
      closeImportDatabase(analysis.db);

      // Filter based on decisions
      const imagesToImport = allImportedImages.filter(img => {
        if (!existingIds.has(img.id)) {
          // New image, always import
          totalNew++;
          return true;
        }
        // Conflict: check decision
        const shouldOverride = decisions.get(img.id) === 'override';
        if (shouldOverride) {
          totalOverride++;
        }
        return shouldOverride;
      });

      await importImagesToIndexedDB(imagesToImport);
    }

    await loadImages();

    const keepCount = conflicts.length - totalOverride;

    alert(`Import complete!\n${totalNew} new images added.\n${totalOverride} images overridden.\n${keepCount} conflicts skipped.`);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Import failed. See console for details.');
  }
}

document.getElementById('import-review-cancel-btn')!.addEventListener('click', closeImportReviewModal);
document.querySelector('.import-review-close')!.addEventListener('click', closeImportReviewModal);

renderTagRules();

// Initialize: restore view settings and search state, then load images
(async () => {
  await restoreViewSettings();
  await restoreSearchState();
  await loadImages();
})();
