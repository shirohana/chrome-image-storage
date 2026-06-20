// @vitest-environment happy-dom
//
// Characterization tests for the EXISTING viewer keyboard-navigation behavior
// (Route A safety net, pre-SolidJS migration). These lock what the real `init()`
// keydown handler + navigateGridByOffset / navigateLightboxByOffset do TODAY.
// They assert actual behavior; anything surprising is DOCUMENTED in a comment,
// not "fixed". No `src/` changes.
//
// ── Columns under happy-dom ─────────────────────────────────────────────────
// `getGridColumns()` reads `getComputedStyle(grid).gridTemplateColumns` and counts
// space-separated tokens. happy-dom has no layout engine, so that value is the
// empty string `''`; the handler's guard `if (gtc && gtc !== 'none')` is false, so
// it takes its documented fallback of **4 columns**. Every Up/Down assertion below
// is written against that 4-column fallback (verified empirically in the first
// describe block). If the fallback ever changes, these tests are the canary.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { bootViewer, resetState, seedImages, card } from './helpers/viewer-harness';
import { state } from '../src/viewer/state';
import { getVisualOrder } from '../src/viewer/grouping';

/** Dispatch a real bubbling KeyboardEvent so the document-level keydown listener fires. */
function key(k: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

/** Click a card to single-select it (establishes the nav cursor + anchor). */
function selectViaClick(id: string) {
  card(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** The single selected id, or undefined when the selection is not exactly one. */
function onlySelected(): string | undefined {
  return state.selectedIds.size === 1 ? [...state.selectedIds][0] : undefined;
}

// Six images: with the 4-column fallback this is two rows [a b c d] / [e f].
const SIX = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }];

// Boot the real viewer once (shared harness: single init() against index.html,
// document-level keydown listeners bound exactly once) and reset state per test.
beforeAll(async () => {
  await bootViewer();
});

beforeEach(async () => {
  await resetState();
  document.getElementById('lightbox')?.classList.remove('active');
});

describe('columns fallback under happy-dom', () => {
  it('getComputedStyle(grid).gridTemplateColumns is "" so the handler uses its 4-column fallback', async () => {
    await seedImages(SIX);
    const grid = document.getElementById('image-grid')!;
    // Document the environment assumption the Up/Down tests rely on.
    expect(window.getComputedStyle(grid).gridTemplateColumns).toBe('');

    // Indirect proof of "4": from 'a' (index 0), ArrowDown moves +4 -> 'e'.
    selectViaClick('a');
    key('ArrowDown');
    expect(onlySelected()).toBe('e');
  });
});

describe('grid horizontal arrow nav (Left/Right, ungrouped)', () => {
  it('ArrowRight moves the single selection +1 in visual order', async () => {
    await seedImages(SIX);
    selectViaClick('a');
    key('ArrowRight');
    expect(onlySelected()).toBe('b');
    key('ArrowRight');
    expect(onlySelected()).toBe('c');
  });

  it('ArrowLeft moves the single selection -1 in visual order', async () => {
    await seedImages(SIX);
    selectViaClick('c');
    key('ArrowLeft');
    expect(onlySelected()).toBe('b');
  });

  it('with NO selection, the first arrow press starts from the first card', async () => {
    // navigateGridByOffset falls back to allCards[0] when nothing is selected, then
    // applies the offset from there. ArrowRight => index 0 + 1 => 'b'.
    await seedImages(SIX);
    expect(state.selectedIds.size).toBe(0);
    key('ArrowRight');
    expect(onlySelected()).toBe('b');
  });

  it('ArrowRight at the LAST card CLAMPS (stays on last, no wrap)', async () => {
    await seedImages(SIX);
    selectViaClick('f');
    key('ArrowRight');
    expect(onlySelected()).toBe('f'); // clamped, did NOT wrap to 'a'
  });

  it('ArrowLeft at the FIRST card CLAMPS (stays on first, no wrap)', async () => {
    await seedImages(SIX);
    selectViaClick('a');
    key('ArrowLeft');
    expect(onlySelected()).toBe('a'); // clamped, did NOT wrap to 'f'
  });
});

describe('grid vertical arrow nav (Up/Down, 4-column fallback)', () => {
  it('ArrowDown moves +columns (4): a -> e', async () => {
    await seedImages(SIX);
    selectViaClick('a');
    key('ArrowDown');
    expect(onlySelected()).toBe('e');
  });

  it('ArrowUp moves -columns (4): e -> a', async () => {
    await seedImages(SIX);
    selectViaClick('e');
    key('ArrowUp');
    expect(onlySelected()).toBe('a');
  });

  it('ArrowDown CLAMPS to the last card when +columns overshoots the end', async () => {
    // From 'c' (index 2), +4 => index 6 which is out of range (len 6) -> clamps to
    // index 5 = 'f'. NOTE: this is a horizontal jump — the grid does NOT preserve the
    // column when it clamps. Documented consequence of clamp-by-DOM-index, not "fixed".
    await seedImages(SIX);
    selectViaClick('c');
    key('ArrowDown');
    expect(onlySelected()).toBe('f');
  });

  it('ArrowUp CLAMPS to the first card when -columns undershoots the start', async () => {
    // From 'b' (index 1), -4 => -3 -> clamps to index 0 = 'a'.
    await seedImages(SIX);
    selectViaClick('b');
    key('ArrowUp');
    expect(onlySelected()).toBe('a');
  });
});

describe('grid Shift+Arrow extends selection (range)', () => {
  it('Shift+ArrowRight extends the selection instead of replacing it', async () => {
    await seedImages(SIX);
    selectViaClick('a'); // anchor + cursor on 'a'
    key('ArrowRight', { shiftKey: true });
    expect([...state.selectedIds].sort()).toEqual(['a', 'b']);
    key('ArrowRight', { shiftKey: true });
    expect([...state.selectedIds].sort()).toEqual(['a', 'b', 'c']);
  });

  it('Shift+ArrowDown extends the selection across a row (+4): a..e', async () => {
    await seedImages(SIX);
    selectViaClick('a');
    key('ArrowDown', { shiftKey: true });
    expect([...state.selectedIds].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('Shift+ArrowLeft builds the range on the other side of the anchor', async () => {
    // Anchor stays on 'c'; moving focus left to 'b' yields the inclusive range b..c.
    await seedImages(SIX);
    selectViaClick('c');
    key('ArrowLeft', { shiftKey: true });
    expect([...state.selectedIds].sort()).toEqual(['b', 'c']);
  });

  it('with NO selection, Shift+Arrow seeds the first card as the anchor (NO movement on that first press)', async () => {
    // navigateGridByOffsetExpand: when nothing is selected it selects allCards[0]
    // and sets it as the anchor, returning WITHOUT applying the offset.
    await seedImages(SIX);
    key('ArrowRight', { shiftKey: true });
    expect([...state.selectedIds]).toEqual(['a']);
  });
});

describe('Space opens the lightbox; Space/Escape close it', () => {
  it('Space opens the lightbox for the single-selected image', async () => {
    await seedImages(SIX);
    selectViaClick('b');
    key(' ');
    expect(state.lightboxActive).toBe(true);
    // currentLightboxIndex is the visual-order index of 'b' (= 1).
    expect(state.currentLightboxIndex).toBe(1);
    expect(document.getElementById('lightbox')!.classList.contains('active')).toBe(true);
  });

  it('Space does NOTHING when the selection is not exactly one', async () => {
    await seedImages(SIX);
    card('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    card('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(state.selectedIds.size).toBe(2);
    key(' ');
    expect(state.lightboxActive).toBe(false);
  });

  it('Space inside the lightbox closes it', async () => {
    await seedImages(SIX);
    selectViaClick('b');
    key(' ');
    expect(state.lightboxActive).toBe(true);
    key(' ');
    expect(state.lightboxActive).toBe(false);
    expect(document.getElementById('lightbox')!.classList.contains('active')).toBe(false);
  });

  it('Escape inside the lightbox closes it', async () => {
    await seedImages(SIX);
    selectViaClick('b');
    key(' ');
    expect(state.lightboxActive).toBe(true);
    key('Escape');
    expect(state.lightboxActive).toBe(false);
  });
});

describe('lightbox arrow nav (Left/Right next/prev, edges are NO-OP/bounded)', () => {
  async function openOn(id: string) {
    await seedImages(SIX);
    selectViaClick(id);
    key(' ');
    expect(state.lightboxActive).toBe(true);
  }

  it('ArrowRight advances to the next image AND syncs the grid selection', async () => {
    await openOn('b');
    key('ArrowRight');
    expect(state.currentLightboxIndex).toBe(2); // 'c'
    // Lightbox nav mirrors selection onto the grid (macOS-style).
    expect(onlySelected()).toBe('c');
  });

  it('ArrowLeft goes to the previous image', async () => {
    await openOn('c');
    key('ArrowLeft');
    expect(state.currentLightboxIndex).toBe(1); // 'b'
    expect(onlySelected()).toBe('b');
  });

  it('ArrowRight at the LAST image is a NO-OP (bounded; does NOT clamp-move or wrap)', async () => {
    // The grid-vs-lightbox edge distinction: grid CLAMPS (re-selects the boundary),
    // lightbox is BOUNDED -> the press is simply ignored, index unchanged, stays open.
    await openOn('f');
    expect(state.currentLightboxIndex).toBe(5);
    key('ArrowRight');
    expect(state.currentLightboxIndex).toBe(5); // unchanged
    expect(state.lightboxActive).toBe(true);
  });

  it('ArrowLeft at the FIRST image is a NO-OP (bounded)', async () => {
    await openOn('a');
    expect(state.currentLightboxIndex).toBe(0);
    key('ArrowLeft');
    expect(state.currentLightboxIndex).toBe(0); // unchanged
    expect(state.lightboxActive).toBe(true);
  });
});

describe('lightbox vertical nav (Up/Down by columns, bounded)', () => {
  async function openOn(id: string) {
    await seedImages(SIX);
    selectViaClick(id);
    key(' ');
  }

  it('ArrowDown moves +columns (4): a -> e', async () => {
    await openOn('a');
    key('ArrowDown');
    expect(state.currentLightboxIndex).toBe(4); // 'e'
    expect(onlySelected()).toBe('e');
  });

  it('ArrowUp moves -columns (4): e -> a', async () => {
    await openOn('e');
    key('ArrowUp');
    expect(state.currentLightboxIndex).toBe(0); // 'a'
  });

  it('ArrowDown that would overshoot the end is a NO-OP (bounded — unlike the grid which CLAMPS)', async () => {
    // From 'c' (index 2), +4 => 6 out of bounds. Grid would clamp to 'f'; the lightbox
    // instead does nothing and stays on 'c'. Locks the edge-semantics divergence that
    // CLAUDE.md / navigation-math.ts call out as ONE TRUTH.
    await openOn('c');
    expect(state.currentLightboxIndex).toBe(2);
    key('ArrowDown');
    expect(state.currentLightboxIndex).toBe(2); // unchanged (NOT clamped to 'f')
  });

  it('ArrowUp that would undershoot the start is a NO-OP (bounded)', async () => {
    await openOn('b');
    expect(state.currentLightboxIndex).toBe(1);
    key('ArrowUp');
    expect(state.currentLightboxIndex).toBe(1); // unchanged (NOT clamped to 'a')
  });
});

describe('navigation follows getVisualOrder when grouping is enabled', () => {
  // The exact bug class CLAUDE.md warns about: grid & lightbox nav must both walk
  // getVisualOrder(state.filteredImages, state.groupBy), NOT the raw filtered array.
  //
  // x-account grouping orders accounts by count (desc) then name (asc). "amy" has 2
  // images, "bob" has 1. By raw insertion order the array is [bob1, amy1, amy2];
  // getVisualOrder reorders amy's (larger) group first -> [amy1, amy2, bob1].
  const GROUPED = [
    { id: 'bob1', pageUrl: 'https://x.com/bob/status/1' },
    { id: 'amy1', pageUrl: 'https://x.com/amy/status/2' },
    { id: 'amy2', pageUrl: 'https://x.com/amy/status/3' },
  ];

  async function seedGrouped() {
    state.groupBy = 'x-account';
    return seedImages(GROUPED);
  }

  it('the DOM card order matches getVisualOrder (sanity for the nav assumption)', async () => {
    await seedGrouped();
    const domOrder = [...document.querySelectorAll('.image-card')].map(c => (c as HTMLElement).dataset.id);
    const visual = getVisualOrder(state.filteredImages, state.groupBy).map(i => i.id);
    expect(visual).toEqual(['amy1', 'amy2', 'bob1']);
    expect(domOrder).toEqual(visual);
  });

  it('grid ArrowRight walks visual order, not the raw filtered array', async () => {
    await seedGrouped();
    selectViaClick('amy1'); // first in visual order
    key('ArrowRight');
    expect(onlySelected()).toBe('amy2'); // next in visual order (NOT 'bob1', the raw-array neighbor)
    key('ArrowRight');
    expect(onlySelected()).toBe('bob1');
    key('ArrowRight');
    expect(onlySelected()).toBe('bob1'); // clamped at the last visual card
  });

  it('lightbox Right walks visual order under grouping (no grid/lightbox divergence)', async () => {
    await seedGrouped();
    selectViaClick('amy1');
    key(' ');
    expect(state.lightboxActive).toBe(true);
    const visual = getVisualOrder(state.filteredImages, state.groupBy).map(i => i.id);

    key('ArrowRight');
    expect(visual[state.currentLightboxIndex]).toBe('amy2');
    key('ArrowRight');
    expect(visual[state.currentLightboxIndex]).toBe('bob1');
    key('ArrowRight');
    expect(visual[state.currentLightboxIndex]).toBe('bob1'); // bounded no-op at the end
  });
});
