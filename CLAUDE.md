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
     - Sort by date, size, dimensions, or URL
     - Group by domain or show duplicates
     - Multi-select with checkboxes
     - Bulk operations: delete selected, export selected
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

## Development Philosophy

See ROADMAP.md - build features when needed, not all at once. Working code first, refinement later.
