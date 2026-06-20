import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { ImageMetadata } from '../types';
import { state } from './state';
import { getOrCreateObjectURL } from './blobs';
import { formatFileSize } from './format';
import { getXAccountFromUrl } from './grouping';
import { parseTagSearch, sortTags } from './tag-utils';

// First migrated view component (SolidJS). It is the single source of truth for
// image-card markup. The legacy string pipeline still consumes cards as HTML, so
// createImageCardHTML() below renders this component to a detached node and returns
// its innerHTML — a temporary bridge until the render pipeline mounts nodes directly.

const RATING_CONFIG: Record<string, { label: string; color: string }> = {
  g: { label: 'G', color: '#28a745' }, // green
  s: { label: 'S', color: '#ffc107' }, // yellow
  q: { label: 'Q', color: '#fd7e14' }, // orange
  e: { label: 'E', color: '#dc3545' }, // red
};

export function ImageCard(props: { image: ImageMetadata }): JSX.Element {
  const image = props.image;
  const url = getOrCreateObjectURL(image.id);
  const date = new Date(image.savedAt).toLocaleString();
  const fileSize = formatFileSize(image.fileSize);
  const isSelected = state.selectedIds.has(image.id);
  const isTrash = state.currentView === 'trash';

  // Parse current tag search to highlight active tags and account.
  const tagSearchInput = document.getElementById('tag-search-input') as HTMLInputElement | null;
  const parsed = tagSearchInput && tagSearchInput.value ? parseTagSearch(tagSearchInput.value) : null;
  const activeTags = new Set<string>();
  if (parsed) {
    parsed.includeTags.forEach(tag => activeTags.add(tag));
    parsed.orGroups.forEach(group => group.forEach(tag => activeTags.add(tag)));
  }

  const xAccount = getXAccountFromUrl(image.pageUrl);
  const isAccountActive = !!(xAccount && parsed && parsed.accounts.has(xAccount));

  return (
    <div class={`image-card${isSelected ? ' selected' : ''}`} data-id={image.id}>
      <input
        type="checkbox"
        class="image-checkbox"
        data-id={image.id}
        attr:checked={isSelected ? '' : undefined}
      />
      {image.rating ? (
        <div class="rating-badge" style={{ 'background-color': RATING_CONFIG[image.rating].color }}>
          {RATING_CONFIG[image.rating].label}
        </div>
      ) : (
        <div class="rating-badge rating-badge-unrated">—</div>
      )}
      <img src={url} alt="Saved image" class="image-preview" data-image-id={image.id} />
      <div class="image-info">
        <div class="image-meta">
          <div class="image-meta__row"><strong>Saved:</strong> {date}</div>
          <div class="image-meta__row"><strong>Size:</strong> {fileSize}</div>
          <div class="image-meta__row"><strong>Dimensions:</strong> {image.width} × {image.height}</div>
          <div class="image-meta__row"><strong>Type:</strong> {image.mimeType}</div>
        </div>
        {image.tags && image.tags.length > 0 && (
          <div class="image-tags">
            {sortTags(image.tags).map(tag => (
              <span
                class={`image-tags__tag${activeTags.has(tag) ? ' image-tags__tag--active' : ''}`}
                data-tag={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {xAccount && (
          <button
            class={`image-account-btn${isAccountActive ? ' image-account-btn--active' : ''}`}
            data-account={xAccount}
            title={`Filter by @${xAccount}`}
          >
            @{xAccount}
          </button>
        )}
        <div class="image-url" title={image.pageUrl}>
          <strong>From:</strong>{' '}
          <a href={image.pageUrl} target="_blank" rel="noopener noreferrer" class="page-link">
            {image.pageTitle || image.pageUrl}
          </a>
        </div>
        <div class="image-actions">
          {isTrash ? (
            <>
              <button class="button button--sm button--primary image-actions__button restore-btn" data-id={image.id}>Restore</button>
              <button class="button button--sm button--danger image-actions__button permanent-delete-btn" data-id={image.id}>Delete Forever</button>
            </>
          ) : (
            <>
              <button class="button button--sm button--secondary image-actions__button download-btn" data-id={image.id}>Save</button>
              <button class="button button--sm button--danger image-actions__button delete-btn" data-id={image.id}>Delete</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Bridge for the legacy string-based render pipeline: render the component to a
// detached container and return its serialized HTML. Single source of truth = ImageCard.
export function createImageCardHTML(image: ImageMetadata): string {
  const container = document.createElement('div');
  const dispose = render(() => <ImageCard image={image} />, container);
  const html = container.innerHTML;
  dispose();
  return html;
}
