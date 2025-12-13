# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Status

Early prototype with core features completed. Keep it simple and make it work first.

## Anti-Duplication Rules (CRITICAL)

**Lessons from production bugs:**
- Navigation logic was duplicated (`navigateGridByOffset` + `navigateLightboxByOffset`)
- Bug fix applied to grid only, lightbox broke when grouping enabled

**Before adding/changing features:**
1. **Search for similar logic**: Use Grep to find similar function names and patterns
2. **Check high-risk areas**: Navigation logic, filter logic, state updates, event handlers
3. **After fixing bugs**: Grep for similar code that might have same bug
4. **Extract shared logic** when: Same behavior 2+ places, complex logic >20 lines

**The rule**: ONE TRUTH, ZERO COPIES. Fix once, works everywhere.

## Build Commands

- `pnpm build` - Build extension to `dist/`
- `pnpm dev` - Dev mode with hot reload
- `pnpm test` - Run all tests
- `pnpm test:watch` - Watch mode for TDD

## Testing

150 tests covering tag parser, tag removal, auto-tagging, rating extraction.
Extracted pure functions in `src/viewer/tag-utils.ts` for testing (no DOM dependencies).
See `tests/README.md` for details.

## Architecture

### Three-Context System

1. **Background Service Worker** (`src/background/`)
   - **Critical**: No DOM access - use `createImageBitmap()` not `new Image()`
   - Uses `declarativeNetRequest` API for Referer headers (anti-hotlinking bypass)

2. **Viewer Page** (`src/viewer/`)
   - Grid view with Danbooru-style tag search: `girl cat -dog rating:s is:png tagcount:>2 account:user`
   - Two search inputs: URL search (top), tag search with metatags (bottom)
   - Dynamic tag/account sidebars, rating filter pills, bulk operations, lightbox
   - Lazy-loaded images (Intersection Observer), trash/restore system
   - Listens for `IMAGE_SAVED` messages to auto-refresh

3. **Content Script** (`src/content/`)
   - Canvas capture first (fast), falls back to background worker if tainted

### Storage

- **`storage/db.ts`**: IndexedDB wrapper (v3: `updatedAt` index)
  - `getAllMetadata()`: Loads metadata without blobs (lazy loading)
  - `getBlob(id)`: Loads single blob on-demand
- **`storage/service.ts`**: High-level operations
  - All metadata update functions set `updatedAt = Date.now()`

### Communication

Background → Viewer: `chrome.runtime.sendMessage({ type: 'IMAGE_SAVED' }).catch(() => {})`
Always wrap in `.catch()` since viewer may not be open.

## Key Patterns & Gotchas

1. **CSS**: Use `grid.style.display = ''` to clear inline styles, let CSS control display
2. **BEM CSS Convention**: All new CSS classes MUST follow BEM naming (Block__Element--Modifier)
   - Block: `.page-header`, `.tag-sidebar`, `.bulk-tag-modal`, `.preview-bulk-tag`
   - Element: `.page-header__title`, `.tag-sidebar__heading`, `.bulk-tag-section__title`, `.preview-bulk-tag__input`
   - Modifier: `.tag-sidebar-item--included`, `.rating-filter-pill--active`, `.preview-bulk-tag__button--primary`
   - **Never use tag selectors** (header, h1, h3, button, etc.) - always use explicit classes
   - **Why BEM**: Prevents class name conflicts, self-documenting, AI-friendly explicit relationships
3. **Service Worker**: Use `createImageBitmap()` for dimensions, not `new Image()`
4. **Grouping**: Set `grid.style.display = 'block'` for grouped rendering
5. **Visual Order**: Use `getVisualOrder()` helper for selection/navigation when grouping enabled (prevents index mismatches)
6. **Selection State**: Use `Set<string>` for selected IDs, persists across re-renders
7. **Anti-Hotlinking**: Canvas capture first, declarativeNetRequest as fallback
8. **Event Delegation**: Single listener on `#image-grid` for all card interactions
9. **Button States**: Selection-dependent buttons disabled when `state.selectedIds.size === 0`
10. **Card Selection**: Click card to toggle selection (deselects if single-selected, otherwise single-selects)

## Critical Systems

### Tag Sorting (`src/viewer/tag-utils.ts`)

`sortTags(tags: string[])` sorts tags alphabetically (case-insensitive):
- Applied on save in `service.ts`: `saveImage()`, `updateImageTags()`, `addTagsToImages()`, `importLocalFiles()`
- Applied on render in `viewer/index.ts`: All tag display locations (cards, preview, lightbox, Danbooru)
- Ensures "cat girl" and "girl cat" both result in `["cat", "girl"]`
- No migration needed: Old data sorted on render, new data sorted on save
- DB naturally normalizes over time as users edit images

### Tag Search Parser (`src/viewer/tag-utils.ts`)

`parseTagSearch(query)` extracts metatags and returns `ParsedTagSearch`:
- `includeTags: string[]` - AND logic
- `excludeTags: string[]` - Excluded tags
- `orGroups: string[][]` - OR logic groups
- `ratings: Set<string>` - Rating filters (g/s/q/e/unrated)
- `fileTypes: Set<string>` - Type filters
- `tagCount: TagCountFilter | null` - Tag count filter (operators: =, >, <, >=, <=, range, list)
- `includeUnrated: boolean` - Unrated filter

No state properties - all filter state derived from search input value.

### Clickable Image Card Elements

**Tags**: Click `.image-tags__tag` to toggle tag in search
- `toggleTagInSearch(tag)`: Checks if tag active, adds or removes from search
- Active tags highlighted green (`.image-tags__tag--active`)

