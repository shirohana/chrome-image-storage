# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Early prototype with core features completed. All planned "Quick Wins" and "Useful Features" from roadmap are implemented. Keep it simple and make it work first.

## Anti-Duplication Rules (CRITICAL)

**Lessons from production bugs:**
- Navigation logic was duplicated (`navigateGridByOffset` + `navigateLightboxByOffset`)
- Bug fix applied to grid navigation only
- Lightbox navigation broke when grouping enabled
- User discovered bug, not tests

**Before adding/changing features:**
1. **Search for similar logic**: Use Grep to find similar function names and patterns
2. **Check these high-risk areas** where duplication has occurred:
   - Navigation logic (grid vs lightbox)
   - Filter logic (various filter types)
   - State update patterns (selection, tags, ratings)
   - Event handlers (grid cards vs lightbox)
3. **After fixing any bug**: Grep for similar code that might have the same bug
4. **Extract shared logic** when:
   - Same behavior in 2+ places (navigation, filtering, state updates)
   - Complex logic >20 lines
   - Bug-prone user interactions

**Specific patterns to watch:**
- `function navigateXByOffset` / `function navigateYByOffset` → Likely duplicates
- `function updateX` / `function updateY` with similar bodies → Consider extracting
- Event handlers with similar `addEventListener` patterns → Extract handler logic
- Filter/sort logic appearing in multiple functions → Extract to shared function

**The rule**: ONE TRUTH, ZERO COPIES. Fix once, works everywhere.

## Build Commands

- `pnpm build` - Build extension to `dist/`
- `pnpm dev` - Dev mode with hot reload
- `pnpm test` - Run all tests
- `pnpm test:watch` - Watch mode for TDD workflow

Load `dist/` as unpacked extension in Chrome.

## Testing

Comprehensive test suite (150 tests, ~11ms execution time):

**Test Files** (`tests/` directory):
- `tag-parser.test.ts`: 50 tests for `parseTagSearch()` - Danbooru-style syntax parsing
- `tag-query.test.ts`: 49 tests for `removeTagFromQuery()` - Tag removal with "or" operator cleanup
- `auto-tagging.test.ts`: 26 tests for `matchesRule()` and `getAutoTags()` - Rule matching logic
- `rating-extraction.test.ts`: 25 tests for `extractRatingFromTags()` - Tag-to-rating conversion

**Extracted for Testing**:
- `src/viewer/tag-utils.ts`: Pure tag parsing functions (no DOM dependencies)
  - `parseTagSearch(query: string): ParsedTagSearch` - Main parser function
  - `removeTagFromQuery(query: string, tag: string): string` - Tag removal utility
  - `TagCountFilter` interface - Tag count filter types
  - `ParsedTagSearch` interface - Parser result type
- `src/storage/service.ts`: Exported `extractRatingFromTags()` for testing
- `src/storage/tag-rules.ts`: Exported `matchesRule()` for testing

**Why Tests Matter**:
- Tag parser has 15+ parsing rules with complex interactions
- User-configured regex patterns in auto-tagging are error-prone
- Rating extraction affects data integrity across multiple operations
- Fast feedback loop prevents regressions during refactoring

See `tests/README.md` for detailed documentation.

## Architecture

### Three-Context System

Chrome extensions run in three separate JavaScript contexts:

1. **Background Service Worker** (`src/background/`)
   - Handles context menu, saves images, sends notifications
   - **Critical**: No DOM access - use `createImageBitmap()` not `new Image()`
   - Uses `declarativeNetRequest` API to set Referer headers for anti-hotlinking bypass

2. **Viewer Page** (`src/viewer/`)
   - Full-page UI with multiple features:
     - Grid view for browsing images
     - Two search inputs: URL/page title search (top) and tag search (bottom)
     - Danbooru-style unified tag search syntax:
       - Tag filters: `girl cat` (AND), `girl or cat` (OR), `-dog` (exclude)
       - Rating filter: `rating:g`, `rating:s,q` (comma-separated)
       - Type filter: `is:png`, `is:jpg,webp` (comma-separated)
       - Tag count filter: `tagcount:2`, `tagcount:>5`, `tagcount:1..10`
       - Account filter: `account:username`, `account:user1,user2` (comma-separated)
       - Exclude accounts: `-account:spammer`
       - Unrated filter: `is:unrated`
       - Combine all: `girl cat -dog rating:s is:png account:artist123`
     - Quick rating filter pills above tag sidebar
       - 5 horizontal pills: G/S/Q/E/Unrated with image counts (e.g., "G 42", "S 15")
       - Counts update based on current filters (excluding rating filter)
       - Click to toggle rating filters (multi-select)
       - Active pills show colored backgrounds matching rating badge colors
       - Syncs bidirectionally with tag search input (`rating:` syntax)
     - Dynamic tag sidebar showing tags from filtered results
       - Click tag name to include/remove from search
       - Click + to include, - to exclude
       - Selected tags highlighted and sorted to top
       - Always shows selected tags even with 0 count
     - Dynamic account sidebar (only shown when grouping by X account)
       - Shows X/Twitter accounts with image counts (sorted by count desc)
       - Click account name to include/remove from search
       - Click + to include, - to exclude accounts
       - Works alongside tag sidebar for combined filtering
     - Clickable tags on image cards for instant filtering
     - Sort by saved date, updated date, size, dimensions, or URL
     - Group by X account or show duplicates
     - Multi-select with checkboxes
     - Bulk operations: delete selected, export selected, tag selected, set rating
     - Tag management per image or in bulk
     - Rating management per image or in bulk
     - Lightbox for full-size viewing
     - Duplicate detection by dimensions + file size
   - Listens for `IMAGE_SAVED` messages to auto-refresh

