import { getAllImages, getAllImagesMetadata, getImageBlob, deleteImage, deleteAllImages, restoreImage, permanentlyDeleteImage, emptyTrash, updateImageTags, addTagsToImages, removeTagsFromImages } from '../storage/service';
import type { SavedImage, ImageMetadata } from '../types';
import { parseTagSearch, removeTagFromQuery, sortTags, type ParsedTagSearch, type TagCountFilter } from './tag-utils';

// Constants
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
  images: [] as ImageMetadata[],
  filteredImages: [] as ImageMetadata[],
  loadedBlobs: new Map<string, Blob>(),
  sort: 'savedAt-desc',
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
  state.images = await getAllImagesMetadata();
  applySorting();
  applyFilters();

  // Update tag autocomplete with newly loaded tags
  if (typeof updateTagAutocompleteAvailableTags === 'function') {
    updateTagAutocompleteAvailableTags();
  }
}

/**
 * Updates image metadata in local state after database update, then re-renders.
 * Synchronizes local state with database changes and sets updatedAt timestamp.
 */
function syncImageMetadataToState<T extends keyof ImageMetadata>(
  imageId: string,
  field: T,
  value: ImageMetadata[T]
): void {
  const imageInState = state.images.find(img => img.id === imageId);
  if (imageInState) {
    (imageInState as any)[field] = value;
    imageInState.updatedAt = Date.now();
  }
  applyFilters();
}

// TagCountFilter moved to tag-utils.ts

interface ParsedSearch {
  terms: string;
  tagCount: TagCountFilter | null;
}

function parseSearchQuery(query: string): ParsedSearch {
  // Try to match tagcount patterns in order of specificity
  // 1. List: tagcount:1,3,5
  const listRegex = /tagcount:(\d+(?:,\d+)+)/i;
  const listMatch = query.match(listRegex);

  if (listMatch) {
    const values = listMatch[1].split(',').map(v => parseInt(v.trim(), 10));
    const terms = query.replace(listRegex, '').trim();
    return {
      terms,
      tagCount: { operator: 'list', values }
    };
  }

  // 2. Range or comparison operators
  const tagCountRegex = /tagcount:(>=|<=|>|<|)(\d+)(\.\.(\d+))?/i;
  const match = query.match(tagCountRegex);

  let tagCount: TagCountFilter | null = null;

  if (match) {
    const operator = match[1];
    const firstNum = parseInt(match[2], 10);
    const secondNum = match[4] ? parseInt(match[4], 10) : undefined;

    if (secondNum !== undefined) {
      // Range: tagcount:1..10
      tagCount = {
        operator: 'range',
        min: Math.min(firstNum, secondNum),
        max: Math.max(firstNum, secondNum),
      };
    } else if (operator === '>') {
      tagCount = { operator: '>', value: firstNum };
    } else if (operator === '<') {
      tagCount = { operator: '<', value: firstNum };
    } else if (operator === '>=') {
      tagCount = { operator: '>=', value: firstNum };
    } else if (operator === '<=') {
      tagCount = { operator: '<=', value: firstNum };
    } else {
      // Exact: tagcount:2
      tagCount = { operator: '=', value: firstNum };
    }
  }

  // Remove tagcount: from query
  const terms = query.replace(tagCountRegex, '').trim();

  return { terms, tagCount };
}

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

  applyFilters();
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
  applyFilters();
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
  applyFilters();
}

