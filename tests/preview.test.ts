// @vitest-environment happy-dom
//
// Characterization tests for the EXISTING viewer PREVIEW-PANE behavior (Route A safety
// net, pre-SolidJS migration). These lock what the real `init()` + togglePreviewPane /
// updatePreviewPane / renderSinglePreview / renderMultiPreview / populatePreviewQuickRemoveTags
// do TODAY. They assert actual behavior; surprises are DOCUMENTED, not "fixed".
// No `src/` changes. The data layer (src/storage/service) is mocked by the harness, so
// auto-save handlers are asserted via the vi.fn() mocks imported here.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { bootViewer, resetState, seedImages, checkbox } from './helpers/viewer-harness';
import { state } from '../src/viewer/state';

function clickEl(el: Element, init: MouseEventInit = {}) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}
function changeEl(el: Element) {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const pane = () => document.getElementById('preview-pane')!;
const paneContent = () => document.getElementById('preview-pane-content')!;
const toggleBtn = () => document.getElementById('preview-pane-toggle')!;

/** Select a single card via its checkbox (drives the delegated change handler ->
 *  updateSelectionCount + updatePreviewPane). updatePreviewPane is async, so callers
 *  should await a microtask flush after selecting. */
function selectViaCheckbox(id: string) {
  const cb = checkbox(id)!;
  cb.checked = true;
  changeEl(cb);
}
const flush = () => new Promise(r => setTimeout(r, 0));

/** Select several cards, flushing after EACH so the async updatePreviewPane() for that
 *  selection settles before the next change fires. Without this, two concurrent
 *  updatePreviewPane() calls race and the single-preview render (resolving last) can
 *  overwrite the multi-preview render — a real ordering quirk of the async pane updates. */
async function selectAll(ids: string[]) {
  for (const id of ids) {
    selectViaCheckbox(id);
    await flush();
  }
}

// Boot once; reset per test. resetState() drives the real deselect-all handler, zeroes
// state.previewPaneVisible, and restores the hidden preview baseline (.visible / body
// preview-pane-open classes), so each test starts with the pane hidden.
beforeAll(async () => {
  await bootViewer();
});

beforeEach(async () => {
  await resetState();
});

const THREE = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('toggling the preview pane (#preview-pane-toggle)', () => {
  it('clicking the toggle shows the pane and sets state.previewPaneVisible = true', async () => {
    await seedImages(THREE);
    expect(state.previewPaneVisible).toBe(false);
    clickEl(toggleBtn());
    expect(state.previewPaneVisible).toBe(true);
    expect(pane().classList.contains('visible')).toBe(true);
    // Body gets a class so the layout reflows for the open pane.
    expect(document.body.classList.contains('preview-pane-open')).toBe(true);
  });

  it('clicking the toggle again hides the pane and clears the flag/classes', async () => {
    await seedImages(THREE);
    clickEl(toggleBtn()); // show
    clickEl(toggleBtn()); // hide
    expect(state.previewPaneVisible).toBe(false);
    expect(pane().classList.contains('visible')).toBe(false);
    expect(document.body.classList.contains('preview-pane-open')).toBe(false);
  });

  it('the pane close button (#preview-pane-close) is wired to the same toggle', async () => {
    await seedImages(THREE);
    clickEl(toggleBtn()); // show
    expect(state.previewPaneVisible).toBe(true);
    clickEl(document.getElementById('preview-pane-close')!);
    // Same togglePreviewPane handler -> flips back to hidden.
    expect(state.previewPaneVisible).toBe(false);
    expect(pane().classList.contains('visible')).toBe(false);
  });
});

describe('preview content reflects the selection', () => {
  it('with no selection the pane shows the "No items selected" empty state', async () => {
    await seedImages(THREE);
    // No selection: updatePreviewPane renders .preview-empty.
    // (Drive updatePreviewPane indirectly: select then deselect.)
    selectViaCheckbox('a');
    await flush();
    const cb = checkbox('a')!;
    cb.checked = false;
    changeEl(cb);
    await flush();
    expect(paneContent().querySelector('.preview-empty')!.textContent).toBe('No items selected');
  });

  it('selecting exactly one image renders the single-preview with its metadata fields', async () => {
    await seedImages([
      { id: 'a', width: 800, height: 600, mimeType: 'image/jpeg', pageTitle: 'Hello', pageUrl: 'https://e.com/x', tags: ['cat'] },
      { id: 'b' },
    ]);
    selectViaCheckbox('a');
    await flush();

    expect(paneContent().querySelector('.preview-single')).toBeTruthy();
    // Dimensions + type rendered as static values.
    expect(paneContent().innerHTML).toContain('800 × 600');
    expect(paneContent().innerHTML).toContain('image/jpeg');
    // Editable inputs pre-filled from the image.
    const titleInput = document.getElementById('preview-page-title-a') as HTMLInputElement;
    const urlInput = document.getElementById('preview-page-url-a') as HTMLInputElement;
    expect(titleInput.value).toBe('Hello');
    expect(urlInput.value).toBe('https://e.com/x');
    // Tag textarea pre-filled.
    const tagInput = document.getElementById('preview-tag-input-a') as HTMLTextAreaElement;
    expect(tagInput.value).toBe('cat');
  });

  it('selecting two images renders the multi-preview with a count + thumbnails', async () => {
    await seedImages(THREE);
    await selectAll(['a', 'b']);

    expect(paneContent().querySelector('.preview-multi')).toBeTruthy();
    expect(paneContent().querySelector('.preview-multi-count')!.textContent).toBe('2 items selected');
    // One thumbnail per selected image.
    expect(paneContent().querySelectorAll('.preview-thumbnail').length).toBe(2);
  });
});

describe('single-preview editable fields auto-save on blur', () => {
  it('blurring the page-title input calls updateImagePageTitle (trimmed; empty -> undefined)', async () => {
    const service = await import('../src/storage/service');
    await seedImages([{ id: 'a', pageTitle: 'Old', pageUrl: 'https://e.com/x' }]);
    selectViaCheckbox('a');
    await flush();

    const titleInput = document.getElementById('preview-page-title-a') as HTMLInputElement;
    titleInput.value = '  New Title  ';
    titleInput.dispatchEvent(new FocusEvent('blur'));
    await flush();
    expect(service.updateImagePageTitle).toHaveBeenCalledWith('a', 'New Title');
  });

  it('blurring the page-url input with a value calls updateImagePageUrl', async () => {
    const service = await import('../src/storage/service');
    await seedImages([{ id: 'a', pageUrl: 'https://e.com/old' }]);
    selectViaCheckbox('a');
    await flush();

    const urlInput = document.getElementById('preview-page-url-a') as HTMLInputElement;
    urlInput.value = 'https://e.com/new';
    urlInput.dispatchEvent(new FocusEvent('blur'));
    await flush();
    expect(service.updateImagePageUrl).toHaveBeenCalledWith('a', 'https://e.com/new');
  });

  it('blurring the tag textarea calls updateImageTags with the de-duped tag list', async () => {
    const service = await import('../src/storage/service');
    await seedImages([{ id: 'a', tags: ['cat'] }]);
    selectViaCheckbox('a');
    await flush();

    const tagInput = document.getElementById('preview-tag-input-a') as HTMLTextAreaElement;
    tagInput.value = 'cat dog dog girl';
    tagInput.dispatchEvent(new FocusEvent('blur'));
    await flush();
    // Whitespace-split + Set dedupe -> ['cat','dog','girl'] (order preserved, no re-sort here).
    expect(service.updateImageTags).toHaveBeenCalledWith('a', ['cat', 'dog', 'girl']);
  });

  it('changing the preview rating radio calls updateImageRating with the chosen value', async () => {
    const service = await import('../src/storage/service');
    await seedImages([{ id: 'a' }]);
    selectViaCheckbox('a');
    await flush();

    const radioE = document.querySelector('input[name="preview-rating-a"][value="e"]') as HTMLInputElement;
    radioE.checked = true;
    changeEl(radioE);
    await flush();
    expect(service.updateImageRating).toHaveBeenCalledWith('a', 'e');
  });
});

describe('multi-preview quick-remove tag pills', () => {
  it('builds pills from the selected images\' most-common tags, each showing a count', async () => {
    await seedImages([
      { id: 'a', tags: ['cat', 'girl'] },
      { id: 'b', tags: ['cat'] },
    ]);
    await selectAll(['a', 'b']);

    const pills = [...document.querySelectorAll('.preview-remove-quick-tags__pill')] as HTMLButtonElement[];
    const labels = pills.map(p => p.textContent);
    // 'cat' appears in both (count 2), 'girl' in one (count 1).
    expect(labels).toContain('cat (2)');
    expect(labels).toContain('girl (1)');
  });

  it('clicking a pill toggles its tag into the remove input and marks the pill --active', async () => {
    await seedImages([
      { id: 'a', tags: ['cat'] },
      { id: 'b', tags: ['cat'] },
    ]);
    await selectAll(['a', 'b']);

    const removeInput = document.getElementById('preview-remove-tags-input') as HTMLInputElement;
    const catPill = [...document.querySelectorAll('.preview-remove-quick-tags__pill')]
      .find(p => (p as HTMLButtonElement).dataset.tag === 'cat') as HTMLButtonElement;

    clickEl(catPill);
    expect(removeInput.value.split(/\s+/)).toContain('cat');
    expect(catPill.classList.contains('preview-remove-quick-tags__pill--active')).toBe(true);

    // Clicking again toggles the tag back out and clears the active state.
    clickEl(catPill);
    expect(removeInput.value.split(/\s+/).filter(Boolean)).not.toContain('cat');
    expect(catPill.classList.contains('preview-remove-quick-tags__pill--active')).toBe(false);
  });
});
