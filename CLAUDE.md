# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Early prototype (~2 hours of coding). Still under active development. Keep it simple and make it work first.

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

2. **Viewer Page** (`src/viewer/`)
   - Full-page UI with grid/compact/list views, search, sorting, lightbox
   - Listens for `IMAGE_SAVED` messages to auto-refresh

3. **Content Script** (`src/content/`)
   - Currently minimal

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

## Development Philosophy

See ROADMAP.md - build features when needed, not all at once. Working code first, refinement later.