// Remove included tag from search input (for clicking included tag name in sidebar)
function removeIncludedTagFromSearch(tag: string) {
  const input = document.getElementById('tag-search-input') as HTMLInputElement;
  if (!input) return;

  const current = input.value.trim();
  input.value = removeTagFromQuery(current, tag);
  applyFilters();
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
  applyFilters();
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

  applyFilters();
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
  applyFilters();
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
  applyFilters();
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
  applyFilters();
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
  applyFilters();
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

  applyFilters();
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
  let filtered = state.images;

  // 1. Apply view filter (all or trash)
  if (state.currentView === 'all') {
    filtered = filtered.filter(img => !img.isDeleted);
  } else {
    filtered = filtered.filter(img => img.isDeleted);
  }

  // 2. Apply URL/page title search filter
  const urlSearchInput = document.getElementById('url-search-input') as HTMLInputElement;
  if (urlSearchInput && urlSearchInput.value) {
    const query = urlSearchInput.value.toLowerCase();
    filtered = filtered.filter(img =>
      img.imageUrl.toLowerCase().includes(query) ||
      img.pageUrl.toLowerCase().includes(query) ||
      (img.pageTitle && img.pageTitle.toLowerCase().includes(query))
    );
  }

  // 3. Apply tag search filter (Danbooru syntax) - BUT SKIP RATING FILTER
  const tagSearchInput = document.getElementById('tag-search-input') as HTMLInputElement;
  if (tagSearchInput && tagSearchInput.value) {
    const parsed = parseTagSearch(tagSearchInput.value);

    // Skip rating filter - we want counts across all ratings

    // Apply file type filters
    if (parsed.fileTypes.size > 0) {
      filtered = filtered.filter(img => parsed.fileTypes.has(img.mimeType));
    }

    // Apply tag count filter
    if (parsed.tagCount) {
      filtered = filtered.filter(img => {
        const tagCount = img.tags?.length ?? 0;
        const filter = parsed.tagCount!;

        if (filter.operator === 'list') {
          return filter.values!.includes(tagCount);
        } else if (filter.operator === 'range') {
          return tagCount >= filter.min! && tagCount <= filter.max!;
        } else if (filter.operator === '=') {
          return tagCount === filter.value!;
        } else if (filter.operator === '>') {
          return tagCount > filter.value!;
        } else if (filter.operator === '<') {
          return tagCount < filter.value!;
        } else if (filter.operator === '>=') {
          return tagCount >= filter.value!;
        } else if (filter.operator === '<=') {
          return tagCount <= filter.value!;
        }
        return true;
      });
    }

    // Apply account filters (OR logic for included accounts)
    if (parsed.accounts.size > 0) {
      filtered = filtered.filter(img => {
        const account = getXAccountFromUrl(img.pageUrl);
        return account && parsed.accounts.has(account);
      });
    }

    // Apply excluded account filters
    if (parsed.excludeAccounts.size > 0) {
      filtered = filtered.filter(img => {
        const account = getXAccountFromUrl(img.pageUrl);
        return !account || !parsed.excludeAccounts.has(account);
      });
    }

    // Apply include tags (AND logic)
    if (parsed.includeTags.length > 0) {
      filtered = filtered.filter(img =>
        img.tags && parsed.includeTags.every(tag => img.tags!.includes(tag))
      );
    }

    // Apply OR groups
    if (parsed.orGroups.length > 0) {
      filtered = filtered.filter(img => {
        if (!img.tags) return false;
        // Image must match at least one tag from each OR group
        return parsed.orGroups.every(group =>
          group.some(tag => img.tags!.includes(tag))
        );
      });
    }

    // Apply exclude tags
    if (parsed.excludeTags.length > 0) {
      filtered = filtered.filter(img =>
        !img.tags || !parsed.excludeTags.some(tag => img.tags!.includes(tag))
      );
    }
  }

  // Count images by rating
  const counts = { g: 0, s: 0, q: 0, e: 0, unrated: 0 };
  for (const img of filtered) {
    if (!img.rating) {
      counts.unrated++;
    } else if (img.rating === 'g') {
      counts.g++;
    } else if (img.rating === 's') {
      counts.s++;
    } else if (img.rating === 'q') {
      counts.q++;
    } else if (img.rating === 'e') {
      counts.e++;
    }
  }

  return counts;
}

// parseTagSearch moved to tag-utils.ts

