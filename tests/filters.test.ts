import { describe, it, expect } from 'vitest';
import {
  parseSearchQuery,
  filterImages,
  computeRatingCounts,
  sortImages,
} from '../src/viewer/filters';
import type { ImageMetadata } from '../src/types';

function img(p: Partial<ImageMetadata>): ImageMetadata {
  return {
    id: p.id ?? 'id',
    imageUrl: p.imageUrl ?? 'https://example.com/a.png',
    pageUrl: p.pageUrl ?? 'https://example.com/page',
    pageTitle: p.pageTitle,
    mimeType: p.mimeType ?? 'image/png',
    fileSize: p.fileSize ?? 1000,
    width: p.width ?? 100,
    height: p.height ?? 100,
    savedAt: p.savedAt ?? 0,
    updatedAt: p.updatedAt,
    tags: p.tags,
    isDeleted: p.isDeleted,
    rating: p.rating,
  };
}

const inputs = (o: Partial<{ view: 'all' | 'trash'; urlSearch: string; tagSearch: string }> = {}) => ({
  view: o.view ?? ('all' as const),
  urlSearch: o.urlSearch ?? '',
  tagSearch: o.tagSearch ?? '',
});

describe('parseSearchQuery', () => {
  it('parses a list tagcount and strips it from terms', () => {
    expect(parseSearchQuery('cat tagcount:1,3,5')).toEqual({
      terms: 'cat',
      tagCount: { operator: 'list', values: [1, 3, 5] },
    });
  });

  it('parses comparison and range operators', () => {
    expect(parseSearchQuery('tagcount:>2').tagCount).toEqual({ operator: '>', value: 2 });
    expect(parseSearchQuery('tagcount:<=4').tagCount).toEqual({ operator: '<=', value: 4 });
    expect(parseSearchQuery('tagcount:2..10').tagCount).toEqual({ operator: 'range', min: 2, max: 10 });
    expect(parseSearchQuery('tagcount:3').tagCount).toEqual({ operator: '=', value: 3 });
  });

  it('returns null tagCount when absent', () => {
    expect(parseSearchQuery('just text').tagCount).toBeNull();
  });
});

describe('filterImages', () => {
  const all = [
    img({ id: 'a', isDeleted: false, tags: ['cat'], rating: 's' }),
    img({ id: 'b', isDeleted: false, tags: ['dog'], rating: 'e' }),
    img({ id: 'c', isDeleted: true, tags: ['cat'], rating: 's' }),
  ];

  it('filters by view (all hides deleted, trash shows only deleted)', () => {
    expect(filterImages(all, inputs({ view: 'all' })).map(i => i.id)).toEqual(['a', 'b']);
    expect(filterImages(all, inputs({ view: 'trash' })).map(i => i.id)).toEqual(['c']);
  });

  it('filters by URL/title substring (case-insensitive)', () => {
    const imgs = [
      img({ id: 'x', pageTitle: 'Cute Cat' }),
      img({ id: 'y', pageUrl: 'https://dogs.example.com/1' }),
    ];
    expect(filterImages(imgs, inputs({ urlSearch: 'cat' })).map(i => i.id)).toEqual(['x']);
    expect(filterImages(imgs, inputs({ urlSearch: 'dogs' })).map(i => i.id)).toEqual(['y']);
  });

  it('applies include / exclude tags', () => {
    expect(filterImages(all, inputs({ tagSearch: 'cat' })).map(i => i.id)).toEqual(['a']);
    expect(filterImages(all, inputs({ tagSearch: '-cat' })).map(i => i.id)).toEqual(['b']);
  });

  it('applies the rating filter for the grid', () => {
    expect(filterImages(all, inputs({ tagSearch: 'rating:e' })).map(i => i.id)).toEqual(['b']);
  });
});

describe('computeRatingCounts', () => {
  const all = [
    img({ id: 'a', tags: ['cat'], rating: 's' }),
    img({ id: 'b', tags: ['cat'], rating: 'e' }),
    img({ id: 'c', tags: ['cat'], rating: undefined }),
    img({ id: 'd', tags: ['dog'], rating: 's' }),
  ];

  it('counts ratings across the filtered set', () => {
    expect(computeRatingCounts(all, inputs())).toEqual({ g: 0, s: 2, q: 0, e: 1, unrated: 1 });
  });

  it('ignores the rating metatag so pills show counts for all ratings', () => {
    // tagSearch narrows to cat, but rating:s is intentionally NOT applied here
    expect(computeRatingCounts(all, inputs({ tagSearch: 'cat rating:s' }))).toEqual({
      g: 0, s: 1, q: 0, e: 1, unrated: 1,
    });
  });
});

describe('sortImages', () => {
  it('sorts savedAt desc and asc in place', () => {
    const imgs = [img({ id: 'a', savedAt: 1 }), img({ id: 'b', savedAt: 3 }), img({ id: 'c', savedAt: 2 })];
    sortImages(imgs, 'savedAt-desc');
    expect(imgs.map(i => i.id)).toEqual(['b', 'c', 'a']);
    sortImages(imgs, 'savedAt-asc');
    expect(imgs.map(i => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by dimensions (area) and falls back to savedAt for updatedAt', () => {
    const imgs = [
      img({ id: 'small', width: 10, height: 10 }),
      img({ id: 'big', width: 100, height: 100 }),
    ];
    sortImages(imgs, 'dimensions-desc');
    expect(imgs.map(i => i.id)).toEqual(['big', 'small']);

    const u = [img({ id: 'old', savedAt: 1 }), img({ id: 'new', savedAt: 5, updatedAt: 2 })];
    sortImages(u, 'updatedAt-asc');
    expect(u.map(i => i.id)).toEqual(['old', 'new']);
  });
});
