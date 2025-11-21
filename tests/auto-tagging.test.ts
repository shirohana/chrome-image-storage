import { describe, it, expect } from 'vitest';
import { matchesRule, getAutoTags } from '../src/storage/tag-rules';
import type { TagRule } from '../src/storage/tag-rules';

describe('matchesRule', () => {
  describe('enabled/disabled rules', () => {
    it('should not match if rule is disabled', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Test',
        pattern: 'pixiv',
        isRegex: false,
        tags: ['tag1'],
        enabled: false,
      };
      expect(matchesRule('Pixiv Art', rule)).toBe(false);
    });

    it('should match if rule is enabled', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Test',
        pattern: 'pixiv',
        isRegex: false,
        tags: ['tag1'],
        enabled: true,
      };
      expect(matchesRule('Pixiv Art', rule)).toBe(true);
    });
  });

  describe('empty pattern (match all)', () => {
    it('should match any title with empty pattern', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Always Match',
        pattern: '',
        isRegex: false,
        tags: ['always'],
        enabled: true,
      };
      expect(matchesRule('Any Title', rule)).toBe(true);
      expect(matchesRule('', rule)).toBe(true);
      expect(matchesRule('Another Title', rule)).toBe(true);
    });
  });

  describe('plain text matching', () => {
    it('should match case-insensitive substring', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Pixiv',
        pattern: 'pixiv',
        isRegex: false,
        tags: ['pixiv'],
        enabled: true,
      };
      expect(matchesRule('Pixiv Art - Illustration', rule)).toBe(true);
      expect(matchesRule('PIXIV', rule)).toBe(true);
      expect(matchesRule('From pixiv.net', rule)).toBe(true);
    });

    it('should not match if substring not present', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Pixiv',
        pattern: 'pixiv',
        isRegex: false,
        tags: ['pixiv'],
        enabled: true,
      };
      expect(matchesRule('Twitter Art', rule)).toBe(false);
      expect(matchesRule('DeviantArt', rule)).toBe(false);
    });

    it('should handle empty page title', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Test',
        pattern: 'test',
        isRegex: false,
        tags: ['tag1'],
        enabled: true,
      };
      expect(matchesRule('', rule)).toBe(false);
    });

    it('should match special characters literally', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Parentheses',
        pattern: 'art (original)',
        isRegex: false,
        tags: ['original'],
        enabled: true,
      };
      expect(matchesRule('Pixiv art (original) by artist', rule)).toBe(true);
      expect(matchesRule('Pixiv art original by artist', rule)).toBe(false);
    });
  });

  describe('regex matching', () => {
    it('should match basic regex pattern', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Twitter or X',
        pattern: '^(Twitter|X\\.com)',
        isRegex: true,
        tags: ['twitter'],
        enabled: true,
      };
      expect(matchesRule('Twitter - @artist', rule)).toBe(true);
      expect(matchesRule('X.com - @artist', rule)).toBe(true);
      expect(matchesRule('From Twitter', rule)).toBe(false); // ^ requires start
    });

    it('should be case-insensitive by default', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Twitter',
        pattern: 'twitter',
        isRegex: true,
        tags: ['twitter'],
        enabled: true,
      };
      expect(matchesRule('Twitter Art', rule)).toBe(true);
      expect(matchesRule('TWITTER', rule)).toBe(true);
      expect(matchesRule('twitter', rule)).toBe(true);
    });

    it('should handle complex regex patterns', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Artwork ID',
        pattern: 'illust_id=\\d{8,}',
        isRegex: true,
        tags: ['pixiv', 'artwork'],
        enabled: true,
      };
      expect(matchesRule('Pixiv: illust_id=12345678', rule)).toBe(true);
      expect(matchesRule('Pixiv: illust_id=123', rule)).toBe(false); // Less than 8 digits
    });

    it('should handle regex with word boundaries', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Art word',
        pattern: '\\bart\\b',
        isRegex: true,
        tags: ['art'],
        enabled: true,
      };
      expect(matchesRule('art gallery', rule)).toBe(true);
      expect(matchesRule('article', rule)).toBe(false); // Not a word boundary
    });

    it('should handle invalid regex gracefully', () => {
      const rule: TagRule = {
        id: '1',
        name: 'Invalid',
        pattern: '[invalid',
        isRegex: true,
        tags: ['tag1'],
        enabled: true,
      };
      // Should not throw, should return false
      expect(matchesRule('Any Title', rule)).toBe(false);
    });

    it('should handle regex with special chars requiring escaping', () => {
      const rule: TagRule = {
        id: '1',
        name: 'URL pattern',
        pattern: 'example\\.com',
        isRegex: true,
        tags: ['example'],
        enabled: true,
      };
      expect(matchesRule('From example.com', rule)).toBe(true);
      expect(matchesRule('From exampleXcom', rule)).toBe(false);
    });
  });
});