function applyFilters() {
  // Re-sort first so updated images move to correct position
  applySorting();

  let filtered = state.images;

  // 1. Apply view filter (all or trash)
  if (state.currentView === 'all') {
    filtered = filtered.filter(img => !img.isDeleted);
  } else {
    filtered = filtered.filter(img => img.isDeleted);
  }

  // 2. Apply URL/page title search filter
  const urlSearchInput = document.getElementById('url-search-input') as HTMLInputElement;
  if (urlSearchInput && urlSearchInput.value) {
    const query = urlSearchInput.value.toLowerCase();
    filtered = filtered.filter(img =>
      img.imageUrl.toLowerCase().includes(query) ||
      img.pageUrl.toLowerCase().includes(query) ||
      (img.pageTitle && img.pageTitle.toLowerCase().includes(query))
    );
  }

  // 3. Apply tag search filter (Danbooru syntax)
  const tagSearchInput = document.getElementById('tag-search-input') as HTMLInputElement;
  if (tagSearchInput && tagSearchInput.value) {
    const parsed = parseTagSearch(tagSearchInput.value);

    // Apply rating filters
    if (parsed.ratings.size > 0 || parsed.includeUnrated) {
      filtered = filtered.filter(img => {
        if (parsed.includeUnrated && !img.rating) {
          return true;
        }
        return img.rating && parsed.ratings.has(img.rating);
      });
    }

    // Apply file type filters
    if (parsed.fileTypes.size > 0) {
      filtered = filtered.filter(img => parsed.fileTypes.has(img.mimeType));
    }

    // Apply tag count filter
    if (parsed.tagCount) {
      filtered = filtered.filter(img => {
        const tagCount = img.tags?.length ?? 0;
        const filter = parsed.tagCount!;

        if (filter.operator === 'list') {
          return filter.values!.includes(tagCount);
        } else if (filter.operator === 'range') {
          return tagCount >= filter.min! && tagCount <= filter.max!;
        } else if (filter.operator === '=') {
          return tagCount === filter.value!;
        } else if (filter.operator === '>') {
          return tagCount > filter.value!;
        } else if (filter.operator === '<') {
          return tagCount < filter.value!;
        } else if (filter.operator === '>=') {
          return tagCount >= filter.value!;
        } else if (filter.operator === '<=') {
          return tagCount <= filter.value!;
        }
        return true;
      });
    }

    // Apply account filters (OR logic for included accounts)
    if (parsed.accounts.size > 0) {
      filtered = filtered.filter(img => {
        const account = getXAccountFromUrl(img.pageUrl);
        return account && parsed.accounts.has(account);
      });
    }

    // Apply excluded account filters
    if (parsed.excludeAccounts.size > 0) {
      filtered = filtered.filter(img => {
        const account = getXAccountFromUrl(img.pageUrl);
        return !account || !parsed.excludeAccounts.has(account);
      });
    }

    // Apply include tags (AND logic)
    if (parsed.includeTags.length > 0) {
      filtered = filtered.filter(img =>
        img.tags && parsed.includeTags.every(tag => img.tags!.includes(tag))
      );
    }

    // Apply OR groups
    if (parsed.orGroups.length > 0) {
      filtered = filtered.filter(img => {
        if (!img.tags) return false;
        // Image must match at least one tag from each OR group
        return parsed.orGroups.every(group =>
          group.some(tag => img.tags!.includes(tag))
        );
      });
    }

    // Apply exclude tags
    if (parsed.excludeTags.length > 0) {
      filtered = filtered.filter(img =>
        !img.tags || !parsed.excludeTags.some(tag => img.tags!.includes(tag))
      );
    }
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

  renderImages(filtered);
  updateImageCount();
  updateViewBadges();
  updateSelectionCount();
  updatePreviewPane();
  updateRatingPills();
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
      case 'updatedAt':
        comparison = (a.updatedAt ?? a.savedAt) - (b.updatedAt ?? b.savedAt);
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

// Placeholder for unloaded images
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect width="200" height="200" fill="%23f0f0f0"/%3E%3C/svg%3E';

// URL lifecycle management
function getOrCreateObjectURL(imageId: string): string {
  if (state.objectUrls.has(imageId)) {
    return state.objectUrls.get(imageId)!;
  }

  const blob = state.loadedBlobs.get(imageId);
  if (!blob) {
    return PLACEHOLDER_IMAGE;
  }

  const url = URL.createObjectURL(blob);
  state.objectUrls.set(imageId, url);
  return url;
}

async function loadImageBlob(imageId: string): Promise<void> {
  if (state.loadedBlobs.has(imageId)) {
    return;
  }

  const blob = await getImageBlob(imageId);
  if (blob) {
    state.loadedBlobs.set(imageId, blob);
  }
}

function revokeObjectURLs() {
  for (const url of state.objectUrls.values()) {
    URL.revokeObjectURL(url);
  }
  state.objectUrls.clear();
}

function revokeObjectURL(imageId: string) {
  const url = state.objectUrls.get(imageId);
  if (url && url !== PLACEHOLDER_IMAGE) {
    URL.revokeObjectURL(url);
    state.objectUrls.delete(imageId);
  }
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
    <div class="image-card ${isSelected ? 'selected' : ''}" data-id="${image.id}">
      <input type="checkbox" class="image-checkbox" data-id="${image.id}" ${isSelected ? 'checked' : ''}>
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

function renderImages(images: ImageMetadata[]) {
  const grid = document.getElementById('image-grid')!;
  const emptyState = document.getElementById('empty-state')!;

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
    renderXAccountGroups(images);
  } else if (state.groupBy === 'duplicates') {
    renderDuplicateGroups(images);
  } else {
    renderUngroupedImages(images);
  }

  observeImages();
}

function renderUngroupedImages(images: ImageMetadata[]) {
  const grid = document.getElementById('image-grid')!;
  // Restore grid layout for ungrouped display
  grid.style.display = '';
  grid.innerHTML = images.map(image => createImageCardHTML(image)).join('');
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
  const input = document.getElementById('lightbox-tag-input') as HTMLInputElement;
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
            <input type="text" id="preview-tag-input-${image.id}" class="preview-tag-input" placeholder="Add tags (space-separated)..." value="${image.tags ? sortTags(image.tags).join(' ') : ''}">
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
      const visualOrder = getVisualOrder();
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
      syncImageMetadataToState(image.id, 'rating', ratingValue as any);
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
      syncImageMetadataToState(image.id, 'pageTitle', newPageTitle);
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
      syncImageMetadataToState(image.id, 'pageUrl', newPageUrl);
    });
  }

  // Attach tag input with autocomplete and auto-save on blur
  const previewTagInput = document.getElementById(`preview-tag-input-${image.id}`) as HTMLInputElement;
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
        syncImageMetadataToState(image.id, 'tags', uniqueTags);
        updatePreviewPane();
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
      syncImageMetadataToState(image.id, 'tags', uniqueTags);
      updatePreviewPane();
    });
  }
}

