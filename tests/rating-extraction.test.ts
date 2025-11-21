import { describe, it, expect } from 'vitest';
import { extractRatingFromTags } from '../src/storage/service';

describe('extractRatingFromTags', () => {
  describe('basic rating extraction', () => {
    it('should extract general rating', () => {
      const result = extractRatingFromTags(['girl', 'rating:g', 'cat']);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual(['girl', 'cat']);
    });

    it('should extract sensitive rating', () => {
      const result = extractRatingFromTags(['girl', 'rating:s', 'cat']);
      expect(result.rating).toBe('s');
      expect(result.cleanedTags).toEqual(['girl', 'cat']);
    });

    it('should extract questionable rating', () => {
      const result = extractRatingFromTags(['girl', 'rating:q', 'cat']);
      expect(result.rating).toBe('q');
      expect(result.cleanedTags).toEqual(['girl', 'cat']);
    });

    it('should extract explicit rating', () => {
      const result = extractRatingFromTags(['girl', 'rating:e', 'cat']);
      expect(result.rating).toBe('e');
      expect(result.cleanedTags).toEqual(['girl', 'cat']);
    });
  });

  describe('no rating tag', () => {
    it('should return undefined rating when no rating tag present', () => {
      const result = extractRatingFromTags(['girl', 'cat', 'dog']);
      expect(result.rating).toBeUndefined();
      expect(result.cleanedTags).toEqual(['girl', 'cat', 'dog']);
    });

    it('should handle empty array', () => {
      const result = extractRatingFromTags([]);
      expect(result.rating).toBeUndefined();
      expect(result.cleanedTags).toEqual([]);
    });
  });

  describe('case insensitivity', () => {
    it('should extract uppercase rating tags', () => {
      const result = extractRatingFromTags(['girl', 'RATING:G', 'cat']);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual(['girl', 'cat']);
    });

    it('should extract mixed case rating tags', () => {
      const result = extractRatingFromTags(['girl', 'RaTiNg:S', 'cat']);
      expect(result.rating).toBe('s');
      expect(result.cleanedTags).toEqual(['girl', 'cat']);
    });

    it('should normalize uppercase rating value to lowercase', () => {
      const result = extractRatingFromTags(['rating:G', 'rating:S']);
      expect(result.rating).toBe('g');
    });
  });

  describe('multiple rating tags', () => {
    it('should use first rating tag and remove all', () => {
      const result = extractRatingFromTags(['rating:g', 'girl', 'rating:s', 'cat']);
      expect(result.rating).toBe('g'); // First wins
      expect(result.cleanedTags).toEqual(['girl', 'cat']); // Both removed
    });

    it('should remove all rating tags even if different values', () => {
      const result = extractRatingFromTags(['rating:g', 'rating:s', 'rating:q', 'rating:e']);
      expect(result.rating).toBe('g'); // First wins
      expect(result.cleanedTags).toEqual([]); // All removed
    });

    it('should keep first rating among duplicates', () => {
      const result = extractRatingFromTags(['rating:s', 'girl', 'rating:s']);
      expect(result.rating).toBe('s');
      expect(result.cleanedTags).toEqual(['girl']);
    });
  });

  describe('edge cases', () => {
    it('should not match partial rating tags', () => {
      const result = extractRatingFromTags(['rating:general', 'rating:safe']);
      // Only exact format rating:X (single char) should match
      expect(result.rating).toBeUndefined();
      expect(result.cleanedTags).toEqual(['rating:general', 'rating:safe']);
    });

    it('should not match rating without colon', () => {
      const result = extractRatingFromTags(['ratingg', 'rating g']);
      expect(result.rating).toBeUndefined();
      expect(result.cleanedTags).toEqual(['ratingg', 'rating g']);
    });

    it('should not match invalid rating values', () => {
      const result = extractRatingFromTags(['rating:x', 'rating:y', 'girl']);
      expect(result.rating).toBeUndefined();
      expect(result.cleanedTags).toEqual(['rating:x', 'rating:y', 'girl']);
    });

    it('should handle rating tag at start', () => {
      const result = extractRatingFromTags(['rating:g', 'girl', 'cat']);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual(['girl', 'cat']);
    });

    it('should handle rating tag at end', () => {
      const result = extractRatingFromTags(['girl', 'cat', 'rating:g']);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual(['girl', 'cat']);
    });

    it('should handle only rating tags', () => {
      const result = extractRatingFromTags(['rating:g']);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual([]);
    });

    it('should preserve tag order after removal', () => {
      const result = extractRatingFromTags(['tag1', 'rating:g', 'tag2', 'rating:s', 'tag3']);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual(['tag1', 'tag2', 'tag3']);
    });
  });

  describe('integration with other tag types', () => {
    it('should work with underscored tags', () => {
      const result = extractRatingFromTags(['long_hair', 'rating:g', 'short_hair']);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual(['long_hair', 'short_hair']);
    });

    it('should work with special character tags', () => {
      const result = extractRatingFromTags(['girl_(qualifier)', 'rating:s', 'cat:pet']);
      expect(result.rating).toBe('s');
      expect(result.cleanedTags).toEqual(['girl_(qualifier)', 'cat:pet']);
    });

    it('should not confuse with other colon tags', () => {
      const result = extractRatingFromTags(['artist:pixiv', 'rating:g', 'type:illustration']);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual(['artist:pixiv', 'type:illustration']);
    });

    it('should work with empty strings in array', () => {
      const result = extractRatingFromTags(['', 'rating:g', '']);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual(['', '']);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle Danbooru-style tag list', () => {
      const result = extractRatingFromTags([
        '1girl',
        'solo',
        'long_hair',
        'rating:s',
        'blonde_hair',
        'blue_eyes',
      ]);
      expect(result.rating).toBe('s');
      expect(result.cleanedTags).toEqual([
        '1girl',
        'solo',
        'long_hair',
        'blonde_hair',
        'blue_eyes',
      ]);
    });

    it('should handle mixed source tags', () => {
      const result = extractRatingFromTags([
        'pixiv',
        'artwork',
        'rating:g',
        'original',
        'rating:s', // Duplicate, should still be removed
      ]);
      expect(result.rating).toBe('g');
      expect(result.cleanedTags).toEqual(['pixiv', 'artwork', 'original']);
    });
  });
});