describe('getAutoTags', () => {
  describe('no rules', () => {
    it('should return empty array with no rules', () => {
      const result = getAutoTags('Any Title', []);
      expect(result).toEqual([]);
    });
  });

  describe('single rule matching', () => {
    it('should return tags from matching rule', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Pixiv',
          pattern: 'pixiv',
          isRegex: false,
          tags: ['pixiv', 'artwork'],
          enabled: true,
        },
      ];
      const result = getAutoTags('Pixiv Art - Illustration', rules);
      expect(result).toEqual(['pixiv', 'artwork']);
    });

    it('should return empty array if no rules match', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Pixiv',
          pattern: 'pixiv',
          isRegex: false,
          tags: ['pixiv', 'artwork'],
          enabled: true,
        },
      ];
      const result = getAutoTags('Twitter Art', rules);
      expect(result).toEqual([]);
    });

    it('should ignore disabled rules', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Pixiv',
          pattern: 'pixiv',
          isRegex: false,
          tags: ['pixiv', 'artwork'],
          enabled: false,
        },
      ];
      const result = getAutoTags('Pixiv Art - Illustration', rules);
      expect(result).toEqual([]);
    });
  });

  describe('multiple rules matching', () => {
    it('should merge tags from all matching rules', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Pixiv',
          pattern: 'pixiv',
          isRegex: false,
          tags: ['pixiv', 'artwork'],
          enabled: true,
        },
        {
          id: '2',
          name: 'Illustration',
          pattern: 'illustration',
          isRegex: false,
          tags: ['illustration', 'digital_art'],
          enabled: true,
        },
      ];
      const result = getAutoTags('Pixiv Art - Illustration', rules);
      expect(result).toEqual(['pixiv', 'artwork', 'illustration', 'digital_art']);
    });

    it('should deduplicate tags from multiple rules', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Pixiv',
          pattern: 'pixiv',
          isRegex: false,
          tags: ['pixiv', 'artwork'],
          enabled: true,
        },
        {
          id: '2',
          name: 'Artwork',
          pattern: 'art',
          isRegex: false,
          tags: ['artwork', 'digital'],
          enabled: true,
        },
      ];
      const result = getAutoTags('Pixiv Art', rules);
      // 'artwork' appears in both rules but should only appear once
      expect(result).toEqual(['pixiv', 'artwork', 'digital']);
    });

    it('should apply only matching rules from mixed set', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Pixiv',
          pattern: 'pixiv',
          isRegex: false,
          tags: ['pixiv'],
          enabled: true,
        },
        {
          id: '2',
          name: 'Twitter',
          pattern: 'twitter',
          isRegex: false,
          tags: ['twitter'],
          enabled: true,
        },
        {
          id: '3',
          name: 'DeviantArt',
          pattern: 'deviantart',
          isRegex: false,
          tags: ['deviantart'],
          enabled: true,
        },
      ];
      const result = getAutoTags('Pixiv Art - Illustration', rules);
      expect(result).toEqual(['pixiv']);
    });
  });

  describe('always-apply rules (empty pattern)', () => {
    it('should apply empty-pattern rule to all images', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Always',
          pattern: '',
          isRegex: false,
          tags: ['imported'],
          enabled: true,
        },
      ];
      expect(getAutoTags('Pixiv Art', rules)).toEqual(['imported']);
      expect(getAutoTags('Twitter Post', rules)).toEqual(['imported']);
      expect(getAutoTags('', rules)).toEqual(['imported']);
    });

    it('should merge always-apply rule with specific rules', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Always',
          pattern: '',
          isRegex: false,
          tags: ['imported'],
          enabled: true,
        },
        {
          id: '2',
          name: 'Pixiv',
          pattern: 'pixiv',
          isRegex: false,
          tags: ['pixiv', 'artwork'],
          enabled: true,
        },
      ];
      const result = getAutoTags('Pixiv Art', rules);
      expect(result).toEqual(['imported', 'pixiv', 'artwork']);
    });
  });

  describe('mixed regex and plain text rules', () => {
    it('should apply both regex and plain text rules', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Pixiv (plain)',
          pattern: 'pixiv',
          isRegex: false,
          tags: ['site:pixiv'],
          enabled: true,
        },
        {
          id: '2',
          name: 'ID (regex)',
          pattern: 'illust_id=\\d+',
          isRegex: true,
          tags: ['has_id'],
          enabled: true,
        },
      ];
      const result = getAutoTags('Pixiv: illust_id=12345', rules);
      expect(result).toEqual(['site:pixiv', 'has_id']);
    });
  });

  describe('edge cases', () => {
    it('should handle rules with empty tag arrays', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'No tags',
          pattern: 'pixiv',
          isRegex: false,
          tags: [],
          enabled: true,
        },
      ];
      const result = getAutoTags('Pixiv Art', rules);
      expect(result).toEqual([]);
    });

    it('should preserve tag order from rules', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Rule1',
          pattern: 'art',
          isRegex: false,
          tags: ['tag1', 'tag2', 'tag3'],
          enabled: true,
        },
      ];
      const result = getAutoTags('Art Gallery', rules);
      expect(result).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle special characters in tags', () => {
      const rules: TagRule[] = [
        {
          id: '1',
          name: 'Special',
          pattern: 'pixiv',
          isRegex: false,
          tags: ['site:pixiv', 'rating:safe', 'type:illustration'],
          enabled: true,
        },
      ];
      const result = getAutoTags('Pixiv Art', rules);
      expect(result).toEqual(['site:pixiv', 'rating:safe', 'type:illustration']);
    });
  });
});
