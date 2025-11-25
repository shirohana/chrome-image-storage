import { describe, it, expect } from 'vitest';
import { removeTagFromQuery } from '../src/viewer/tag-utils';

describe('removeTagFromQuery', () => {
  it('removes tag with following "or"', () => {
    expect(removeTagFromQuery('cat or girl', 'cat')).toBe('girl');
  });

  it('removes tag with preceding "or"', () => {
    expect(removeTagFromQuery('girl or cat', 'cat')).toBe('girl');
  });

  it('removes tag without affecting others', () => {
    expect(removeTagFromQuery('dog cat girl', 'cat')).toBe('dog girl');
  });

  it('handles tag at beginning', () => {
    expect(removeTagFromQuery('cat girl', 'cat')).toBe('girl');
  });

  it('handles tag at end', () => {
    expect(removeTagFromQuery('girl cat', 'cat')).toBe('girl');
  });

  it('handles only tag', () => {
    expect(removeTagFromQuery('cat', 'cat')).toBe('');
  });

  it('preserves "or" between other tags when removing middle tag', () => {
    expect(removeTagFromQuery('dog or cat or girl', 'cat')).toBe('dog or girl');
  });

  it('handles case-insensitive "or" operator', () => {
    expect(removeTagFromQuery('cat OR girl', 'cat')).toBe('girl');
    expect(removeTagFromQuery('cat Or girl', 'cat')).toBe('girl');
  });

  it('does not remove tag if not present', () => {
    expect(removeTagFromQuery('dog girl', 'cat')).toBe('dog girl');
  });

  it('handles multiple spaces', () => {
    expect(removeTagFromQuery('dog  cat  girl', 'cat')).toBe('dog girl');
  });

  it('handles tag appearing multiple times', () => {
    expect(removeTagFromQuery('cat dog cat', 'cat')).toBe('dog');
  });
});
