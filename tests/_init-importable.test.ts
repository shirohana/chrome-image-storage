// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';

describe('viewer/index importability', () => {
  it('imports under happy-dom without touching the DOM at import time, and exposes init()', async () => {
    const mod = await import('../src/viewer/index');
    expect(typeof mod.init).toBe('function');
  });
});