3. **Content Script** (`src/content/`)
   - Captures images from DOM via canvas (avoids network request)
   - Finds images by URL matching (exact, normalized, without query params)
   - Falls back to background worker if canvas capture fails

### Storage

- **`storage/db.ts`**: IndexedDB wrapper (store: `images`, keyPath: `id`)
  - Database version 3: Added `updatedAt` index for sorting performance
  - `getAllMetadata()`: Loads metadata without blobs (for lazy loading)
  - `getBlob(id)`: Loads single blob on-demand
- **`storage/service.ts`**: High-level operations like `saveImage()`, `deleteImage()`
  - `getAllImagesMetadata()`: Returns metadata-only for initial load
  - `getImageBlob(id)`: Fetches individual blob when needed
  - All metadata update functions set `updatedAt = Date.now()`:
    - `updateImageTags()`, `addTagsToImages()`, `removeTagsFromImages()`
    - `updateImageRating()`, `updateImagesRating()`
    - `updateImagePageTitle()`, `updateImagePageUrl()`
- Images stored as Blobs, lazy-loaded on scroll using Intersection Observer

### Communication

- Background → Viewer: `chrome.runtime.sendMessage({ type: 'IMAGE_SAVED' }).catch(() => {})`
- Always wrap in `.catch()` since viewer may not be open

## Key Learnings

1. **CSS Specificity**: Use `grid.style.display = ''` to clear inline styles, let CSS classes control display. Avoid `!important`.
2. **Service Worker APIs**: Use `createImageBitmap()` for dimensions, not `new Image()`
3. **Icon Paths**: Full paths like `src/icons/icon-48.png` in notifications
4. **Event Listeners**: Extract `attachEventListeners()` function for code reuse between grouped and ungrouped rendering
5. **Grouping**: Use `Map<string, SavedImage[]>` for X account/duplicate grouping, render sections with headers
   - X Account grouping: Extracts account from x.com/twitter.com URLs, sorts by image count (desc)
   - Duplicate detection: Groups images by `${width}×${height}-${fileSize}`, shows only groups with 2+ images
   - Simple matching (no hash computation) for performance
   - Important: Set `grid.style.display = 'block'` for grouped rendering to prevent outer container from using grid layout
   - **Visual Order Handling**: Use `getVisualOrder()` helper for all selection/navigation operations when grouping is enabled
     - Returns images in their actual rendering order (respects grouping)
     - Ensures shift-click range selection, keyboard navigation, and lightbox navigation work correctly
     - Single source of truth prevents index mismatches between filtered array and DOM order
6. **Selection State**: Use `Set<string>` to track selected image IDs, persists across re-renders
7. **Export Filenames**: Use image IDs instead of sequential numbers for easier metadata matching
8. **Anti-Hotlinking Bypass**: Two-tier approach:
   - Try canvas capture from DOM first (fast, no network request, works for same-origin)
   - Fall back to `declarativeNetRequest` API to inject Referer header (bypasses 403 errors from sites like Pixiv)
   - Canvas `toBlob()` fails on tainted (cross-origin) images, unlike what docs suggest
9. **UI Simplification**: Streamlined interface with compact controls
   - Smaller buttons (`.btn-sm` class: 6px 12px padding, 12px font)
   - Shorter button labels: "Download" → "Save", "View Page" → "Source", "View Original" → "Raw"
   - Single-char ratings (G/S/Q/E/-) instead of full words
   - Image cards: Only Save and Delete buttons, "From:" text is clickable link
   - Flexbox layout for button alignment (`.image-card` and `.image-info` use flex, `.image-actions` has `margin-top: auto`)

## Advanced Patterns

### Trash & Restore System

- **Soft Delete**: `deleteImage()` sets `isDeleted: true` flag (marks for trash)
- **Restore**: `restoreImage()` sets `isDeleted: false` (recovers from trash)
- **Permanent Delete**: `permanentlyDeleteImage()` removes from IndexedDB
- **View Toggle**: "All Images" vs "Trash" views with separate action buttons
- **Filters**: `applyFilters()` checks `isDeleted` flag based on current view

### Tag Management System

**Data Model**:
- Tags stored as `tags: string[]` on SavedImage
- Empty array or undefined if no tags

**Individual Image Tagging**:
- Tag editor in preview pane (single selection) and lightbox
- Inline tag input with autocomplete from existing tags
- Auto-save on blur or Enter key (no save button needed)
- `updateImageTags(id, tags)`: Updates tags for single image
- Tags rendered as pills (click to filter)

