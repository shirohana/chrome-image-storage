// @vitest-environment happy-dom
//
// Characterization tests for the EXISTING viewer selection behavior (Route A safety net,
// pre-SolidJS migration). These lock current behavior driven through the real `init()` +
// the event-delegation handlers on `#image-grid`. They assert what the code ACTUALLY does;
// surprising behavior is documented in comments, not "fixed".
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bootViewer, seedImages, card, checkbox, teardownViewer } from './helpers/viewer-harness';
import { state } from '../src/viewer/state';

/** Dispatch a real bubbling click so the `#image-grid` delegated listener handles it. */
function clickEl(el: Element, init: MouseEventInit = {}) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

/** Dispatch a bubbling change on a checkbox so the delegated `change` listener fires. */
function changeEl(el: Element) {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The selection-dependent buttons that updateButtonStates() toggles. */
const SELECTION_BTN_IDS = [
  'tag-selected-btn',
  'delete-selected-btn',
  'dump-selected-btn',
  'restore-selected-btn',
  'deselect-all-btn',
];

beforeEach(async () => {
  await bootViewer();
});

afterEach(async () => {
  await teardownViewer();
});

describe('freshly rendered card', () => {
  it('is not .selected and its checkbox is unchecked', async () => {
    await seedImages([{ id: 'a' }, { id: 'b' }]);
    expect(card('a')!.classList.contains('selected')).toBe(false);
    expect(checkbox('a')!.checked).toBe(false);
    expect(state.selectedIds.has('a')).toBe(false);
  });
});

describe('checkbox toggling (change event)', () => {
  it('checking a card adds its id to state.selectedIds and marks the card .selected', async () => {
    await seedImages([{ id: 'a' }, { id: 'b' }]);
    const cb = checkbox('a')!;
    cb.checked = true;
    changeEl(cb);

    expect(state.selectedIds.has('a')).toBe(true);
    expect(card('a')!.classList.contains('selected')).toBe(true);
  });

  it('unchecking a card removes its id and clears .selected', async () => {
    await seedImages([{ id: 'a' }]);
    const cb = checkbox('a')!;
    cb.checked = true;
    changeEl(cb);
    expect(state.selectedIds.has('a')).toBe(true);

    cb.checked = false;
    changeEl(cb);
    expect(state.selectedIds.has('a')).toBe(false);
    expect(card('a')!.classList.contains('selected')).toBe(false);
  });
});

describe('normal click selection', () => {
  it('single-selects the clicked card (clearing any other selection)', async () => {
    await seedImages([{ id: 'a' }, { id: 'b' }]);
    clickEl(card('a')!);

    expect([...state.selectedIds]).toEqual(['a']);
    expect(card('a')!.classList.contains('selected')).toBe(true);

    clickEl(card('b')!);
    expect([...state.selectedIds]).toEqual(['b']);
    expect(card('a')!.classList.contains('selected')).toBe(false);
    expect(card('b')!.classList.contains('selected')).toBe(true);
  });

  it('clicking the only-selected card deselects it', async () => {
    await seedImages([{ id: 'a' }]);
    clickEl(card('a')!);
    expect(state.selectedIds.has('a')).toBe(true);

    clickEl(card('a')!);
    expect(state.selectedIds.has('a')).toBe(false);
    expect(card('a')!.classList.contains('selected')).toBe(false);
  });

  it('clicking an already-selected card while others are selected re-single-selects it (does NOT deselect)', async () => {
    // Documents the exact branch: deselect-on-click only fires when size === 1.
    await seedImages([{ id: 'a' }, { id: 'b' }]);
    clickEl(card('a')!, { metaKey: true });
    clickEl(card('b')!, { metaKey: true });
    expect(state.selectedIds.size).toBe(2);

    // Normal click on 'a' (already selected, but size > 1) -> single-select 'a'.
    clickEl(card('a')!);
    expect([...state.selectedIds]).toEqual(['a']);
  });
});

describe('Cmd/Ctrl + click toggling', () => {
  it('toggles a single card without clearing the others (metaKey)', async () => {
    await seedImages([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    clickEl(card('a')!, { metaKey: true });
    clickEl(card('b')!, { metaKey: true });
    expect([...state.selectedIds].sort()).toEqual(['a', 'b']);

    // Ctrl+click toggles 'a' off, leaving 'b'.
    clickEl(card('a')!, { ctrlKey: true });
    expect([...state.selectedIds]).toEqual(['b']);
  });
});

describe('Shift + click range selection', () => {
  it('selects the inclusive range from the anchor to the shift-clicked card', async () => {
    await seedImages([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    // Anchor on 'a' via a normal click.
    clickEl(card('a')!);
    expect([...state.selectedIds]).toEqual(['a']);

    // Shift+click 'c' -> range a..c.
    clickEl(card('c')!, { shiftKey: true });
    expect([...state.selectedIds].sort()).toEqual(['a', 'b', 'c']);
    expect(card('d')!.classList.contains('selected')).toBe(false);
  });

  it('shift+click clears the prior selection before applying the range', async () => {
    await seedImages([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    clickEl(card('d')!); // anchor on d
    clickEl(card('b')!, { shiftKey: true }); // range b..d
    expect([...state.selectedIds].sort()).toEqual(['b', 'c', 'd']);
  });
});

describe('deselect-all button + selection count + button states', () => {
  it('updates #selection-count text and toggles selection-button disabled state with size', async () => {
    await seedImages([{ id: 'a' }, { id: 'b' }]);
    const countEl = document.getElementById('selection-count') as HTMLElement;

    // No selection: count hidden, buttons disabled.
    expect(countEl.style.display).toBe('none');
    for (const id of SELECTION_BTN_IDS) {
      expect((document.getElementById(id) as HTMLButtonElement).disabled).toBe(true);
    }

    // Select two -> count shows "2 selected", buttons enabled.
    clickEl(card('a')!, { metaKey: true });
    clickEl(card('b')!, { metaKey: true });
    expect(countEl.textContent).toBe('2 selected');
    expect(countEl.style.display).toBe('inline');
    for (const id of SELECTION_BTN_IDS) {
      expect((document.getElementById(id) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('#deselect-all-btn clears the selection, count, and card highlights', async () => {
    await seedImages([{ id: 'a' }, { id: 'b' }]);
    clickEl(card('a')!, { metaKey: true });
    clickEl(card('b')!, { metaKey: true });
    expect(state.selectedIds.size).toBe(2);

    document.getElementById('deselect-all-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(state.selectedIds.size).toBe(0);
    expect(card('a')!.classList.contains('selected')).toBe(false);
    expect(card('b')!.classList.contains('selected')).toBe(false);
    expect((document.getElementById('selection-count') as HTMLElement).style.display).toBe('none');
    for (const id of SELECTION_BTN_IDS) {
      expect((document.getElementById(id) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
