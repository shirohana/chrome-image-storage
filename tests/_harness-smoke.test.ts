// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { bootViewer, seedImages, card, checkbox, teardownViewer } from './helpers/viewer-harness';

afterEach(async () => {
  await teardownViewer();
});

describe('viewer harness', () => {
  it('boots init() cleanly against the real index.html fixture', async () => {
    await bootViewer();
    // The fixture's core elements are present and wired.
    expect(document.getElementById('image-grid')).not.toBeNull();
    expect(document.getElementById('deselect-all-btn')).not.toBeNull();
    // Empty data -> empty state shown.
    expect((document.getElementById('image-grid') as HTMLElement).style.display).toBe('none');
  });

  it('seeds and renders cards into the grid', async () => {
    await bootViewer();
    await seedImages([{ id: 'a' }, { id: 'b' }]);
    expect(card('a')).not.toBeNull();
    expect(card('b')).not.toBeNull();
    expect(checkbox('a')!.checked).toBe(false);
  });
});
