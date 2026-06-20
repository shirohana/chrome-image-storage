// @vitest-environment happy-dom
//
// Characterization tests for the EXISTING viewer LIGHTBOX behavior (Route A safety
// net, pre-SolidJS migration). These lock what the real `init()` + openLightbox /
// closeLightbox / updateLightboxMetadata / the edit-toggle do TODAY. They assert
// actual behavior; anything surprising is DOCUMENTED in a comment, not "fixed".
// No `src/` changes.
//
// NOTE: prev/next/up/down lightbox NAVIGATION is already covered in navigation.test.ts
// (Space-to-open, Escape/Space-to-close, bounded arrow nav). This file focuses on the
// open trigger(s), the metadata population, the edit-mode toggle, and the close paths
// (close button / overlay click / empty content click) NOT exercised there.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { bootViewer, resetState, seedImages, card } from './helpers/viewer-harness';
import { state } from '../src/viewer/state';

/** Dispatch a real bubbling click so delegated/document listeners fire. */
function clickEl(el: Element, init: MouseEventInit = {}) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

const lightbox = () => document.getElementById('lightbox')!;
const isOpen = () => lightbox().classList.contains('active');
// openLightbox() -> updateLightboxContent() is async (it `await`s loadImageBlob BEFORE it
// calls updateLightboxMetadata), so the metadata panel is populated a microtask AFTER the
// click. Flush before asserting on rendered metadata.
const flush = () => new Promise(r => setTimeout(r, 0));

/** The lightbox metadata panel text/markup the handler rewrites on open. */
const metaEl = () => document.querySelector('.lightbox-metadata') as HTMLElement;

// Boot the real viewer ONCE (shared harness). Reset state per test. The harness never
// wipes the body, so the lightbox can leave the `.active` class behind — drive the real
// close handler (ESC) at the start of each test to restore the closed baseline (ONE TRUTH).
beforeAll(async () => {
  await bootViewer();
});

beforeEach(async () => {
  // resetState() also restores the closed lightbox + hidden preview DOM baseline.
  await resetState();
});

const SIX = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }];

describe('opening the lightbox', () => {
  it('clicking a card image (.image-preview) opens the lightbox at that visual index', async () => {
    // The grid delegated click handler routes `.image-preview` clicks to handleImageClick,
    // which finds the visual-order index and calls openLightbox(index). This is the
    // pointer path (Space-with-one-selected is the keyboard path, covered in navigation.test.ts).
    await seedImages(SIX);
    const img = card('c')!.querySelector('.image-preview')!;
    clickEl(img);
    expect(state.lightboxActive).toBe(true);
    expect(state.currentLightboxIndex).toBe(2); // 'c' is visual index 2
    expect(isOpen()).toBe(true);
  });

  it('opening sets state.lightboxActive + currentLightboxIndex and adds .active', async () => {
    await seedImages(SIX);
    clickEl(card('a')!.querySelector('.image-preview')!);
    expect(state.lightboxActive).toBe(true);
    expect(state.currentLightboxIndex).toBe(0);
    expect(isOpen()).toBe(true);
  });

  it('Space with exactly one selected card also opens the lightbox (keyboard trigger)', async () => {
    await seedImages(SIX);
    clickEl(card('b')!); // single-select via card click
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(state.lightboxActive).toBe(true);
    expect(state.currentLightboxIndex).toBe(1);
    expect(isOpen()).toBe(true);
  });
});

describe('lightbox metadata population (updateLightboxMetadata)', () => {
  it('renders dimensions / type / tags / rating text from the seeded image', async () => {
    await seedImages([
      {
        id: 'a',
        width: 640,
        height: 480,
        mimeType: 'image/png',
        tags: ['cat', 'girl'],
        rating: 'q',
        pageTitle: 'My Page',
        pageUrl: 'https://example.com/post',
      },
    ]);
    clickEl(card('a')!.querySelector('.image-preview')!);
    await flush();

    const html = metaEl().innerHTML;
    expect(html).toContain('640 × 480');
    expect(html).toContain('image/png');
    // Tags are sorted (case-insensitive) and rendered as metadata-tags__tag spans.
    const tagTexts = [...metaEl().querySelectorAll('.metadata-tags__tag')].map(t => t.textContent);
    expect(tagTexts).toEqual(['cat', 'girl']);
    // rating 'q' -> "Questionable" with badge "Q".
    expect(metaEl().querySelector('.rating-text')!.textContent).toBe('Questionable');
    expect(metaEl().querySelector('.metadata-rating-badge')!.textContent).toBe('Q');
  });

  it('shows the page title/url values and the "(not set)"/No tags fallbacks', async () => {
    await seedImages([{ id: 'a', pageUrl: 'https://example.com/p', tags: undefined, pageTitle: undefined }]);
    clickEl(card('a')!.querySelector('.image-preview')!);
    await flush();

    const html = metaEl().innerHTML;
    expect(html).toContain('https://example.com/p');
    // Missing pageTitle renders the literal "(not set)" placeholder.
    expect(html).toContain('(not set)');
    // No tags -> the "No tags" placeholder span (not an empty tag list).
    expect(metaEl().querySelector('.no-tags')!.textContent).toBe('No tags');
    // Unrated -> rating text "Unrated", badge "—".
    expect(metaEl().querySelector('.rating-text')!.textContent).toBe('Unrated');
  });

  it('pre-fills the lightbox tag <textarea> with the sorted, space-joined tags', async () => {
    await seedImages([{ id: 'a', tags: ['girl', 'cat'] }]);
    clickEl(card('a')!.querySelector('.image-preview')!);
    await flush();
    const ta = document.getElementById('lightbox-tag-input') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe('cat girl'); // sorted on render
  });
});

