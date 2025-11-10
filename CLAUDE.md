# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Early prototype with core features completed. All planned "Quick Wins" and "Useful Features" from roadmap are implemented. Keep it simple and make it work first.

## Build Commands

- `pnpm build` - Build extension to `dist/`
- `pnpm dev` - Dev mode with hot reload

Load `dist/` as unpacked extension in Chrome.

## Architecture

### Three-Context System

Chrome extensions run in three separate JavaScript contexts:

1. **Background Service Worker** (`src/background/`)
   - Handles context menu, saves images, sends notifications
   - **Critical**: No DOM access - use `createImageBitmap()` not `new Image()`
   - Uses `declarativeNetRequest` API to set Referer headers for anti-hotlinking bypass

2. **Viewer Page** (`src/viewer/`)
   - Full-page UI with multiple features:
     - View modes: grid/compact/list
     - Search by URL or page title
     - Filter by image type (PNG, JPEG, WebP, etc.)
     - Multi-tag filter with AND/OR modes
     - Sort by date, size, dimensions, or URL
     - Group by domain or show duplicates
     - Multi-select with checkboxes
     - Bulk operations: delete selected, export selected, tag selected
     - Tag management per image or in bulk
     - Lightbox for full-size viewing
     - Duplicate detection by dimensions + file size
   - Listens for `IMAGE_SAVED` messages to auto-refresh

3. **Content Script** (`src/content/`)
   - Captures images from DOM via canvas (avoids network request)
   - Finds images by URL matching (exact, normalized, without query params)
   - Falls back to background worker if canvas capture fails

### Storage

- **`storage/db.ts`**: IndexedDB wrapper (store: `images`, keyPath: `id`)
- **`storage/service.ts`**: High-level operations like `saveImage()`, `deleteImage()`
- Images stored as Blobs, displayed via `URL.createObjectURL(blob)`

### Communication

- Background → Viewer: `chrome.runtime.sendMessage({ type: 'IMAGE_SAVED' }).catch(() => {})`
- Always wrap in `.catch()` since viewer may not be open

## Key Learnings

1. **CSS Specificity**: Use `grid.style.display = ''` to clear inline styles, let CSS classes control display. Avoid `!important`.
2. **Service Worker APIs**: Use `createImageBitmap()` for dimensions, not `new Image()`
3. **Icon Paths**: Full paths like `src/icons/icon-48.png` in notifications
4. **View Modes**: CSS classes `.image-grid`, `.image-grid.compact`, `.image-grid.list`
5. **Event Listeners**: Extract `attachEventListeners()` function for code reuse between grouped and ungrouped rendering
6. **Grouping**: Use `Map<string, SavedImage[]>` for domain grouping, render sections with headers
   - Duplicate detection: Groups images by `${width}×${height}-${fileSize}`, shows only groups with 2+ images
   - Simple matching (no hash computation) for performance
7. **Selection State**: Use `Set<string>` to track selected image IDs, persists across re-renders
8. **Export Filenames**: Use image IDs instead of sequential numbers for easier metadata matching
9. **Anti-Hotlinking Bypass**: Two-tier approach:
   - Try canvas capture from DOM first (fast, no network request, works for same-origin)
   - Fall back to `declarativeNetRequest` API to inject Referer header (bypasses 403 errors from sites like Pixiv)
   - Canvas `toBlob()` fails on tainted (cross-origin) images, unlike what docs suggest

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
- Tag editor in preview pane (single selection)
- Inline tag input with autocomplete from existing tags
- `updateImageTags(id, tags)`: Updates tags for single image
- Tags rendered as pills with remove buttons

**Bulk Tag Operations**:
- "Tag Selected" button opens modal for multi-image operations
- **Add Tags Section**: Adds tags to all selected images (duplicates prevented)
- **Remove Tags Section**: Removes tags from all selected images
- Both sections feature autocomplete from existing tags
- `addTagsToImages(imageIds, tagsToAdd)`: Bulk add operation
- `removeTagsFromImages(imageIds, tagsToRemove)`: Bulk remove operation

**Tag Filtering**:
- Multi-tag dropdown with autocomplete
- Selected tags shown as removable pills below dropdown
- **Union Mode (OR)**: Shows images with ANY selected tag
- **Intersection Mode (AND)**: Shows images with ALL selected tags
- Toggle button switches between modes
- **Exclude Tags**: Separate dropdown to filter out specific tags
  - Shows only tags from currently visible images (updates dynamically)
  - Hides already-selected include tags (prevents impossible combinations)
  - Always uses AND logic: filters out images with ANY excluded tag
  - Example: Include "Animal", Exclude "Dog" → shows all animals except dogs
- **Untagged Only**: Checkbox to show only images without tags
- `state.tagFilters`: Set<string> of active include tag filters
- `state.excludedTagFilters`: Set<string> of active exclude tag filters
- `state.tagFilterMode`: 'union' | 'intersection'
- `state.showUntaggedOnly`: boolean for untagged filter
- `populateTagFilter()`: Rebuilds dropdown from all existing tags
- `updateExcludeTagFilterOptions(images)`: Updates exclude dropdown from filtered results
- Filters update dynamically after tag modifications
- **Mutual Exclusivity**: Untagged filter and tag selection auto-clear each other to prevent conflicts

### Preview Pane

- Right-side collapsible pane showing selected image details
- **Single Selection**: Full preview image + metadata panel
- **Multi-Selection**: Thumbnail grid with count
- **State**: `previewPaneVisible` persisted in localStorage
- **Updates**: Synced on selection change via `updatePreviewPane()`

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

### ObjectURL Lifecycle Management

**Critical for memory management**:
- `getOrCreateObjectURL(image)`: Creates blob URL once, caches in `state.objectUrls` Map
- `revokeObjectURLs()`: Revokes all URLs and clears cache
- **Pattern**: Always call `revokeObjectURLs()` before re-rendering to prevent memory leaks
- Used in `renderImages()` when switching between empty/populated states

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

### LocalStorage Persistence

User preferences saved across sessions:
- `viewMode`: 'grid' | 'compact' | 'list'
- `sortBy`: e.g., 'savedAt-desc', 'fileSize-asc'
- `previewPaneVisible`: 'true' | 'false'
- **Pattern**: Save immediately on change, load on init

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
  tags TEXT,
  isDeleted INTEGER DEFAULT 0,
  blob BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_savedAt ON images(savedAt);
CREATE INDEX IF NOT EXISTS idx_pageUrl ON images(pageUrl);
```

**Export Flow**:
- `exportDatabase(images: SavedImage[]): Promise<Blob>`
- Creates SQLite database with schema
- Inserts all images with blobs as Uint8Array
- Tags serialized as JSON string
- Returns SQLite file as blob

**Import Flow** (3 strategies):

1. **Analyze Phase**:
   - `analyzeImport(file: File, existingImages: SavedImage[]): Promise<ImportAnalysis>`
   - Reads SQLite file without loading blobs (metadata only)
   - Compares IDs with existing images
   - Returns analysis: `{ totalCount, newCount, conflictCount, conflicts[], db }`
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
