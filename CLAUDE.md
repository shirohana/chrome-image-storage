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
     - Group by domain
     - Multi-select with checkboxes
     - Bulk operations: delete selected, export selected
     - Lightbox for full-size viewing
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
7. **Selection State**: Use `Set<string>` to track selected image IDs, persists across re-renders
8. **Export Filenames**: Use image IDs instead of sequential numbers for easier metadata matching
9. **Anti-Hotlinking Bypass**: Two-tier approach:
   - Try canvas capture from DOM first (fast, no network request, works for same-origin)
   - Fall back to `declarativeNetRequest` API to inject Referer header (bypasses 403 errors from sites like Pixiv)
   - Canvas `toBlob()` fails on tainted (cross-origin) images, unlike what docs suggest

## Development Philosophy

See ROADMAP.md - build features when needed, not all at once. Working code first, refinement later.