**Bulk Tag Operations**:
- "Tag Selected" button opens modal for multi-image operations
- **Add Tags Section**: Adds tags to all selected images (duplicates prevented)
- **Remove Tags Section**: Removes tags from all selected images
- Both sections feature autocomplete from existing tags
- `addTagsToImages(imageIds, tagsToAdd)`: Bulk add operation
- `removeTagsFromImages(imageIds, tagsToRemove)`: Bulk remove operation

**Danbooru-Style Tag Search System**:
- Two search inputs in toolbar:
  - `#url-search-input`: URL/page title search (top)
  - `#tag-search-input`: Tag search with Danbooru syntax (bottom)
- **Unified Search Syntax**: All filtering via single tag search input
  - Tag include (AND): `girl cat` - Both tags required
  - Tag include (OR): `girl or cat` - Either tag required
  - Tag exclude: `-dog` - Exclude images with this tag
  - Rating filter: `rating:g` or `rating:g,s,q` (comma-separated)
  - Type filter: `is:png` or `is:jpg,webp` (comma-separated)
  - Tag count: `tagcount:2`, `tagcount:>5`, `tagcount:1..10`
  - Unrated: `is:unrated`
  - Combine: `girl cat -dog rating:s is:png tagcount:>2`
- **Parser**: `parseTagSearch(query)` extracts metatags and tag terms
  - Returns `ParsedTagSearch` object with:
    - `includeTags: string[]` - AND logic tags
    - `excludeTags: string[]` - Excluded tags
    - `orGroups: string[][]` - OR logic tag groups
    - `ratings: Set<string>` - Rating filters
    - `fileTypes: Set<string>` - Type filters
    - `tagCount: TagCountFilter | null` - Tag count filter
    - `includeUnrated: boolean` - Unrated filter flag
- **No State Properties**: All filter state derived from search input value
  - Removed: `state.tagFilters`, `state.excludedTagFilters`, `state.tagFilterMode`, `state.showUntaggedOnly`, `state.typeFilter`, `state.ratingFilters`
  - Parse search input on every `applyFilters()` call
- **Autocomplete**: `setupTagSearchAutocomplete()` provides tag suggestions
  - Shows up to 8 matching tags from existing image tags
  - Filters based on current token at cursor position
  - Preserves exclusion prefix (`-`) when completing excluded tags
  - Skips metatags (`rating:`, `is:`, `tagcount:`) and operators (`or`)
  - Excludes already-entered tags from suggestions
  - Auto-selects first item only when actively typing/filtering (not when showing all tags)
  - Arrow keys to navigate, Enter/Tab to select, Escape to dismiss
  - Tag list refreshed after images load via `updateTagAutocompleteAvailableTags()`

**Tag Sidebar** (`#tag-sidebar`):
- Dynamic sidebar showing tags from currently filtered results
- **Location**: Left side of main container, sticky positioned
- **Rendering**: `updateTagSidebar(images)` called after filtering
  - Counts tags from filtered images
  - Adds included/excluded tags with count 0 if missing (always visible)
  - Sorts: selected tags first, then by count (desc), then alphabetically
  - Selected tags highlighted: `.tag-sidebar-item-included` (green), `.tag-sidebar-item-excluded` (red)
- **Interactions**:
  - Click tag name: `addTagToSearch()` if unselected, `removeIncludedTagFromSearch()` if included, `removeExcludedTagFromSearch()` if excluded
  - Click + button: `addTagToSearch(tag)` - adds to search (with duplicate check)
  - Click - button: `excludeTagFromSearch(tag)` - removes from include if present, then adds exclusion
- **Key Functions**:
  - `addTagToSearch(tag)`: Appends tag to search input (checks for duplicates)
  - `excludeTagFromSearch(tag)`: Removes from include first, then adds `-tag` exclusion
  - `removeIncludedTagFromSearch(tag)`: Removes tag and cleans up orphaned "or" operators (uses `removeTagFromQuery()`)
  - `removeExcludedTagFromSearch(tag)`: Removes `-tag` from search
  - `removeTagFromQuery(query, tag)`: Utility to remove tag from query string, cleaning up orphaned "or" operators (exported from tag-utils.ts, covered by 49 tests)

**Clickable Tags on Image Cards**:
- Click tags on image cards to toggle them in/out of search
- `toggleTagInSearch(tag)`: Checks if active, removes if yes, adds if no
- Active tags highlighted in green with glow effect (`.tag-active`)
- Event handler in `imageGrid.addEventListener('click')` checks for `.image-tags .tag`
- Highlighting determined by parsing current tag search input

**Enter Key Behavior for Tag Inputs**:
All tag inputs support two-step completion flow for better UX:

1. **Priority Order** (when Enter is pressed):
   - Autocomplete has selection? → Insert selected tag
   - Current token incomplete? → Complete it (add space)
   - Otherwise → Execute submit action

2. **Main Tag Search Input** (`#tag-search-input`):
   - Enter with incomplete token (`girl longhair|`) → Complete to `girl longhair |`
   - Enter with complete token → Blur input (completes search, hides autocomplete)

3. **Preview/Lightbox Tag Input** (`#lightbox-tag-input`):
   - Enter with incomplete token → Complete token
   - Enter with complete token → Save tags

