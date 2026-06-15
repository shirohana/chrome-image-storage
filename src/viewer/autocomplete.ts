import { state } from './state';

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
export function setupTagAutocomplete(
  input: HTMLInputElement | HTMLTextAreaElement,
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