describe('lightbox edit-mode toggle (read-only by default)', () => {
  it('starts read-only: page title/url render as static spans, Edit button labelled "Edit"', async () => {
    await seedImages([{ id: 'a', pageTitle: 'T', pageUrl: 'https://example.com/p' }]);
    clickEl(card('a')!.querySelector('.image-preview')!);
    await flush();

    const editBtn = metaEl().querySelector('.lightbox-edit-metadata-btn') as HTMLButtonElement;
    expect(editBtn.textContent).toBe('Edit');
    // No inputs for page title/url yet — they are read-only spans.
    expect(document.getElementById('lightbox-page-title-input-a')).toBeNull();
    expect(document.getElementById('lightbox-page-url-input-a')).toBeNull();
  });

  it('clicking "Edit" swaps the title/url rows into inputs and relabels the button "Save Metadata"', async () => {
    await seedImages([{ id: 'a', pageTitle: 'T', pageUrl: 'https://example.com/p' }]);
    clickEl(card('a')!.querySelector('.image-preview')!);
    await flush();

    const editBtn = metaEl().querySelector('.lightbox-edit-metadata-btn') as HTMLButtonElement;
    clickEl(editBtn);

    // Now editable: inputs exist, pre-filled with the current values.
    const titleInput = document.getElementById('lightbox-page-title-input-a') as HTMLInputElement;
    const urlInput = document.getElementById('lightbox-page-url-input-a') as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    expect(urlInput).toBeTruthy();
    expect(titleInput.value).toBe('T');
    expect(urlInput.value).toBe('https://example.com/p');
    // Button relabels and flips to the primary variant.
    expect(editBtn.textContent).toBe('Save Metadata');
    expect(editBtn.classList.contains('button--primary')).toBe(true);
  });

  it('clicking "Save Metadata" persists edits via the service and re-renders read-only', async () => {
    const service = await import('../src/storage/service');
    await seedImages([{ id: 'a', pageTitle: 'Old', pageUrl: 'https://example.com/old' }]);
    clickEl(card('a')!.querySelector('.image-preview')!);
    await flush();

    const editBtn = metaEl().querySelector('.lightbox-edit-metadata-btn') as HTMLButtonElement;
    clickEl(editBtn); // -> edit mode

    const titleInput = document.getElementById('lightbox-page-title-input-a') as HTMLInputElement;
    const urlInput = document.getElementById('lightbox-page-url-input-a') as HTMLInputElement;
    titleInput.value = 'New Title';
    urlInput.value = 'https://example.com/new';

    clickEl(editBtn); // -> save
    // Let the async save + re-render settle.
    await new Promise(r => setTimeout(r, 0));

    expect(service.updateImagePageTitle).toHaveBeenCalledWith('a', 'New Title');
    expect(service.updateImagePageUrl).toHaveBeenCalledWith('a', 'https://example.com/new');
    // After save, updateLightboxMetadata re-renders -> back to a read-only "Edit" button.
    const editBtnAfter = metaEl().querySelector('.lightbox-edit-metadata-btn') as HTMLButtonElement;
    expect(editBtnAfter.textContent).toBe('Edit');
  });
});

describe('closing the lightbox', () => {
  async function open() {
    await seedImages(SIX);
    clickEl(card('b')!.querySelector('.image-preview')!);
    expect(state.lightboxActive).toBe(true);
  }

  it('Escape closes it and clears state (currentLightboxIndex -> -1)', async () => {
    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(state.lightboxActive).toBe(false);
    expect(state.currentLightboxIndex).toBe(-1);
    expect(isOpen()).toBe(false);
  });

  it('the close button (.lightbox-close) closes it', async () => {
    await open();
    clickEl(document.querySelector('.lightbox-close')!);
    expect(state.lightboxActive).toBe(false);
    expect(isOpen()).toBe(false);
  });

  it('clicking the overlay (.lightbox-overlay) closes it', async () => {
    await open();
    clickEl(document.querySelector('.lightbox-overlay')!);
    expect(state.lightboxActive).toBe(false);
    expect(isOpen()).toBe(false);
  });

  it('clicking empty .lightbox-content space (target === content) closes it', async () => {
    await open();
    const content = document.querySelector('.lightbox-content')!;
    // The handler only closes when e.target IS the content element itself.
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(state.lightboxActive).toBe(false);
    expect(isOpen()).toBe(false);
  });
});