async function renderMultiPreview(images: ImageMetadata[], container: HTMLElement) {
  const count = images.length;

  await Promise.all(images.map(img => loadImageBlob(img.id)));

  const thumbnails = images.map(image => {
    const url = getOrCreateObjectURL(image.id);
    return `
      <div class="preview-thumbnail" data-id="${image.id}">
        <img class="preview-thumbnail__image" src="${url}" alt="Thumbnail">
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
      const visualOrder = getVisualOrder();
      const index = visualOrder.findIndex(img => img.id === id);
      if (index !== -1) openLightbox(index);
    });
  });

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getXAccountFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Match x.com or twitter.com
    if (urlObj.hostname === 'x.com' || urlObj.hostname === 'twitter.com' ||
        urlObj.hostname === 'www.x.com' || urlObj.hostname === 'www.twitter.com') {
      // Extract account from path like /accountname/status/...
      const match = urlObj.pathname.match(/^\/([^\/]+)/);
      if (match && match[1]) {
        // Skip non-account paths
        const path = match[1].toLowerCase();
        if (path === 'i' || path === 'home' || path === 'explore' ||
            path === 'notifications' || path === 'messages' || path === 'search') {
          return null;
        }
        return match[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function groupImagesByXAccount(images: ImageMetadata[]): Map<string, ImageMetadata[]> {
  const groups = new Map<string, ImageMetadata[]>();

  for (const image of images) {
    const account = getXAccountFromUrl(image.pageUrl);
    if (account) {
      if (!groups.has(account)) {
        groups.set(account, []);
      }
      groups.get(account)!.push(image);
    }
  }

  return groups;
}

function groupImagesByDuplicates(images: ImageMetadata[]): Map<string, ImageMetadata[]> {
  const groups = new Map<string, ImageMetadata[]>();

  for (const image of images) {
    // Group by dimensions AND file size
    const key = `${image.width}×${image.height}-${image.fileSize}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(image);
  }

  // Only return groups with 2+ images (actual duplicates)
  const duplicates = new Map<string, ImageMetadata[]>();
  for (const [key, groupImages] of groups) {
    if (groupImages.length >= 2) {
      duplicates.set(key, groupImages);
    }
  }

  return duplicates;
}

function renderXAccountGroups(images: ImageMetadata[]) {
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
}

function renderDuplicateGroups(images: ImageMetadata[]) {
  const grid = document.getElementById('image-grid')!;
  const groups = groupImagesByDuplicates(images);

  if (groups.size === 0) {
    grid.innerHTML = '<div class="empty-state" style="display: block;"><p>No duplicates found</p></div>';
    return;
  }

  // Remove grid layout from outer container (let group-content handle it)
  grid.style.display = 'block';

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

/**
 * Returns images in their visual rendering order.
 * This matches the DOM order when grouping is enabled.
 */
function getVisualOrder(): ImageMetadata[] {
  if (state.groupBy === 'none') {
    // Ungrouped: use filtered images as-is
    return state.filteredImages;
  } else if (state.groupBy === 'x-account') {
    // Group by X account: sort by count (desc) then alphabetically
    const groups = groupImagesByXAccount(state.filteredImages);
    const sortedAccounts = Array.from(groups.entries())
      .sort((a, b) => {
        const countDiff = b[1].length - a[1].length;
        if (countDiff !== 0) return countDiff;
        return a[0].localeCompare(b[0]);
      })
      .map(([account]) => account);

    const visualOrder: ImageMetadata[] = [];
    for (const account of sortedAccounts) {
      visualOrder.push(...groups.get(account)!);
    }
    return visualOrder;
  } else if (state.groupBy === 'duplicates') {
    // Group by duplicates: sort by key alphabetically
    const groups = groupImagesByDuplicates(state.filteredImages);
    const sortedKeys = Array.from(groups.keys()).sort();

    const visualOrder: ImageMetadata[] = [];
    for (const key of sortedKeys) {
      visualOrder.push(...groups.get(key)!);
    }
    return visualOrder;
  }

  // Fallback
  return state.filteredImages;
}

function handleImageClick(e: Event) {
  const imageCard = (e.target as HTMLElement).closest('.image-card');
  if (!imageCard) return;

  const id = imageCard.getAttribute('data-id')!;
  const visualOrder = getVisualOrder();
  const index = visualOrder.findIndex(img => img.id === id);
  if (index !== -1) {
    openLightbox(index);
  }
}

function openLightbox(index: number) {
  const visualOrder = getVisualOrder();
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
        <input type="text" id="lightbox-tag-input" class="tag-input" placeholder="Add tags (space-separated)..." value="${image.tags ? sortTags(image.tags).join(' ') : ''}">
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

          // Update local state
          const imageInState = state.images.find(img => img.id === image.id);
          if (imageInState) {
            imageInState.pageTitle = newPageTitle;
            imageInState.pageUrl = newPageUrl;
            imageInState.updatedAt = Date.now();
          }

          // Re-render the grid to update display
          applyFilters();

          // Update lightbox metadata display
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

      // Update local state
      const imageInState = state.images.find(img => img.id === image.id);
      if (imageInState) {
        imageInState.rating = ratingValue as any;
        imageInState.updatedAt = Date.now();
      }

      // Update lightbox metadata display
      updateLightboxMetadata(imageInState || image);

      // Re-render the grid to update badge
      applyFilters();
    });
  });

  // Setup tag autocomplete with save callback
  const input = document.getElementById('lightbox-tag-input') as HTMLInputElement;
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

        // Update local state
        const imageInState = state.images.find(img => img.id === image.id);
        if (imageInState) {
          imageInState.tags = uniqueTags;
          imageInState.updatedAt = Date.now();
        }

        // Update lightbox metadata display
        updateLightboxMetadata(imageInState || image);

        // Re-render the grid to update tags display
        applyFilters();
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