4. **Bulk Tag Modal Inputs**:
   - Add Tags input → Enter focuses Remove Tags input
   - Remove Tags input → Enter blurs input (user can adjust rating options, then click Save)

**Implementation**:
- `setupTagAutocomplete(input, autocompleteId, options)`: Unified autocomplete setup
  - `options.customTags`: Optional array of available tags (defaults to all image tags)
  - `options.onEnterComplete`: Optional callback when Enter pressed with complete token
  - `options.enableDanbooruSyntax`: Enable Danbooru metatag filtering (for main search)
  - Returns `{ updateAvailableTags?: () => void }` for refreshing tag list
- `isCurrentTokenIncomplete()`: Checks if current token has trailing space
- `completeCurrentToken()`: Adds space to complete token
- AbortController used to clean up event listeners when inputs are re-rendered

**Focus Behavior for Preview/Lightbox Tag Inputs**:
- Automatically appends space when focusing input (if not already present)
- Cursor moves to end after space → autocomplete naturally appends new tags
- Prevents replacement of existing tags when adding new ones
- Example: Focus on `cat girl` → becomes `cat girl |` → type/select tag → appends

**Autocomplete Interaction**:
- Uses `mousedown` event instead of `click` for suggestion selection
- `preventDefault()` on mousedown prevents input blur before tag insertion
- Ensures smooth tag completion without triggering save prematurely

### Auto-Tagging Rules System

**Location**: `src/storage/tag-rules.ts`

**Data Model**:
```typescript
interface TagRule {
  id: string;
  name: string;
  pattern: string;
  isRegex: boolean;
  tags: string[];
  enabled: boolean;
}
```

**Storage**: Rules stored in `chrome.storage.local` under `tagRules` key

**Matching Logic**:
- Empty pattern (`''`) matches all images (always-apply rule)
- Plain text: Case-insensitive substring match on page title
- Regex: Standard regex test with error handling (invalid regex = no match)
- Multiple rules can match: All matching tags are merged together (no duplicates)

**Integration Flow**:
1. `saveImage()` in `storage/service.ts` loads rules before saving image
2. Calls `getAutoTags(pageTitle, rules)` to get matching tags
3. Applies merged tags to new image before IndexedDB insertion
4. Only enabled rules are evaluated

**UI Location**: Settings panel → "Auto-Tagging Rules" section

**UI Features**:
- Rule cards display: name, pattern, tags, enabled toggle
- Add/Edit form: name, pattern, regex toggle, tags input
- Enable/disable toggle: Styled toggle switch (green when enabled)
- Edit: Populates form, changes "Add Rule" → "Update Rule"
- Delete: Confirmation dialog before removal
- Empty state: "No auto-tagging rules configured yet"

**Key Functions**:
- `loadTagRules()`: Fetch all rules from chrome.storage.local
- `saveTagRules(rules)`: Persist rules to chrome.storage.local
- `addTagRule(rule)`: Create new rule with UUID
- `updateTagRule(id, updates)`: Partial update of existing rule
- `deleteTagRule(id)`: Remove rule by ID
- `getAutoTags(pageTitle, rules)`: Returns merged tags from all matching enabled rules
- `exportRulesToJSON(rules)`: Export rules as formatted JSON string
- `importRulesFromJSON(jsonString)`: Import rules with smart duplicate detection

**Export/Import System**:
- **Export**: Download all rules as timestamped JSON file (`auto-tagging-rules-YYYY-MM-DD-timestamp.json`)
- **Import**: Upload JSON file with smart duplicate detection
  - Duplicate detection by content fingerprint (name + pattern + isRegex + tags), not ID
  - Identical rules skipped automatically
  - New/edited rules imported with fresh IDs, enabled by default
  - Visual feedback: Newly imported rules highlighted with green border and "NEW" badge
  - Highlights persist until settings panel collapsed
  - Import message shows count: "Imported X new rules, skipped Y duplicates"

**Pattern Examples**:
- `''` (empty) → Always matches
- `pixiv` → Matches "Pixiv Art - Illustration" (case-insensitive substring)
- `^(Twitter|X\.com)` (regex) → Matches page titles starting with "Twitter" or "X.com"

### Rating System

**Data Model**:
- Ratings stored as `rating?: 'g' | 's' | 'q' | 'e'` on SavedImage
- Optional field: undefined if no rating applied
- Values: `g` (General), `s` (Sensitive), `q` (Questionable), `e` (Explicit)

**Tag-to-Rating Conversion**:
- Special tags `rating:g`, `rating:s`, `rating:q`, `rating:e` automatically convert to rating field
- Helper function `extractRatingFromTags()`: Finds first rating tag, removes all rating tags from array
- Conversion happens during:
  - `saveImage()`: Extracts from auto-tags
  - `updateImageTags()`: Extracts when tags updated
  - `addTagsToImages()`: Extracts in bulk tag operations
  - `removeTagsFromImages()`: Clears rating if rating tag removed

**Storage**:
- IndexedDB v2: Added `rating` index for filtering performance
- SQLite schema: Added `rating TEXT` column for export/import compatibility
- `updateImageRating(id, rating)`: Updates single image rating
- `updateImagesRating(ids, rating)`: Bulk updates rating

