import type { ImageMetadata } from '../types';
import type { GroupBy } from './grouping';

/**
 * Shared viewer state. A single mutable object imported by the viewer modules;
 * properties are mutated in place (the object reference is stable across imports).
 */
export const state = {
  images: [] as ImageMetadata[],
  filteredImages: [] as ImageMetadata[],
  loadedBlobs: new Map<string, Blob>(),
  sort: 'savedAt-desc',
  groupBy: 'none' as GroupBy,
  selectedIds: new Set<string>(),
  objectUrls: new Map<string, string>(),
  currentView: 'all' as 'all' | 'trash',
  lightboxActive: false,
  currentLightboxIndex: -1,
  previewPaneVisible: false,
  lastSelectedIndex: -1,
  selectionAnchor: -1,
  currentRenderToken: 0,
};