// Helper function to check if current token is incomplete (no trailing space)
function isCurrentTokenIncomplete(input: HTMLInputElement): boolean {
  const value = input.value;
  const cursorPos = input.selectionStart || 0;
  const beforeCursor = value.substring(0, cursorPos);

  // Token is incomplete if there's text before cursor and no trailing space
  if (beforeCursor.length === 0) return false;
  if (beforeCursor.endsWith(' ')) return false;

  // Check if there's a token being typed
  const lastSpaceIndex = beforeCursor.lastIndexOf(' ');
  const currentToken = beforeCursor.substring(lastSpaceIndex + 1).trim();

  return currentToken.length > 0;
}

// Helper function to complete the current token by adding a space
function completeCurrentToken(input: HTMLInputElement): void {
  const value = input.value;
  const cursorPos = input.selectionStart || 0;
  const beforeCursor = value.substring(0, cursorPos);
  const afterCursor = value.substring(cursorPos);

  input.value = beforeCursor + ' ' + afterCursor;
  const newCursorPos = cursorPos + 1;
  input.setSelectionRange(newCursorPos, newCursorPos);
}

interface AutocompleteOptions {
  customTags?: string[];
  onEnterComplete?: () => void | Promise<void>;
  enableDanbooruSyntax?: boolean;
}

/**
 * Sets up tag autocomplete with optional Danbooru syntax support.
 * Returns updateAvailableTags function if Danbooru syntax is enabled.
 */
