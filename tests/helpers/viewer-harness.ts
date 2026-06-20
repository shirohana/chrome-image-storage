// Characterization-test harness for the existing viewer view (Route A safety net).
//
// IMPORTANT: this helper is imported by tests that declare `// @vitest-environment happy-dom`
// on their first line. It does NOT set the environment itself (Vitest reads that pragma
// per test file). Calling any function here under the default `node` env will fail because
// there is no `document`.
//
// What it does:
//   1. Loads the real `src/viewer/index.html` <body> as the DOM fixture.
//   2. Stubs the minimum `chrome` + browser globals `init()` touches.
//   3. Mocks the data layer (`src/storage/service`) so nothing hits IndexedDB.
//   4. Boots the viewer via the exported `init()`.
//   5. Exposes seed/render/teardown helpers built on the shared `state` singleton.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';
import type { ImageMetadata } from '../../src/types';

// --- Data layer mock -------------------------------------------------------
// `init()` calls `loadImages()` -> `getAllImagesMetadata()`. Return [] so the
// boot path renders the empty state and never reaches IndexedDB. Every named
// export that index.ts imports must exist or the ES import would throw.
vi.mock('../../src/storage/service', () => ({
  getAllImagesMetadata: vi.fn(async () => [] as ImageMetadata[]),
  getAllImages: vi.fn(async () => []),
  getImageBlob: vi.fn(async () => undefined),
  getImage: vi.fn(async () => undefined),
  deleteImage: vi.fn(async () => undefined),
  deleteAllImages: vi.fn(async () => undefined),
  restoreImage: vi.fn(async () => undefined),
  permanentlyDeleteImage: vi.fn(async () => undefined),
  emptyTrash: vi.fn(async () => undefined),
  updateImageTags: vi.fn(async () => undefined),
  addTagsToImages: vi.fn(async () => undefined),
  removeTagsFromImages: vi.fn(async () => undefined),
  // Dynamically-imported members (referenced via `await import('../storage/service')`).
  updateImageRating: vi.fn(async () => undefined),
  updateImagesRating: vi.fn(async () => undefined),
  updateImagePageTitle: vi.fn(async () => undefined),
  updateImagePageUrl: vi.fn(async () => undefined),
}));

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(__dirname, '../../src/viewer/index.html');

/** Extract the inner HTML of <body> from the real viewer page (drop the <script>). */
function loadViewerBody(): string {
  const html = readFileSync(INDEX_HTML, 'utf-8');
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!match) throw new Error('Could not find <body> in src/viewer/index.html');
  // Strip the module <script> so happy-dom does not try to evaluate it.
  return match[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

/** Minimal chrome global: index.ts reads/writes chrome.storage.local and sends messages. */
function stubChrome(): void {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve()),
      onMessage: { addListener: vi.fn() },
    },
  });
}

/** Stub only browser globals that happy-dom may not provide. */
function stubBrowserGlobals(): void {
  if (typeof globalThis.IntersectionObserver === 'undefined') {
    class FakeIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  }
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  }
  if (typeof URL.createObjectURL === 'undefined') {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} }));
  }
}

let bootedMod: typeof import('../../src/viewer/index') | null = null;

/**
 * Boot the viewer ONCE per test file: install globals, then `init()` against the
 * real index.html fixture. Idempotent — calling it again (e.g. in every
 * `beforeEach`) returns the already-booted module without re-initialising.
 *
 * Two things matter for clean tests:
 *  - We import index.ts BEFORE installing the DOM fixture, so the module's guarded
 *    auto-init (it checks for `#image-grid`) does NOT fire — we call `init()` exactly
 *    once ourselves. Otherwise init runs twice and every handler is double-wired.
 *  - Booting once (not per test) keeps a single set of document-level listeners
 *    (keyboard nav, click-outside). Re-init would accumulate them and a single
 *    keydown would fire N times. Reset state between tests with `resetState()`.
 */
