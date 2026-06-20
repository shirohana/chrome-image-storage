// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { createImageCardNode } from '../src/viewer/render';
import { state } from '../src/viewer/state';
import type { ImageMetadata } from '../src/types';

function img(p: Partial<ImageMetadata>): ImageMetadata {
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

/** Render the card to a standalone DOM node for querying. */
function card(image: ImageMetadata): HTMLElement {
  return createImageCardNode(image);
}

function setTagSearch(value: string) {
  let input = document.getElementById('tag-search-input') as HTMLInputElement | null;
  if (!input) {
    input = document.createElement('input');
    input.id = 'tag-search-input';
    document.body.appendChild(input);
  }
  input.value = value;
}

beforeEach(() => {
  document.body.innerHTML = '';
  state.selectedIds.clear();
  state.currentView = 'all';
  state.loadedBlobs.clear();
  state.objectUrls.clear();
});

describe('createImageCardNode structure', () => {
  it('renders a card with id, an image-preview, and an unchecked checkbox by default', () => {
    const el = card(img({ id: 'abc' }));
    expect(el.classList.contains('image-card')).toBe(true);
    expect(el.classList.contains('selected')).toBe(false);
    expect(el.dataset.id).toBe('abc');
    expect(el.querySelector('img.image-preview')!.getAttribute('data-image-id')).toBe('abc');
    const cb = el.querySelector('.image-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it('marks the card selected and checks the box when the id is in state.selectedIds', () => {
    state.selectedIds.add('abc');
    const el = card(img({ id: 'abc' }));
    expect(el.classList.contains('selected')).toBe(true);
    expect((el.querySelector('.image-checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('shows formatted size, dimensions, type and the page title link', () => {
    const el = card(img({ fileSize: 2048, width: 100, height: 200, mimeType: 'image/jpeg', pageTitle: 'Hi', pageUrl: 'https://e.com/p' }));
    expect(el.textContent).toContain('2.0 KB');
    expect(el.textContent).toContain('100 × 200');
    expect(el.textContent).toContain('image/jpeg');
    const link = el.querySelector('a.page-link') as HTMLAnchorElement;
    expect(link.textContent).toBe('Hi');
    expect(link.getAttribute('href')).toBe('https://e.com/p');
  });
});

describe('rating badge', () => {
  it('renders an unrated dash badge when there is no rating', () => {
    const badge = card(img({ rating: undefined })).querySelector('.rating-badge')!;
    expect(badge.classList.contains('rating-badge-unrated')).toBe(true);
    expect(badge.textContent).toBe('—');
  });

  it.each([
    ['g', 'G'],
    ['s', 'S'],
    ['q', 'Q'],
    ['e', 'E'],
  ] as const)('renders the %s rating as label %s', (rating, label) => {
    const badge = card(img({ rating })).querySelector('.rating-badge')!;
    expect(badge.classList.contains('rating-badge-unrated')).toBe(false);
    expect(badge.textContent).toBe(label);
  });
});

describe('tags', () => {
  it('omits the tags block when there are no tags', () => {
    expect(card(img({ tags: [] })).querySelector('.image-tags')).toBeNull();
    expect(card(img({ tags: undefined })).querySelector('.image-tags')).toBeNull();
  });

  it('renders tags sorted alphabetically', () => {
    const tags = Array.from(card(img({ tags: ['dog', 'cat', 'bird'] })).querySelectorAll('.image-tags__tag'));
    expect(tags.map(t => t.getAttribute('data-tag'))).toEqual(['bird', 'cat', 'dog']);
  });

  it('highlights only tags present in the active tag search', () => {
    setTagSearch('cat');
    const el = card(img({ tags: ['cat', 'dog'] }));
    const cat = el.querySelector('[data-tag="cat"]')!;
    const dog = el.querySelector('[data-tag="dog"]')!;
    expect(cat.classList.contains('image-tags__tag--active')).toBe(true);
    expect(dog.classList.contains('image-tags__tag--active')).toBe(false);
  });
});

describe('X account button', () => {
  it('shows an account button for x.com/twitter URLs', () => {
    const btn = card(img({ pageUrl: 'https://x.com/alice/status/1' })).querySelector('.image-account-btn');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('data-account')).toBe('alice');
    expect(btn!.textContent).toBe('@alice');
  });

  it('omits the account button for non-x URLs', () => {
    expect(card(img({ pageUrl: 'https://example.com/p' })).querySelector('.image-account-btn')).toBeNull();
  });

  it('marks the account button active when account: is in the search', () => {
    setTagSearch('account:alice');
    const btn = card(img({ pageUrl: 'https://x.com/alice/status/1' })).querySelector('.image-account-btn')!;
    expect(btn.classList.contains('image-account-btn--active')).toBe(true);
  });
});

describe('actions by view', () => {
  it('shows Save + Delete in the normal view', () => {
    const el = card(img({}));
    expect(el.querySelector('.download-btn')).not.toBeNull();
    expect(el.querySelector('.delete-btn')).not.toBeNull();
    expect(el.querySelector('.restore-btn')).toBeNull();
  });

  it('shows Restore + Delete Forever in the trash view', () => {
    state.currentView = 'trash';
    const el = card(img({}));
    expect(el.querySelector('.restore-btn')).not.toBeNull();
    expect(el.querySelector('.permanent-delete-btn')).not.toBeNull();
    expect(el.querySelector('.download-btn')).toBeNull();
  });
});
