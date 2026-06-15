/**
 * Pure index math shared by grid and lightbox navigation.
 *
 * These two navigation modes deliberately behave differently at the edges, and
 * historically the logic was copy-pasted between them — a bug fix applied to the
 * grid was missed in the lightbox. Centralising the math here keeps the two
 * behaviours explicit and gives ONE TRUTH to test:
 *
 *   - Grid (arrow keys): CLAMP to the boundary — moving past the edge re-selects
 *     the first/last item.
 *   - Lightbox (prev/next): BOUNDED — moving past the edge does nothing.
 */

/** Clamp an index into [0, length-1]. Returns -1 when there are no items. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.max(0, Math.min(index, length - 1));
}

/**
 * Grid navigation: move `current` by `offset`, clamping to the valid range.
 * Used for both horizontal (offset = ±1) and vertical (offset = ±columns) moves.
 * Returns the clamped destination index, or -1 if there are no items.
 */
export function offsetIndexClamped(current: number, offset: number, length: number): number {
  if (length <= 0) return -1;
  return clampIndex(current + offset, length);
}

/**
 * Lightbox navigation: move `current` by `offset` only if the destination is in
 * bounds; otherwise return null to signal "no movement" (stay on current item).
 */
export function offsetIndexBounded(current: number, offset: number, length: number): number | null {
  const next = current + offset;
  if (next < 0 || next >= length) return null;
  return next;
}