export async function bootViewer() {
  if (bootedMod) return bootedMod;
  stubChrome();
  stubBrowserGlobals();

  const mod = await import('../../src/viewer/index');
  document.body.innerHTML = loadViewerBody();
  mod.init();
  // init()'s trailing IIFE awaits loadImages(); let it settle before tests run.
  await new Promise(r => setTimeout(r, 0));
  bootedMod = mod;
  return mod;
}

function makeImage(p: Partial<ImageMetadata>): ImageMetadata {
  return {
    id: p.id ?? 'id1',
    imageUrl: p.imageUrl ?? 'https://example.com/a.png',
    pageUrl: p.pageUrl ?? 'https://example.com/page',
    pageTitle: p.pageTitle,
    mimeType: p.mimeType ?? 'image/png',
    fileSize: p.fileSize ?? 2048,
    width: p.width ?? 100,
    height: p.height ?? 200,
    savedAt: p.savedAt ?? 0,
    updatedAt: p.updatedAt,
    tags: p.tags,
    isDeleted: p.isDeleted,
    rating: p.rating,
  };
}

/**
 * Seed `state.images` / `state.filteredImages` with the given (partial) images
 * and render them into `#image-grid`. Returns the full ImageMetadata list.
 * Bypasses filter/sort so callers control the exact rendered order.
 */
export async function seedImages(partials: Partial<ImageMetadata>[]): Promise<ImageMetadata[]> {
  const { state } = await import('../../src/viewer/state');
  const { renderImages } = await import('../../src/viewer/render');
  const images = partials.map(makeImage);
  state.images = images;
  state.filteredImages = images;
  await renderImages(images);
  return images;
}

/** Query a rendered card element by image id. */
export function card(id: string): HTMLElement | null {
  return document.querySelector(`.image-card[data-id="${id}"]`);
}

/** Query a rendered card's checkbox by image id. */
export function checkbox(id: string): HTMLInputElement | null {
  return document.querySelector(`.image-card[data-id="${id}"] .image-checkbox`);
}

/** Reset the shared state singleton between tests (object reference stays stable).
 *  Because the harness boots once and never wipes the body, DOM chrome that handlers
 *  mutated (selection-count visibility, button disabled states) must be restored to
 *  the no-selection baseline. We drive that through the viewer's OWN deselect-all
 *  handler rather than re-implementing the DOM updates here (ONE TRUTH). */
export async function resetState(): Promise<void> {
  const { state } = await import('../../src/viewer/state');
  document.getElementById('deselect-all-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  state.images = [];
  state.filteredImages = [];
  state.selectedIds.clear();
  state.loadedBlobs.clear();
  state.objectUrls.clear();
  state.sort = 'savedAt-desc';
  state.groupBy = 'none';
  state.currentView = 'all';
  state.lightboxActive = false;
  state.currentLightboxIndex = -1;
  state.previewPaneVisible = false;
  state.lastSelectedIndex = -1;
  state.selectionAnchor = -1;
  state.currentRenderToken = 0;
  // Clear rendered cards but keep the #image-grid element so its delegated
  // listeners (bound once in init()) stay valid for the next test.
  const grid = document.getElementById('image-grid');
  if (grid) grid.innerHTML = '';
  // Restore the closed/hidden UI baseline. The body is never wiped (that would
  // orphan listeners), so the lightbox/preview "open" classes would otherwise leak
  // across tests. ONE place so each test file doesn't re-reset this itself.
  document.getElementById('lightbox')?.classList.remove('active');
  document.getElementById('preview-pane')?.classList.remove('visible');
  document.body.classList.remove('preview-pane-open');
}

/** Reset state + clear the grid between tests. Call from afterEach (never wipes
 *  the body — that would orphan the single set of wired-up listeners). */
export async function teardownViewer(): Promise<void> {
  await resetState();
}

export { makeImage };
