export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function extractArtistFromUrl(url: string): { artist?: string; source?: string } {
  const result: { artist?: string; source?: string } = {};

  // Pixiv
  const pixivUser = url.match(/pixiv\.net\/(?:en\/)?users\/(\d+)/);
  const pixivArtwork = url.match(/pixiv\.net\/(?:en\/)?artworks\/(\d+)/);
  if (pixivUser) {
    result.artist = `pixiv_user_${pixivUser[1]}`;
    result.source = url;
  } else if (pixivArtwork) {
    result.source = url;
  }

  // Twitter/X
  const twitter = url.match(/(?:twitter|x)\.com\/([^/]+)/);
  if (twitter && !['i', 'home', 'search'].includes(twitter[1])) {
    result.artist = twitter[1];
    result.source = url;
  }

  // Fanbox
  const fanbox = url.match(/([^.]+)\.fanbox\.cc/);
  if (fanbox) {
    result.artist = `${fanbox[1]}_fanbox`;
    result.source = url;
  }

  // DeviantArt
  const deviantart = url.match(/deviantart\.com\/([^/]+)/);
  if (deviantart) {
    result.artist = deviantart[1];
    result.source = url;
  }

  // ArtStation
  const artstation = url.match(/artstation\.com\/(?:artwork\/|[^/]+$)/);
  if (artstation) {
    result.source = url;
  }

  return result;
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | undefined;
  return function (...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => func(...args), wait);
  };
}