function setupTagAutocomplete(
  input: HTMLInputElement,
  autocompleteId: string,
  options: AutocompleteOptions = {}
): { updateAvailableTags?: () => void } {
  const { customTags, onEnterComplete, enableDanbooruSyntax = false } = options;

  const autocompleteDiv = document.getElementById(autocompleteId);
  if (!autocompleteDiv) return {};

  // Remove existing event listeners by aborting previous controller
  const controllerKey = `autocomplete_controller_${autocompleteId}`;
  if ((input as any)[controllerKey]) {
    (input as any)[controllerKey].abort();
  }
  const controller = new AbortController();
  (input as any)[controllerKey] = controller;
  const signal = controller.signal;

  // Collect all unique tags
  let availableTags: string[] = [];

  function updateAvailableTags() {
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
  }
  updateAvailableTags();

  let selectedIndex = -1;
  let currentMatches: string[] = [];
  let blurTimeout: number | null = null;

  function showSuggestions() {
    const value = input.value;
    const cursorPos = input.selectionStart || 0;

    // Find the current token being typed
    const beforeCursor = value.substring(0, cursorPos);
    const lastSpaceIndex = beforeCursor.lastIndexOf(' ');
    const currentToken = beforeCursor.substring(lastSpaceIndex + 1).trim();

    // Danbooru syntax: Check if we're in a metatag context or "or" operator
    if (enableDanbooruSyntax) {
      const metatagPattern = /^(rating|is|tagcount):/i;
      if (metatagPattern.test(currentToken) || currentToken.toLowerCase() === 'or' || currentToken.toLowerCase() === 'o') {
        autocompleteDiv.style.display = 'none';
        return;
      }
    }

    // Danbooru syntax: Handle exclusion prefix
    const isExclusion = enableDanbooruSyntax && currentToken.startsWith('-');
    const tagPrefix = isExclusion ? currentToken.substring(1) : currentToken;

    // Get already-entered tags to exclude them from suggestions
    const enteredTagsSet = new Set<string>();
    const tokens = value.split(/\s+/).map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

    tokens.forEach(token => {
      if (enableDanbooruSyntax) {
        // Skip metatags and operators
        const metatagPattern = /^(rating|is|tagcount):/i;
        if (metatagPattern.test(token) || token === 'or') return;
        // Remove exclusion prefix for comparison
        const cleanToken = token.startsWith('-') ? token.substring(1) : token;
        if (cleanToken) enteredTagsSet.add(cleanToken);
      } else {
        if (token) enteredTagsSet.add(token);
      }
    });

    // Filter matching tags
    currentMatches = availableTags.filter(tag => {
      if (enteredTagsSet.has(tag.toLowerCase())) return false;
      if (tagPrefix.length === 0) return true;
      return tag.toLowerCase().startsWith(tagPrefix.toLowerCase()) &&
             tag.toLowerCase() !== tagPrefix.toLowerCase();
    });

    if (currentMatches.length === 0) {
      autocompleteDiv.style.display = 'none';
      return;
    }

    // Auto-select first item only when actively typing (non-empty prefix)
    selectedIndex = tagPrefix.length > 0 ? 0 : -1;
    renderSuggestions();
    autocompleteDiv.style.display = 'block';
  }

  function renderSuggestions() {
    autocompleteDiv.innerHTML = currentMatches.slice(0, 8).map((tag, index) =>
      `<div class="tag-suggestion ${index === selectedIndex ? 'selected' : ''}" data-tag="${tag}" data-index="${index}">${tag}</div>`
    ).join('');

    // Attach mousedown handlers (fires before blur, allows preventDefault)
    autocompleteDiv.querySelectorAll('.tag-suggestion').forEach(suggestionEl => {
      suggestionEl.addEventListener('mousedown', (e: Event) => {
        e.preventDefault(); // Prevent input blur when clicking autocomplete
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
    const afterCursor = value.substring(cursorPos);
    const lastSpaceIndex = beforeCursor.lastIndexOf(' ');
    const currentToken = beforeCursor.substring(lastSpaceIndex + 1);

    // Danbooru syntax: preserve exclusion prefix if present
    const isExclusion = enableDanbooruSyntax && currentToken.startsWith('-');
    const tagWithPrefix = isExclusion ? `-${tag}` : tag;

    const beforeTag = value.substring(0, lastSpaceIndex + 1);
    const nextSpaceOrEnd = afterCursor.indexOf(' ');
    const afterTag = nextSpaceOrEnd >= 0 ? afterCursor.substring(nextSpaceOrEnd) : '';

    // Add space only if afterTag doesn't already start with one
    const needsSpace = !afterTag.startsWith(' ') && afterTag.length > 0;
    input.value = beforeTag + tagWithPrefix + (needsSpace || afterTag.length === 0 ? ' ' : '') + afterTag;
    input.focus();

    // Move cursor after the inserted tag (and space if added)
    const addedSpace = needsSpace || afterTag.length === 0 ? 1 : 0;
    const newCursorPos = beforeTag.length + tagWithPrefix.length + addedSpace;
    input.setSelectionRange(newCursorPos, newCursorPos);

    // Re-show autocomplete
    showSuggestions();

    // Danbooru syntax: trigger input event for filter updates
    if (enableDanbooruSyntax) {
      input.dispatchEvent(new Event('input'));
    }
  }

  input.addEventListener('input', showSuggestions, { signal });
  input.addEventListener('focus', showSuggestions, { signal });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    const autocompleteVisible = autocompleteDiv.style.display === 'block';

    // Handle Enter key - priority: autocomplete selection > token completion > submit
    if (e.key === 'Enter') {
      // Priority 1: If autocomplete has a selection, insert the selected tag
      if (autocompleteVisible && selectedIndex >= 0 && selectedIndex < currentMatches.length) {
        e.preventDefault();
        insertTag(currentMatches[selectedIndex]);
      }
      // Priority 2: If token is incomplete, complete it by adding a space
      else if (isCurrentTokenIncomplete(input)) {
        e.preventDefault();
        completeCurrentToken(input);
        autocompleteDiv.style.display = 'none';
        selectedIndex = -1;
      }
      // Priority 3: Call the callback if provided (submit action)
      else if (onEnterComplete) {
        e.preventDefault();
        onEnterComplete();
      }
      // Danbooru syntax: blur input if no callback
      else if (enableDanbooruSyntax) {
        e.preventDefault();
        input.blur();
      }
      return;
    }

    // Handle Tab key for autocomplete selection
    if (e.key === 'Tab' && autocompleteVisible && selectedIndex >= 0 && selectedIndex < currentMatches.length) {
      e.preventDefault();
      insertTag(currentMatches[selectedIndex]);
      return;
    }

    // Handle other keys when autocomplete is visible
    if (autocompleteVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, Math.min(currentMatches.length, 8) - 1);
        renderSuggestions();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        renderSuggestions();
      } else if (e.key === 'Escape') {
        autocompleteDiv.style.display = 'none';
        selectedIndex = -1;
      }
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

  // Return updateAvailableTags only if Danbooru syntax is enabled
  return enableDanbooruSyntax ? { updateAvailableTags } : {};
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox')!;
  lightbox.classList.remove('active');
  state.lightboxActive = false;
  state.currentLightboxIndex = -1;
}

function navigateLightboxByOffset(offset: number) {
  const visualOrder = getVisualOrder();

  // Get all visible image cards in DOM order (respects grouping)
  const allCards = Array.from(document.querySelectorAll('.image-card')) as HTMLElement[];
  if (allCards.length === 0) return;

  // Find current lightbox image's card in DOM
  const currentImage = visualOrder[state.currentLightboxIndex];
  if (!currentImage) return;

  const currentCardIndex = allCards.findIndex(card => card.dataset.id === currentImage.id);
  if (currentCardIndex === -1) return;

  // Calculate new position in DOM order
  const newCardIndex = currentCardIndex + offset;
  if (newCardIndex < 0 || newCardIndex >= allCards.length) return;

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

  // For horizontal navigation (offset = ±1), simple linear navigation
  if (Math.abs(offset) === 1) {
    const newIndex = currentIndex + offset;
    const clampedIndex = Math.max(0, Math.min(newIndex, allCards.length - 1));
    const newCard = allCards[clampedIndex];
    selectCard(newCard);
    return;
  }

  // For vertical navigation (offset = ±columns), need to handle grid layout
  const columns = getGridColumns();
  const targetIndex = currentIndex + offset;

  // Simple bounds checking
  const clampedIndex = Math.max(0, Math.min(targetIndex, allCards.length - 1));
  const newCard = allCards[clampedIndex];
  selectCard(newCard);
}

function selectCard(card: HTMLElement) {
  const id = card.dataset.id!;
  const visualOrder = getVisualOrder();
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

  const visualOrder = getVisualOrder();

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

  // Calculate new focus position in DOM order
  const newFocusIndex = currentCardIndex + offset;
  const clampedFocusIndex = Math.max(0, Math.min(newFocusIndex, allCards.length - 1));

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
  const allCheckboxes = document.querySelectorAll('.image-checkbox') as NodeListOf<HTMLInputElement>;
  allCheckboxes.forEach(cb => {
    const cbId = cb.dataset.id!;
    const isSelected = state.selectedIds.has(cbId);
    cb.checked = isSelected;

    // Update card class directly without extra DOM query
    const card = cb.closest('.image-card');
    if (card) {
      if (isSelected) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
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
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | undefined;
  return function(...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => func(...args), wait);
  };
}

// Search input event listeners with debouncing
const urlSearchInput = document.getElementById('url-search-input') as HTMLInputElement;
const tagSearchInput = document.getElementById('tag-search-input') as HTMLInputElement;

const debouncedApplyFilters = debounce(() => applyFilters(), 200);
const debouncedTagSearch = debounce(() => {
  applyFilters();
  updateRatingPills();
}, 200);

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
    const visualOrder = getVisualOrder();
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'IMAGE_SAVED') {
    loadImages();
  }
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
      const visualOrder = getVisualOrder();
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

  // Load blob and set preview image
  await loadImageBlob(imageId);
  const previewImg = document.getElementById('danbooru-preview-image') as HTMLImageElement;
  const url = getOrCreateObjectURL(imageId);
  previewImg.src = url;

  // Auto-fill metadata
  const tagsInput = document.getElementById('danbooru-tags-input') as HTMLInputElement;
  const artistInput = document.getElementById('danbooru-artist-input') as HTMLInputElement;
  const copyrightInput = document.getElementById('danbooru-copyright-input') as HTMLInputElement;
  const characterInput = document.getElementById('danbooru-character-input') as HTMLInputElement;
  const sourceInput = document.getElementById('danbooru-source-input') as HTMLInputElement;
  const descriptionInput = document.getElementById('danbooru-description-input') as HTMLTextAreaElement;

  // Auto-fill tags from existing tags
  tagsInput.value = image.tags ? sortTags(image.tags).join(', ') : '';

  // Extract artist from URL
  const extracted = extractArtistFromUrl(image.pageUrl);
  artistInput.value = extracted.artist || '';
  sourceInput.value = extracted.source || image.pageUrl;

  // Fill description with page title
  descriptionInput.value = image.pageTitle || '';

  // Reset other fields
  copyrightInput.value = '';
  characterInput.value = '';

  // Pre-fill rating from image, or default to Questionable
  const ratingValue = image.rating || 'q';
  const ratingInput = document.querySelector(`input[name="danbooru-rating"][value="${ratingValue}"]`) as HTMLInputElement;
  if (ratingInput) ratingInput.checked = true;

  // Show modal
  danbooruModal.classList.add('active');

  // Reset scroll position after modal is visible
  requestAnimationFrame(() => {
    const danbooruBody = document.querySelector('.danbooru-upload-body') as HTMLElement;
    if (danbooruBody) {
      danbooruBody.scrollTop = 0;
    }
  });
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
  exportRulesToJSON,
  importRulesFromJSON,
  type TagRule,
  type ImportResult
} from '../storage/tag-rules';

const tagRulesList = document.getElementById('tag-rules-list')!;
const ruleNameInput = document.getElementById('rule-name-input') as HTMLInputElement;
const rulePatternInput = document.getElementById('rule-pattern-input') as HTMLInputElement;
const ruleRegexToggle = document.getElementById('rule-regex-toggle') as HTMLInputElement;
const ruleTagsInput = document.getElementById('rule-tags-input') as HTMLInputElement;
const addRuleBtn = document.getElementById('add-rule-btn')!;
const cancelRuleBtn = document.getElementById('cancel-rule-btn')!;
const exportRulesBtn = document.getElementById('export-rules-btn')!;
const importRulesBtn = document.getElementById('import-rules-btn')!;
const importRulesInput = document.getElementById('import-rules-input') as HTMLInputElement;

let editingRuleId: string | null = null;
let newlyImportedRuleIds = new Set<string>();

async function renderTagRules() {
  const rules = await loadTagRules();

  if (rules.length === 0) {
    tagRulesList.innerHTML = '<p class="no-rules-message">No auto-tagging rules configured yet.</p>';
    return;
  }

  tagRulesList.innerHTML = rules.map(rule => `
    <div class="tag-rule-card ${!rule.enabled ? 'disabled' : ''} ${newlyImportedRuleIds.has(rule.id) ? 'newly-imported' : ''}" data-rule-id="${rule.id}">
      <div class="tag-rule-header">
        <div class="tag-rule-info">
          <strong>
            ${escapeHtml(rule.name)}
            ${newlyImportedRuleIds.has(rule.id) ? '<span class="new-badge">NEW</span>' : ''}
          </strong>
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
          <button class="icon-button edit-rule-btn" title="Edit rule">✎</button>
          <button class="icon-button delete-rule-btn" title="Delete rule">×</button>
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

exportRulesBtn.addEventListener('click', async () => {
  const rules = await loadTagRules();
  const jsonString = exportRulesToJSON(rules);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '-' + Date.now();
  const filename = `auto-tagging-rules-${timestamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

importRulesBtn.addEventListener('click', () => {
  importRulesInput.click();
});

importRulesInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const result: ImportResult = await importRulesFromJSON(text);

    newlyImportedRuleIds = new Set(result.imported.map(r => r.id));
    await renderTagRules();

    const message = result.imported.length > 0
      ? `Imported ${result.imported.length} new rule${result.imported.length > 1 ? 's' : ''}${result.skipped > 0 ? `, skipped ${result.skipped} duplicate${result.skipped > 1 ? 's' : ''}` : ''}`
      : `No new rules imported (${result.skipped} duplicate${result.skipped > 1 ? 's' : ''} skipped)`;

    alert(message);
  } catch (error) {
    console.error('Import failed:', error);
    alert('Failed to import rules. Please check the file format.');
  }

  importRulesInput.value = '';
});

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== Notes Panel =====
const notesPanel = document.getElementById('notes-panel')!;
const notesTextarea = document.getElementById('notes-textarea') as HTMLTextAreaElement;
const notesToggle = document.getElementById('notes-toggle')!;

// Load notes from storage
async function loadNotes(): Promise<{ content: string; collapsed: boolean }> {
  const result = await chrome.storage.local.get(['notesContent', 'notesCollapsed']);
  return {
    content: result.notesContent ?? '',
    collapsed: result.notesCollapsed ?? false, // Default: expanded
  };
}

// Save notes content
async function saveNotesContent(content: string): Promise<void> {
  await chrome.storage.local.set({ notesContent: content });
}

// Save collapsed state
async function saveNotesCollapsed(collapsed: boolean): Promise<void> {
  await chrome.storage.local.set({ notesCollapsed: collapsed });
}

// Initialize notes panel
loadNotes().then(({ content, collapsed }) => {
  notesTextarea.value = content;
  if (collapsed) {
    notesPanel.classList.add('collapsed');
    notesToggle.textContent = '+';
  }
});

// Auto-save on input with debouncing
let notesDebounceTimer: number | undefined;
notesTextarea.addEventListener('input', () => {
  clearTimeout(notesDebounceTimer);
  notesDebounceTimer = window.setTimeout(() => {
    saveNotesContent(notesTextarea.value);
  }, 500); // 500ms debounce
});

// Toggle collapse/expand
notesToggle.addEventListener('click', () => {
  const isCollapsed = notesPanel.classList.toggle('collapsed');
  notesToggle.textContent = isCollapsed ? '+' : '−';
  saveNotesCollapsed(isCollapsed);
});

renderTagRules();

loadImages();