**Account Button**: Click `.image-account-btn` to toggle account filter (X/Twitter only)
- `toggleAccountInSearch(account)`: Checks if account active, adds/removes `account:xxx` from search
- Button only shown when `getXAccountFromUrl()` extracts account from pageUrl
- Active state highlighted green (`.image-account-btn--active`)
- Appears below tags on image cards

### Tag Sidebar

Functions that modify search input:
- `addTagToSearch(tag)`: Appends tag (checks duplicates)
- `excludeTagFromSearch(tag)`: Removes from include, adds `-tag`
- `removeIncludedTagFromSearch(tag)`: Uses `removeTagFromQuery()` to clean up orphaned "or" operators
- `removeExcludedTagFromSearch(tag)`: Removes `-tag`
- `toggleTagInSearch(tag)`: For clickable tags on cards
- `toggleAccountInSearch(account)`: For clickable account button on cards
- `addAccountToSearch(account)`: For account sidebar
- `removeAccountFromSearch(account)`: Removes `account:xxx` pattern

### Auto-Tagging Rules (`src/storage/tag-rules.ts`)

Rules stored in `chrome.storage.local`. Applied during `saveImage()`:
- Empty pattern matches all images
- Plain text: case-insensitive substring match on pageTitle
- Regex: standard test with error handling
- Multiple rules can match, tags merged (no duplicates)

Export/import with duplicate detection by content fingerprint (not ID).

### Rating System

- Stored as `rating?: 'g' | 's' | 'q' | 'e'` on SavedImage
- `extractRatingFromTags()`: Converts `rating:*` tags to rating field
- Rating filter pills: `getRatingCounts()` **intentionally duplicates** filter logic from `applyFilters()` (excludes rating filter to show all counts)
- **Keep in sync**: If `applyFilters()` changes, update `getRatingCounts()`

### Lazy Loading & Memory Management

**Critical for large datasets:**
- `state.images`: Metadata only (no blobs)
- `state.loadedBlobs`: Map of loaded blobs
- `state.objectUrls`: Cached blob URLs
- **Pattern**: Call `revokeObjectURLs()` before re-rendering to prevent memory leaks
- Performance: ~20-50MB initial load vs ~6GB (>90% reduction for 2000 images)

### Selection & Button States

**Card click behavior**:
- Click card area (not image/tags/buttons) to handle selection
- Normal click: Toggle if single-selected, otherwise single-select
- Cmd/Ctrl + Click: Toggle individual item
- Shift + Click: Select range from anchor

**Button state management**:
- `updateButtonStates()` called from `updateSelectionCount()`
- Disables "Tag Selected", "Delete Selected", "Dump Selected", "Restore Selected", "Deselect All" when no selection
- Buttons use `:disabled` CSS with 50% opacity and `cursor: not-allowed`
- **Disabled hover states**: Each button type maintains its specific color on `:disabled:hover` (primary: #007bff, secondary: #6c757d, danger: #dc3545) - prevents visual inconsistency

**Checkbox update optimization**:
- `createImageCardHTML()` sets initial checkbox state correctly - no post-render updates needed
- `updateAllCheckboxes()` only updates checkboxes when `cb.checked !== shouldBeChecked` (skip identical state)
- Reduces unnecessary DOM updates during selection changes and re-renders

### Keyboard Navigation

Grid: Arrow keys (respects columns), Shift+Arrow (extend selection), Space (lightbox), Escape (close)
Lightbox: Left/Right (prev/next), Up/Down (by columns), Space/Escape (close)

### Tag Input Behavior

All tag inputs use two-step completion:
1. Autocomplete has selection? → Insert selected tag
2. Current token incomplete? → Complete it (add space)
3. Otherwise → Execute submit action

Functions: `setupTagAutocomplete()`, `isCurrentTokenIncomplete()`, `completeCurrentToken()`
Use `mousedown` (not `click`) for autocomplete suggestions to prevent premature blur.

### Metadata Editing

**Preview Sidebar**: Always editable, auto-save on blur
**Lightbox**: Read-only by default, click "Edit" to enable editing
Both update `updatedAt` timestamp on save.

**Performance optimization**:
- `syncImageMetadataToState()`: Updates state and intelligently re-renders
  - Non-filtering fields (pageTitle): Only updates preview pane
  - Filtering fields (tags, rating, pageUrl): Checks if image position changed
  - Same position: Surgical single-card update via `updateSingleImageCardInDOM()`
  - Position changed: Full grid re-render (necessary for correct sort order)
- `applyFiltersWithoutRender()`: Runs filter logic without rendering (for position checks)
- `updateSingleImageCardInDOM()`: Replaces single card HTML without rebuilding entire grid

### SQLite Import/Export (`src/storage/sqlite-import-export.ts`)

**Export**:
- Folder-based export (File System Access API)
- Multi-file: 200 images per file (avoids memory errors)
- Batched blob loading: 50 at a time
- Never holds all blobs in memory

**Import**:
- Three modes: skip, override, review
- Multi-file selection supported
- Database kept open during conflict review (caller must call `closeImportDatabase()`)

### Danbooru Upload

Two-step post creation:
1. POST `/uploads.json` with image URL → get `upload_media_asset_id`
2. POST `/posts.json` with asset ID → create post
3. PUT `/posts/{id}/artist_commentary/create_or_update.json` (optional)

Uses JSON format (not FormData). Danbooru downloads image from URL.

## Development Philosophy

Working code first, refinement later. Build features when needed, not all at once.

**Refactor trigger**: When human developer wants to write code themselves, not before.
- ✅ Refactor when: "I want to write features myself", real pain points, state bugs
- ❌ Don't refactor for: "code feels complex", "should use UI library"

AI-maintained 1200-line files work fine for Claude Code. Only refactor for human ergonomics when humans need to contribute.
