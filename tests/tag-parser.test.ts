import { describe, it, expect } from 'vitest';
import { parseTagSearch } from '../src/viewer/tag-utils';
import type { ParsedTagSearch } from '../src/viewer/tag-utils';

describe('parseTagSearch', () => {
  describe('empty and whitespace', () => {
    it('should handle empty string', () => {
      const result = parseTagSearch('');
      expect(result.includeTags).toEqual([]);
      expect(result.excludeTags).toEqual([]);
      expect(result.orGroups).toEqual([]);
      expect(result.ratings.size).toBe(0);
      expect(result.fileTypes.size).toBe(0);
      expect(result.tagCount).toBeNull();
      expect(result.includeUnrated).toBe(false);
    });

    it('should handle only whitespace', () => {
      const result = parseTagSearch('   ');
      expect(result.includeTags).toEqual([]);
      expect(result.excludeTags).toEqual([]);
    });

    it('should handle multiple spaces between tags', () => {
      const result = parseTagSearch('girl  cat');
      expect(result.includeTags).toEqual(['girl', 'cat']);
    });
  });

  describe('basic tag inclusion (AND)', () => {
    it('should parse single tag', () => {
      const result = parseTagSearch('girl');
      expect(result.includeTags).toEqual(['girl']);
      expect(result.excludeTags).toEqual([]);
    });

    it('should parse multiple tags (AND logic)', () => {
      const result = parseTagSearch('girl cat dog');
      expect(result.includeTags).toEqual(['girl', 'cat', 'dog']);
      expect(result.excludeTags).toEqual([]);
    });
  });

  describe('tag exclusion', () => {
    it('should parse single excluded tag', () => {
      const result = parseTagSearch('-dog');
      expect(result.includeTags).toEqual([]);
      expect(result.excludeTags).toEqual(['dog']);
    });

    it('should parse mixed include and exclude', () => {
      const result = parseTagSearch('girl cat -dog');
      expect(result.includeTags).toEqual(['girl', 'cat']);
      expect(result.excludeTags).toEqual(['dog']);
    });

    it('should handle multiple excluded tags', () => {
      const result = parseTagSearch('-dog -cat -bird');
      expect(result.includeTags).toEqual([]);
      expect(result.excludeTags).toEqual(['dog', 'cat', 'bird']);
    });

    it('should ignore empty exclusion (standalone hyphen)', () => {
      const result = parseTagSearch('girl - cat');
      // The standalone '-' creates an empty string after substring(1)
      expect(result.includeTags).toEqual(['girl', 'cat']);
    });
  });

  describe('OR logic', () => {
    it('should parse simple OR', () => {
      const result = parseTagSearch('girl or cat');
      expect(result.includeTags).toEqual([]);
      expect(result.orGroups).toEqual([['girl', 'cat']]);
    });

    it('should parse multiple OR groups', () => {
      const result = parseTagSearch('girl or cat boy or dog');
      expect(result.includeTags).toEqual([]);
      expect(result.orGroups).toEqual([['girl', 'cat'], ['boy', 'dog']]);
    });

    it('should handle chained OR (three tags)', () => {
      const result = parseTagSearch('girl or cat or dog');
      expect(result.includeTags).toEqual([]);
      expect(result.orGroups).toEqual([['girl', 'cat', 'dog']]);
    });

    it('should parse mixed AND and OR', () => {
      const result = parseTagSearch('anime girl or boy');
      expect(result.includeTags).toEqual(['anime']);
      expect(result.orGroups).toEqual([['girl', 'boy']]);
    });

    it('should handle OR with exclusion', () => {
      const result = parseTagSearch('girl or cat -dog');
      expect(result.includeTags).toEqual([]);
      expect(result.orGroups).toEqual([['girl', 'cat']]);
      expect(result.excludeTags).toEqual(['dog']);
    });

    it('should handle case-insensitive OR', () => {
      const result = parseTagSearch('girl OR cat');
      expect(result.orGroups).toEqual([['girl', 'cat']]);
    });

    it('should handle OR at start (edge case)', () => {
      const result = parseTagSearch('or cat');
      // 'or' at position 0, no previous tag, should not create OR group
      expect(result.includeTags).toEqual(['cat']);
      expect(result.orGroups).toEqual([]);
    });

    it('should handle OR at end (edge case)', () => {
      const result = parseTagSearch('girl or');
      // 'or' at end, no next tag, should not create OR group
      expect(result.includeTags).toEqual(['girl']);
      expect(result.orGroups).toEqual([]);
    });
  });

  describe('rating filters', () => {
    it('should parse single rating', () => {
      const result = parseTagSearch('rating:g');
      expect(result.ratings).toEqual(new Set(['g']));
    });

    it('should parse multiple ratings (comma-separated)', () => {
      const result = parseTagSearch('rating:g,s,q');
      expect(result.ratings).toEqual(new Set(['g', 's', 'q']));
    });

    it('should parse multiple separate rating: tags', () => {
      const result = parseTagSearch('rating:g rating:s');
      expect(result.ratings).toEqual(new Set(['g', 's']));
    });

    it('should handle full rating names', () => {
      const result = parseTagSearch('rating:general');
      expect(result.ratings).toEqual(new Set(['g']));
    });

    it('should parse all rating variations', () => {
      const inputs = [
        'rating:general',
        'rating:sensitive',
        'rating:questionable',
        'rating:explicit',
      ];
      const expected = ['g', 's', 'q', 'e'];
      inputs.forEach((input, i) => {
        const result = parseTagSearch(input);
        expect(result.ratings).toEqual(new Set([expected[i]]));
      });
    });

    it('should be case-insensitive', () => {
      const result = parseTagSearch('RATING:G rating:S');
      expect(result.ratings).toEqual(new Set(['g', 's']));
    });

    it('should parse rating with tags', () => {
      const result = parseTagSearch('girl rating:s cat');
      expect(result.includeTags).toEqual(['girl', 'cat']);
      expect(result.ratings).toEqual(new Set(['s']));
    });
  });

  describe('file type filters (is:)', () => {
    it('should parse single type', () => {
      const result = parseTagSearch('is:png');
      expect(result.fileTypes).toEqual(new Set(['image/png']));
    });

    it('should parse jpg and jpeg', () => {
      const result1 = parseTagSearch('is:jpg');
      const result2 = parseTagSearch('is:jpeg');
      expect(result1.fileTypes).toEqual(new Set(['image/jpeg']));
      expect(result2.fileTypes).toEqual(new Set(['image/jpeg']));
    });

    it('should parse all supported types', () => {
      const result = parseTagSearch('is:png is:jpg is:webp is:gif is:svg');
      expect(result.fileTypes).toEqual(new Set([
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
        'image/svg+xml',
      ]));
    });

    it('should be case-insensitive', () => {
      const result = parseTagSearch('IS:PNG is:JPG');
      expect(result.fileTypes).toEqual(new Set(['image/png', 'image/jpeg']));
    });

    it('should parse is:unrated flag', () => {
      const result = parseTagSearch('is:unrated');
      expect(result.includeUnrated).toBe(true);
      expect(result.fileTypes.size).toBe(0);
    });

    it('should parse mixed is: tags', () => {
      const result = parseTagSearch('is:png is:unrated');
      expect(result.fileTypes).toEqual(new Set(['image/png']));
      expect(result.includeUnrated).toBe(true);
    });
  });

  describe('tag count filters', () => {
    describe('exact match', () => {
      it('should parse exact count', () => {
        const result = parseTagSearch('tagcount:2');
        expect(result.tagCount).toEqual({ operator: '=', value: 2 });
      });

      it('should parse exact count with tags', () => {
        const result = parseTagSearch('girl tagcount:5 cat');
        expect(result.includeTags).toEqual(['girl', 'cat']);
        expect(result.tagCount).toEqual({ operator: '=', value: 5 });
      });
    });

    describe('comparison operators', () => {
      it('should parse greater than', () => {
        const result = parseTagSearch('tagcount:>5');
        expect(result.tagCount).toEqual({ operator: '>', value: 5 });
      });

      it('should parse less than', () => {
        const result = parseTagSearch('tagcount:<3');
        expect(result.tagCount).toEqual({ operator: '<', value: 3 });
      });

      it('should parse greater than or equal', () => {
        const result = parseTagSearch('tagcount:>=2');
        expect(result.tagCount).toEqual({ operator: '>=', value: 2 });
      });

      it('should parse less than or equal', () => {
        const result = parseTagSearch('tagcount:<=10');
        expect(result.tagCount).toEqual({ operator: '<=', value: 10 });
      });
    });

    describe('range', () => {
      it('should parse range', () => {
        const result = parseTagSearch('tagcount:1..10');
        expect(result.tagCount).toEqual({ operator: 'range', min: 1, max: 10 });
      });

      it('should handle reversed range (min > max)', () => {
        const result = parseTagSearch('tagcount:10..1');
        expect(result.tagCount).toEqual({ operator: 'range', min: 1, max: 10 });
      });
    });

    describe('list', () => {
      it('should parse list of values', () => {
        const result = parseTagSearch('tagcount:1,3,5');
        expect(result.tagCount).toEqual({ operator: 'list', values: [1, 3, 5] });
      });

      it('should parse list with multiple values', () => {
        const result = parseTagSearch('tagcount:0,2,4,6,8');
        expect(result.tagCount).toEqual({ operator: 'list', values: [0, 2, 4, 6, 8] });
      });
    });

    it('should be case-insensitive', () => {
      const result = parseTagSearch('TAGCOUNT:>5');
      expect(result.tagCount).toEqual({ operator: '>', value: 5 });
    });
  });

  describe('complex combinations', () => {
    it('should parse all filter types together', () => {
      const result = parseTagSearch('girl cat or boy -dog rating:s is:png tagcount:>2');
      expect(result.includeTags).toEqual(['girl']);
      expect(result.orGroups).toEqual([['cat', 'boy']]);
      expect(result.excludeTags).toEqual(['dog']);
      expect(result.ratings).toEqual(new Set(['s']));
      expect(result.fileTypes).toEqual(new Set(['image/png']));
      expect(result.tagCount).toEqual({ operator: '>', value: 2 });
    });

    it('should handle multiple metatags of same type', () => {
      const result = parseTagSearch('rating:g,s is:png is:jpg tagcount:1..5');
      expect(result.ratings).toEqual(new Set(['g', 's']));
      expect(result.fileTypes).toEqual(new Set(['image/png', 'image/jpeg']));
      expect(result.tagCount).toEqual({ operator: 'range', min: 1, max: 5 });
    });

    it('should handle real-world query', () => {
      const result = parseTagSearch('anime girl long_hair or short_hair -realistic rating:g,s is:png is:jpg tagcount:3..10');
      expect(result.includeTags).toEqual(['anime', 'girl']);
      expect(result.orGroups).toEqual([['long_hair', 'short_hair']]);
      expect(result.excludeTags).toEqual(['realistic']);
      expect(result.ratings).toEqual(new Set(['g', 's']));
      expect(result.fileTypes).toEqual(new Set(['image/png', 'image/jpeg']));
      expect(result.tagCount).toEqual({ operator: 'range', min: 3, max: 10 });
    });
  });

  describe('edge cases', () => {
    it('should handle only metatags (no regular tags)', () => {
      const result = parseTagSearch('rating:g is:png tagcount:5');
      expect(result.includeTags).toEqual([]);
      expect(result.ratings).toEqual(new Set(['g']));
      expect(result.fileTypes).toEqual(new Set(['image/png']));
      expect(result.tagCount).toEqual({ operator: '=', value: 5 });
    });

    it('should handle invalid rating values', () => {
      const result = parseTagSearch('rating:x');
      // Invalid rating char, first char is 'x' which is not g/s/q/e
      // The regex should not match 'rating:x' at all
      expect(result.ratings.size).toBe(0);
    });

    it('should handle incomplete metatags', () => {
      const result1 = parseTagSearch('rating:');
      const result2 = parseTagSearch('tagcount:');
      const result3 = parseTagSearch('is:');
      // Incomplete metatags should not match regex
      expect(result1.ratings.size).toBe(0);
      expect(result2.tagCount).toBeNull();
      expect(result3.fileTypes.size).toBe(0);
    });

    it('should handle consecutive OR operators', () => {
      const result = parseTagSearch('girl or or cat');
      // 'or or' - first 'or' creates group ['girl', 'or'], second 'or' creates group ['or', 'cat']
      // This is weird but tests current behavior
      expect(result.orGroups.length).toBeGreaterThan(0);
    });

    it('should preserve underscores in tags', () => {
      const result = parseTagSearch('long_hair short_hair');
      expect(result.includeTags).toEqual(['long_hair', 'short_hair']);
    });

    it('should preserve special characters in tags', () => {
      const result = parseTagSearch('girl_(qualifier) cat:pet');
      expect(result.includeTags).toEqual(['girl_(qualifier)', 'cat:pet']);
    });
  });
});