**UI Components**:

1. **Rating Filter Pills** (Toolbar):
   - 5 horizontal pills: G/S/Q/E/Unrated (positioned above tag sidebar)
   - Pills display image counts based on current filters (e.g., "G 42", "S 15")
   - `getRatingCounts()`: Duplicates filter logic from `applyFilters()` but excludes rating filter
     - **Intentional duplication**: Allows showing counts for all ratings regardless of which are selected
     - Must be kept in sync with filter logic if `applyFilters()` changes
   - Click pills to toggle rating filters (multi-select)
   - Active pills show colored backgrounds matching rating badge colors
   - Syncs bidirectionally with tag search input (`rating:` syntax)
   - OR logic: Shows images with ANY selected rating

2. **Color-Coded Badges** (Image Cards):
   - Top-right corner badge on each card
   - Color scheme: Green (G), Yellow (S), Orange (Q), Red (E), Gray (—) for unrated
   - Always visible, semi-transparent background

3. **Rating Editor** (Preview Pane):
   - Radio buttons for single image selection
   - Five options: G, S, Q, E, - (single-char format)
   - Updates rating immediately on change, re-renders grid with new badge

4. **Bulk Rating** (Bulk Tag Modal):
   - "Set Rating" section with radio buttons
   - Six options: G/S/Q/E/Unrated/No Change
   - "No Change" default: keeps existing ratings on selected images
   - Applied alongside bulk tag operations

5. **Danbooru Integration**:
   - Pre-fills rating from `image.rating` field
   - Falls back to 'q' (Questionable) if unrated (Danbooru default)
   - User can change before upload

**Filter State**:
- `state.ratingFilters`: Set<string> of active rating filters ('g'|'s'|'q'|'e'|'unrated')
- Filter logic applied after type filter, before tag filter
- Compatible with all existing filters (cumulative filtering)

**Migration Strategy**:
- No automatic migration on load (avoids performance cost)
- Users filter by existing `rating:*` tags manually
- Use bulk tag operations to convert old tags to new rating field
- Rating tags automatically cleaned from tags array on conversion

### Tag Count Filter (Danbooru-style Search)

**Location**: Integrated into tag search input (`#tag-search-input`)

**Syntax Support**:
- `tagcount:2` - Exactly 2 tags
- `tagcount:1,3,5` - List: 1 OR 3 OR 5 tags
- `tagcount:>5` - More than 5 tags
- `tagcount:<3` - Less than 3 tags
- `tagcount:>=2` - 2 or more tags
- `tagcount:<=10` - 10 or fewer tags
- `tagcount:1..10` - Range: 1 to 10 tags (inclusive)

**Implementation**:
- Part of `parseTagSearch(query)` function which parses all Danbooru-style syntax
  - Extracts `tagcount:` metatag along with other filters
  - Returns `ParsedTagSearch` object with `tagCount: TagCountFilter | null`
  - Supports list, range, comparison operators, and exact match
  - List regex checked first: `/tagcount:(\d+(?:,\d+)+)/i`
  - Range/comparison regex: `/tagcount:(>=|<=|>|<|)(\d+)(\.\.(\d+))?/i`
- Applied in `applyFilters()` after URL search and tag filtering
- Counts total tags: `img.tags?.length ?? 0`
- Compatible with all other filters (tags, rating, type, exclude)

**Data Model**:
```typescript
interface TagCountFilter {
  operator: '=' | '>' | '<' | '>=' | '<=' | 'range' | 'list';
  value?: number;        // For single value operators
  values?: number[];     // For list operator
  min?: number;          // For range operator
  max?: number;          // For range operator
}
```

**Examples**:
- `tagcount:2` + select "girl" tag → Images with "girl" and exactly 2 total tags
- `pixiv tagcount:0,1,2` → Pixiv images with 0-2 tags
- `tagcount:>10` → Images with more than 10 tags

### Preview Pane

- Right-side collapsible pane showing selected image details
- **Single Selection**: Full preview image + metadata panel with editable fields
  - Always-editable inputs for page title and page URL (auto-save on blur)
  - Tag input with autocomplete (auto-save on blur or Enter)
  - Single-char rating selector (G/S/Q/E/-)
  - Compact action buttons (.btn-sm): Source, View, Save, Danbooru
- **Multi-Selection**: Thumbnail grid with count
- **State**: `previewPaneVisible` persisted in localStorage
- **Updates**: Synced on selection change via `updatePreviewPane()`

### Notes Panel

