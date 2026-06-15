import { describe, it, expect } from 'vitest';
import { clampIndex, offsetIndexClamped, offsetIndexBounded } from '../src/viewer/navigation-math';

describe('clampIndex', () => {
  it('clamps into [0, length-1]', () => {
    expect(clampIndex(-5, 10)).toBe(0);
    expect(clampIndex(3, 10)).toBe(3);
    expect(clampIndex(20, 10)).toBe(9);
  });

  it('returns -1 for empty', () => {
    expect(clampIndex(0, 0)).toBe(-1);
    expect(clampIndex(3, -1)).toBe(-1);
  });
});

describe('offsetIndexClamped (grid: clamp at edges)', () => {
  it('moves within bounds', () => {
    expect(offsetIndexClamped(2, 1, 10)).toBe(3);
    expect(offsetIndexClamped(5, -1, 10)).toBe(4);
    expect(offsetIndexClamped(2, 4, 10)).toBe(6); // vertical move by columns
  });

  it('clamps instead of wrapping at the start edge', () => {
    expect(offsetIndexClamped(0, -1, 10)).toBe(0);
    expect(offsetIndexClamped(1, -4, 10)).toBe(0);
  });

  it('clamps instead of wrapping at the end edge', () => {
    expect(offsetIndexClamped(9, 1, 10)).toBe(9);
    expect(offsetIndexClamped(8, 4, 10)).toBe(9);
  });

  it('returns -1 when there are no items', () => {
    expect(offsetIndexClamped(0, 1, 0)).toBe(-1);
  });
});

describe('offsetIndexBounded (lightbox: no movement at edges)', () => {
  it('moves within bounds', () => {
    expect(offsetIndexBounded(2, 1, 10)).toBe(3);
    expect(offsetIndexBounded(5, -1, 10)).toBe(4);
  });

  it('returns null past the start edge (stay put)', () => {
    expect(offsetIndexBounded(0, -1, 10)).toBeNull();
  });

  it('returns null past the end edge (stay put)', () => {
    expect(offsetIndexBounded(9, 1, 10)).toBeNull();
  });

  it('returns null for empty', () => {
    expect(offsetIndexBounded(0, 1, 0)).toBeNull();
  });
});

describe('grid vs lightbox differ at edges (the historical bug)', () => {
  it('at the last item, grid stays clamped but lightbox refuses to move', () => {
    expect(offsetIndexClamped(9, 1, 10)).toBe(9); // grid: re-selects last
    expect(offsetIndexBounded(9, 1, 10)).toBeNull(); // lightbox: no-op
  });
});
