import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatFileSize, extractArtistFromUrl, debounce } from '../src/viewer/format';

describe('formatFileSize', () => {
  it('formats bytes under 1KB as B', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats KB with one decimal', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats MB with one decimal', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('extractArtistFromUrl', () => {
  it('extracts pixiv user', () => {
    expect(extractArtistFromUrl('https://pixiv.net/en/users/12345')).toEqual({
      artist: 'pixiv_user_12345',
      source: 'https://pixiv.net/en/users/12345',
    });
  });

  it('sets source only for pixiv artwork (no artist)', () => {
    const r = extractArtistFromUrl('https://pixiv.net/artworks/999');
    expect(r.source).toBe('https://pixiv.net/artworks/999');
    expect(r.artist).toBeUndefined();
  });

  it('extracts twitter/x handle but skips reserved paths', () => {
    expect(extractArtistFromUrl('https://x.com/alice/status/1').artist).toBe('alice');
    expect(extractArtistFromUrl('https://twitter.com/bob').artist).toBe('bob');
    expect(extractArtistFromUrl('https://x.com/home').artist).toBeUndefined();
    expect(extractArtistFromUrl('https://x.com/search').artist).toBeUndefined();
  });

  it('extracts deviantart artist', () => {
    expect(extractArtistFromUrl('https://deviantart.com/carol/art/x').artist).toBe('carol');
  });

  it('extracts fanbox artist (pre-existing quirk: greedy capture includes protocol)', () => {
    // The fanbox regex ([^.]+)\.fanbox\.cc greedily grabs everything up to the
    // first dot, so the protocol leaks in. Documenting current behavior, not fixing
    // it here (behavior-preserving refactor). Bare-subdomain input works cleanly:
    expect(extractArtistFromUrl('https://someone.fanbox.cc/posts/1').artist).toBe('https://someone_fanbox');
    expect(extractArtistFromUrl('someone.fanbox.cc').artist).toBe('someone_fanbox');
  });

  it('returns empty object for unknown sources', () => {
    expect(extractArtistFromUrl('https://example.com/whatever')).toEqual({});
  });
});

describe('debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('invokes the function once after the wait, with the latest args', () => {
    vi.useFakeTimers();
    // debounce uses window.setTimeout; provide it in the node test env
    vi.stubGlobal('window', { setTimeout, clearTimeout });

    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced('a');
    debounced('b');
    debounced('c');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });
});