- **Location**: Left sidebar, below tag sidebar (Section B in two-section layout)
- **Layout**: Auto-height textarea (120px default, user-resizable)
- **Storage**: Persisted to `chrome.storage.local` with 500ms debounce on input
- **State**: Collapsed state also persisted (`notesCollapsed` boolean)
- **Toggle**: Click `−/+` button to collapse/expand, starts expanded by default
- **HTML**: `#notes-panel` container with `#notes-textarea` input
- **CSS Structure**:
  - `.left-sidebar-container`: Fixed height (`calc(100vh - 200px)`), sticky from `top: 180px`
  - `.tag-sidebar`: Section A with `flex: 1` (takes remaining space), has overflow scrolling
  - `.notes-panel`: Section B with `flex-shrink: 0` (auto-height, doesn't grow/shrink)
  - Tag sidebar's `.tag-sidebar-list` has its own scrollbar (`overflow-y: auto`)
- **Key Functions**:
  - `loadNotes()`: Returns `{ content: string, collapsed: boolean }` from storage
  - `saveNotesContent(content)`: Saves textarea content to storage
  - `saveNotesCollapsed(collapsed)`: Saves toggle state to storage
  - Debounce timer (`notesDebounceTimer`) prevents excessive storage writes

### Keyboard Navigation

Grid navigation (respects grid columns for up/down):
- **Arrow Keys**: Navigate grid, auto-select single item
- **Shift + Arrow**: Extend selection range from anchor point
- **Space**: Toggle lightbox for currently selected item
- **Escape**: Close lightbox

Lightbox navigation:
- **Arrow Left/Right**: Previous/next image
- **Arrow Up/Down**: Navigate by grid columns (maintains visual position)
- **Space/Escape**: Close lightbox

### Lazy Loading & Memory Management

**Critical for performance with large datasets**:

**Data Model**:
- `state.images`: Array of `ImageMetadata` (without blobs) - loaded on startup
- `state.loadedBlobs`: Map<string, Blob> - blobs loaded on-demand
- `state.objectUrls`: Map<string, string> - cached blob URLs

**Lazy Loading Flow**:
1. **Initial Load**: `loadImages()` calls `getAllImagesMetadata()` - loads only metadata (no blobs)
2. **Rendering**: Images rendered with placeholder SVG initially
3. **Intersection Observer**: Monitors when images scroll into viewport (200px margin)
4. **Blob Loading**: `loadImageBlob(id)` fetches blob from IndexedDB when visible
5. **URL Creation**: `getOrCreateObjectURL(id)` creates blob URL from loaded blob

**On-Demand Loading**:
- Preview pane: Loads blob when image selected
- Lightbox: Loads blob when opening full view
- Download: Loads blob when download button clicked
- Export: Loads all blobs only when exporting

**Memory Management**:
- `getOrCreateObjectURL(imageId)`: Creates blob URL once, caches in `state.objectUrls`
- `revokeObjectURLs()`: Revokes all URLs and clears cache
- `revokeObjectURL(imageId)`: Revokes single URL
- **Pattern**: Always call `revokeObjectURLs()` before re-rendering to prevent memory leaks

**Performance Benefits**:
- Initial load: ~20-50MB (metadata only) vs ~6GB (all blobs)
- Scrolling: Only loads visible images (~20-30 at a time)
- Peak memory: ~500MB vs ~6GB for 2000 images (>90% reduction)

### Selection State Management

State tracking (persists across re-renders):
- `selectedIds`: Set<string> of currently selected image IDs
- `lastSelectedIndex`: Index of last clicked item (for arrow key navigation)
- `selectionAnchor`: Starting index for shift-click range selection
- **Cleared**: When switching between "All Images" and "Trash" views

Selection interactions:
- **Click**: Single-select (clears others)
- **Cmd/Ctrl + Click**: Toggle individual item
- **Shift + Click**: Select range from anchor to clicked item
- **Checkbox**: Toggle without affecting anchor

### Event Delegation Pattern

Single event listener on `#image-grid` for all image cards:
- Handles: download, view, delete, restore, permanent-delete buttons
- Handles: image preview clicks (opens lightbox)
- Handles: card clicks (selection with modifier keys)
- **Benefit**: No need to re-attach listeners after re-render
- **Note**: Checkbox changes use separate 'change' event listener

### Updated At Timestamp Tracking

**Data Model**:
- `updatedAt?: number` field tracks last modification time
- Set automatically when metadata changes (tags, rating, title, URL)
- Falls back to `savedAt` if undefined (for images saved before this feature)

**Update Triggers**:
All metadata modification functions set `updatedAt`:
- Tag operations: `updateImageTags()`, `addTagsToImages()`, `removeTagsFromImages()`
- Rating operations: `updateImageRating()`, `updateImagesRating()`
- Metadata edits: `updateImagePageTitle()`, `updateImagePageUrl()`

**Sorting Behavior**:
- `applySorting()` handles `updatedAt` field with fallback: `(a.updatedAt ?? a.savedAt)`
- When sorted by "Recently updated", changes trigger automatic re-sort
- `applyFilters()` calls `applySorting()` first to ensure updated images move to correct position
- Local state tracking: `imageInState.updatedAt = Date.now()` syncs with database updates

**Use Case**:
Find recently modified images without remembering when you edited them. Perfect for:
- Finding images you just tagged incorrectly
- Locating images you recently changed the rating on
- Tracking metadata corrections you made

### LocalStorage Persistence

User preferences saved across sessions:
- `sortBy`: e.g., 'savedAt-desc', 'updatedAt-desc', 'fileSize-asc'
- `previewPaneVisible`: 'true' | 'false'
- **Pattern**: Save immediately on change, load on init

### Local File Import & Metadata Management

**Location**: Header toolbar "Upload" button (`#import-local-files-btn`)

**Import Flow**:
1. User clicks "Upload" button in header (between image count and "Select All")
2. Native file picker opens (multiple selection, image files only)
3. `importLocalFiles(files: File[])` processes each file:
   - Reads file as blob
   - Extracts dimensions using `createImageBitmap()`
   - Sets `pageTitle` from filename (without extension)
   - Sets `pageUrl` and `imageUrl` to `file:///filename`
   - Applies auto-tagging rules based on filename
   - Saves to IndexedDB
4. Reloads image grid (no alert, silent import)

**Metadata Editing - Storage Layer**:
- `updateImagePageTitle(id, pageTitle?)`: Updates single image title
- `updateImagePageUrl(id, pageUrl)`: Updates single image URL

**Metadata Editing - Preview Sidebar** (right panel for quick editing):
- **Always editable**: Inputs always visible and editable
- **Auto-save on blur**: Changes saved when input loses focus (click away or tab)
- **Tag input**: Space-separated tags with autocomplete, auto-save on blur or Enter
- **No save buttons**: Completely silent updates
- **Pattern**: Blur event listeners call update functions, update local state, re-render grid
- **Use case**: Quick metadata edits while browsing images

**Metadata Editing - Lightbox** (fullscreen modal for viewing):
- **Compact action buttons**: Source, Raw, Save, Edit (all .btn-sm size)
- **Read-only by default**: Page title and URL shown as text
- **Edit mode**: Click "Edit" button to enable editing
  - Fields become inputs
  - Button changes to "Save Metadata" (primary style)
- **Save and revert**: Click "Save Metadata" to apply changes
  - Updates DB and local state
  - Re-renders lightbox back to read-only view
  - Button changes back to "Edit" (secondary style)
- **Tag input**: Auto-save on Enter key (no save button)
- **Rating**: Single-char format (G/S/Q/E/-)
- **Use case**: Clean viewing experience, edit only when needed

**Key Design Decisions**:
- Preview sidebar optimized for quick editing (always editable)
- Lightbox optimized for viewing/gallerying (read-only by default)
- No alerts on metadata saves (silent updates)
- Page URL cannot be empty (validation on blur/save)

### Danbooru Upload Integration

**Settings** (stored in chrome.storage.local):
- `danbooruUrl`: Self-hosted Danbooru instance URL
- `danbooruUsername`: Username for authentication
- `danbooruApiKey`: API key for authentication

**Upload Flow** (8 steps):
1. User clicks "Upload to Danbooru" button in preview pane (single selection only)
2. Modal opens with auto-filled metadata from image data
3. User reviews/edits tags, artist, copyright, character, rating, source
4. POST `/uploads.json` with image URL (Danbooru downloads the image)
5. Poll `/uploads/{id}.json` every 2s (max 40s) until status = "completed"
6. POST `/posts.json` with `upload_media_asset_id` + tags/rating/source (JSON format)
7. PUT `/posts/{id}/artist_commentary/create_or_update.json` for title/description
8. Show success toast

**Key Implementation Details**:
- **URL-based uploads**: Send image.imageUrl, not blob (Danbooru downloads from source)
- **Two-step post creation**: Upload creates media asset, then create post from asset ID
- **JSON format**: POST requests use `Content-Type: application/json`, not FormData
- **Artist extraction**: Auto-detect from URL patterns (Pixiv, Twitter, Fanbox, DeviantArt)
- **Radio buttons**: Rating uses styled radio buttons instead of dropdown for better UX
- **Separate commentary**: Artist commentary is created via separate API call (optional)
- **Error handling**: Empty/non-JSON responses handled gracefully, won't break upload

**API Endpoints**:
- `POST /uploads.json` - Create upload from URL (`upload[source]`, `upload[referer_url]`)
- `GET /uploads/{id}.json` - Poll upload status (`upload_media_assets[0].id`)
- `POST /posts.json` - Create post (`upload_media_asset_id`, `tag_string`, `rating`, `source`)
- `PUT /posts/{id}/artist_commentary/create_or_update.json` - Add commentary (`original_title`, `original_description`)

### SQLite Database Import/Export

**Location**: `src/storage/sqlite-import-export.ts`

**Purpose**: Provides SQLite-based database backup/restore functionality with conflict resolution.

**Schema** (matches IndexedDB structure):
```sql
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  imageUrl TEXT NOT NULL,
  pageUrl TEXT NOT NULL,
  pageTitle TEXT,
  mimeType TEXT NOT NULL,
  fileSize INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  savedAt INTEGER NOT NULL,
  updatedAt INTEGER,
  tags TEXT,
  isDeleted INTEGER DEFAULT 0,
  rating TEXT,
  blob BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_savedAt ON images(savedAt);
CREATE INDEX IF NOT EXISTS idx_updatedAt ON images(updatedAt);
CREATE INDEX IF NOT EXISTS idx_pageUrl ON images(pageUrl);
CREATE INDEX IF NOT EXISTS idx_rating ON images(rating);
```

**Export Flow**:
- `exportDatabase(imagesMetadata: Omit<SavedImage, 'blob'>[], onProgress?): Promise<Blob[]>`
- **Folder-based export**: Uses File System Access API to write directly to user-selected folder
- **Multi-file export**: Splits into multiple SQLite files (200 images per file) to avoid memory allocation errors
- **Batched blob loading**: Loads 50 blobs at a time from IndexedDB
- Creates SQLite database with schema for each file
- Inserts images with blobs as Uint8Array
- Tags serialized as JSON string
- Returns array of SQLite file blobs
- **Memory efficient**: Never holds all blobs or full database in memory (critical for large datasets)

**Backup Structure**:
```
image-storage-backup-2025-11-15-123456789/
├── manifest.json                      (metadata: date, count, version)
├── database.db                        (single file if <200 images)
└── database-part1of11.db, part2of11.db, ... (multiple files if >200 images)
```

**User Flow**:
1. Click "Export Database" button
2. Browser shows folder picker dialog
3. User selects destination folder
4. **Progress modal appears**: Shows visual progress bar with status updates
   - "Preparing export..." (initial)
   - "Exporting images... X / Y images" (with percentage bar)
   - "Writing database-partN.db..." (file writing)
   - "Writing manifest..." (final step)
5. Extension creates timestamped backup folder automatically
6. Writes all database files + manifest to backup folder
7. Progress modal closes, success alert shows
8. Each file is independently importable

**UI Components**:
- Export progress modal (`#export-progress-modal`): Real-time progress indicator
  - Progress bar with green gradient animation
  - Status text showing current operation
  - Detail text showing file/image counts
  - Auto-closes on completion or error

**Import Flow** (3 strategies with multi-file support):

**Multi-File Selection**:
- Import dialog supports `multiple` file selection
- Select all backup parts at once (Ctrl/Cmd + Click or Shift + Click in file picker)
- All files analyzed together: aggregates totals and conflicts
- Import processed sequentially across all files
- Single confirmation/resolution applies to entire set

1. **Analyze Phase**:
   - `analyzeImport(file: File, existingImages: SavedImage[]): Promise<ImportAnalysis>`
   - Reads SQLite file without loading blobs (metadata only)
   - Compares IDs with existing images
   - Returns analysis: `{ totalCount, newCount, conflictCount, conflicts[], db }`
   - **Multi-file**: Analyzes each file separately, aggregates results
   - **Important**: Keeps database open for blob fetching during review

2. **Conflict Resolution**:
   - **Skip mode**: Import only new images (skip conflicts)
   - **Override mode**: Replace all existing images with imported versions
   - **Review mode**: User reviews each conflict individually
     - Shows side-by-side comparison (existing vs imported)
     - User selects which images to keep/override
     - Uses `specificIds` Set to filter imports

3. **Import Phase**:
   - `importDatabase(file: File, mode: 'skip' | 'override', specificIds?: Set<string>): Promise<SavedImage[]>`
   - Loads full images (including blobs) from SQLite
   - Applies conflict resolution strategy
   - Returns SavedImage[] ready for IndexedDB insertion

**Helper Functions**:
- `getImageBlobFromDatabase(db: Database, imageId: string): Blob | null`
  - Fetches single blob from open database for preview
  - Used in conflict review modal
- `getImageMetadataFromDatabase(db: Database, imageId: string): {...} | null`
  - Fetches metadata without blob for conflict comparison
- `closeImportDatabase(db: Database)`
  - Closes database after review/import complete
  - **Critical**: Must be called to free resources

**Implementation Notes**:
- Uses sql.js library (`initSqlJs`) with WASM backend
- WASM file path: `/sql-wasm.wasm` (must be in public assets)
- Tags stored as JSON string in SQLite, parsed on import
- `isDeleted` stored as INTEGER (0 or 1), converted to boolean
- Database kept open during conflict review to avoid re-reading file
- Caller responsible for closing database with `closeImportDatabase()`

**UI Integration**:
- "Export Database" button creates SQLite backup
- "Import" button opens file picker for SQLite files
- Import modal shows three resolution options
- Review modal displays conflicts in scrollable grid
- Side-by-side previews with metadata comparison
- Selection state tracked with Set<string> of chosen import IDs

## Development Philosophy

See ROADMAP.md - build features when needed, not all at once. Working code first, refinement later.

## Code Maintenance Philosophy

**Current state**: AI-maintained vanilla JS codebase (~1200 lines in `viewer/index.ts`)

**Refactor trigger**: When human developer wants to write code themselves, not before.

AI-maintained vs human-maintained code have different ergonomics:
- ✅ **For Claude Code**: 1200-line files are navigable, modifications are manageable
- ❌ **For humans**: Large files are hard to mentally parse and contribute to

**When to refactor**:
- ❌ "The code feels complex" → Not a reason
- ❌ "I should use a UI library" → Not a reason yet
- ✅ "I want to write features myself" → Time to refactor for human ergonomics
- ✅ "Adding features takes 3x longer than it should" → Real pain point
- ✅ "State bugs keep appearing" → Real architectural issue

**Future refactor targets** (when needed):
- Split into smaller files (~200-300 lines): `viewer/render.ts`, `viewer/state.ts`, `viewer/events.ts`, `viewer/lightbox.ts`
- Consider UI library (Preact/lit-html) if state management becomes pain point
- Clear responsibility boundaries between modules
