import { state } from './state';
import { showToast } from './toast';
import { extractArtistFromUrl } from './format';
import { sortTags } from './tag-utils';
import { getOrCreateObjectURL, loadImageBlob } from './blobs';

// ============================================
// Danbooru Upload Feature
// ============================================
//
// Upload flow:
// 1. User clicks "Upload to Danbooru" in preview pane
// 2. Modal opens with auto-filled metadata (tags, artist, source)
// 3. User reviews/edits and clicks "Upload to Danbooru"
// 4. Create upload with image URL → Danbooru downloads the image
// 5. Poll upload status until processing completes
// 6. Create post with tags/rating/source using upload_media_asset_id
// 7. Add artist commentary (title/description) as separate API call
// 8. Show success toast
//
// API Endpoints:
// - POST /uploads.json - Create upload from URL
// - GET /uploads/{id}.json - Check upload status
// - POST /posts.json - Create post from media asset
// - PUT /posts/{id}/artist_commentary/create_or_update.json - Add commentary

// Constants
const DANBOORU_POLL_MAX_ATTEMPTS = 20; // 40 seconds total
const DANBOORU_POLL_DELAY_MS = 2000;

interface DanbooruSettings {
  danbooruUrl: string;
  danbooruUsername: string;
  danbooruApiKey: string;
}

async function loadDanbooruSettings(): Promise<DanbooruSettings> {
  const result = await chrome.storage.local.get(['danbooruUrl', 'danbooruUsername', 'danbooruApiKey']);
  return {
    danbooruUrl: result.danbooruUrl || '',
    danbooruUsername: result.danbooruUsername || '',
    danbooruApiKey: result.danbooruApiKey || '',
  };
}

async function saveDanbooruSettings(settings: DanbooruSettings) {
  await chrome.storage.local.set(settings);
}

// DOM refs assigned by initDanbooru() (no import-time DOM access).
let danbooruModal: HTMLElement;
let danbooruSubmitBtn: HTMLButtonElement;

// Look up DOM refs, load settings, and wire up the Danbooru UI. Call once on page load.
export function initDanbooru(): void {
  // Settings inputs
  const danbooruUrlInput = document.getElementById('danbooru-url-input') as HTMLInputElement;
  const danbooruUsernameInput = document.getElementById('danbooru-username-input') as HTMLInputElement;
  const danbooruApiKeyInput = document.getElementById('danbooru-apikey-input') as HTMLInputElement;
  const danbooruApiKeyToggle = document.getElementById('danbooru-apikey-toggle')!;

  // Load settings on page load
  loadDanbooruSettings().then(settings => {
    danbooruUrlInput.value = settings.danbooruUrl;
    danbooruUsernameInput.value = settings.danbooruUsername;
    danbooruApiKeyInput.value = settings.danbooruApiKey;
  });

  // Save on change
  danbooruUrlInput.addEventListener('change', async () => {
    const settings = await loadDanbooruSettings();
    settings.danbooruUrl = danbooruUrlInput.value.trim();
    await saveDanbooruSettings(settings);
  });
  danbooruUsernameInput.addEventListener('change', async () => {
    const settings = await loadDanbooruSettings();
    settings.danbooruUsername = danbooruUsernameInput.value.trim();
    await saveDanbooruSettings(settings);
  });
  danbooruApiKeyInput.addEventListener('change', async () => {
    const settings = await loadDanbooruSettings();
    settings.danbooruApiKey = danbooruApiKeyInput.value.trim();
    await saveDanbooruSettings(settings);
  });

  // Toggle API key visibility
  danbooruApiKeyToggle.addEventListener('click', () => {
    const isPassword = danbooruApiKeyInput.type === 'password';
    danbooruApiKeyInput.type = isPassword ? 'text' : 'password';
  });

  // Modal control
  danbooruModal = document.getElementById('danbooru-upload-modal')!;
  const danbooruOverlay = document.querySelector('.danbooru-upload-overlay')!;
  const danbooruCloseBtn = document.querySelector('.danbooru-upload-close')!;
  const danbooruCancelBtn = document.getElementById('danbooru-upload-cancel-btn')!;
  danbooruSubmitBtn = document.getElementById('danbooru-upload-submit-btn') as HTMLButtonElement;

  danbooruOverlay.addEventListener('click', closeDanbooruModal);
  danbooruCloseBtn.addEventListener('click', closeDanbooruModal);
  danbooruCancelBtn.addEventListener('click', closeDanbooruModal);
  danbooruSubmitBtn.addEventListener('click', handleDanbooruSubmit);
}

let currentUploadImageId: string | null = null;

function closeDanbooruModal() {
  danbooruModal.classList.remove('active');
  currentUploadImageId = null;
}

export async function openDanbooruUploadModal(imageId: string) {
  const settings = await loadDanbooruSettings();

  if (!settings.danbooruUrl || !settings.danbooruUsername || !settings.danbooruApiKey) {
    alert('Please configure Danbooru settings first (click the ⚙ button)');
    return;
  }

  const image = state.images.find(img => img.id === imageId);
  if (!image) return;

  currentUploadImageId = imageId;

  // Load blob and set preview image
  await loadImageBlob(imageId);
  const previewImg = document.getElementById('danbooru-preview-image') as HTMLImageElement;
  const url = getOrCreateObjectURL(imageId);
  previewImg.src = url;

  // Auto-fill metadata
  const tagsInput = document.getElementById('danbooru-tags-input') as HTMLInputElement;
  const artistInput = document.getElementById('danbooru-artist-input') as HTMLInputElement;
  const copyrightInput = document.getElementById('danbooru-copyright-input') as HTMLInputElement;
  const characterInput = document.getElementById('danbooru-character-input') as HTMLInputElement;
  const sourceInput = document.getElementById('danbooru-source-input') as HTMLInputElement;
  const descriptionInput = document.getElementById('danbooru-description-input') as HTMLTextAreaElement;

  // Auto-fill tags from existing tags
  tagsInput.value = image.tags ? sortTags(image.tags).join(', ') : '';

  // Extract artist from URL
  const extracted = extractArtistFromUrl(image.pageUrl);
  artistInput.value = extracted.artist || '';
  sourceInput.value = extracted.source || image.pageUrl;

  // Fill description with page title
  descriptionInput.value = image.pageTitle || '';

  // Reset other fields
  copyrightInput.value = '';
  characterInput.value = '';

  // Pre-fill rating from image, or default to Questionable
  const ratingValue = image.rating || 'q';
  const ratingInput = document.querySelector(`input[name="danbooru-rating"][value="${ratingValue}"]`) as HTMLInputElement;
  if (ratingInput) ratingInput.checked = true;

  // Show modal
  danbooruModal.classList.add('active');

  // Reset scroll position after modal is visible
  requestAnimationFrame(() => {
    const danbooruBody = document.querySelector('.danbooru-upload-body') as HTMLElement;
    if (danbooruBody) {
      danbooruBody.scrollTop = 0;
    }
  });
}

// Upload to Danbooru
async function handleDanbooruSubmit() {
  if (!currentUploadImageId) return;

  const image = state.images.find(img => img.id === currentUploadImageId);
  if (!image) return;

  const settings = await loadDanbooruSettings();
  const tagsInput = document.getElementById('danbooru-tags-input') as HTMLInputElement;
  const artistInput = document.getElementById('danbooru-artist-input') as HTMLInputElement;
  const copyrightInput = document.getElementById('danbooru-copyright-input') as HTMLInputElement;
  const characterInput = document.getElementById('danbooru-character-input') as HTMLInputElement;
  const sourceInput = document.getElementById('danbooru-source-input') as HTMLInputElement;

  // Get selected rating from radio buttons
  const selectedRating = document.querySelector('input[name="danbooru-rating"]:checked') as HTMLInputElement;
  const rating = selectedRating ? selectedRating.value : 'g';

  // Combine all tags
  const generalTags = tagsInput.value.split(/\s+/).filter(Boolean);
  const artistTags = artistInput.value.trim() ? [artistInput.value.trim()] : [];
  const copyrightTags = copyrightInput.value.trim() ? [copyrightInput.value.trim()] : [];
  const characterTags = characterInput.value.trim() ? [characterInput.value.trim()] : [];

  const allTags = [...generalTags, ...artistTags, ...copyrightTags, ...characterTags];
  const tagString = allTags.join(' ');

  if (!tagString) {
    alert('Please add at least one tag');
    return;
  }

  // Disable button during upload
  danbooruSubmitBtn.disabled = true;
  danbooruSubmitBtn.textContent = 'Uploading...';

  try {
    // Step 1: Create upload with source URL
    const uploadFormData = new FormData();
    uploadFormData.append('upload[source]', image.imageUrl);
    uploadFormData.append('upload[referer_url]', image.pageUrl);

    const uploadResponse = await fetch(`${settings.danbooruUrl}/uploads.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${settings.danbooruUsername}:${settings.danbooruApiKey}`),
      },
      body: uploadFormData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}\n${errorText}`);
    }

    const uploadResult = await uploadResponse.json();
    console.log('Upload created:', uploadResult);
    console.log('Upload ID:', uploadResult.id, 'Status:', uploadResult.status, 'Post ID:', uploadResult.post_id);

    // Step 2: Wait for upload to be processed and get media asset
    if (uploadResult.id) {
      // Upload needs processing, poll for completion
      console.log('Upload needs processing, starting poll...');
      showToast('Upload created, waiting for processing...', 'success');
      const uploadMediaAssetId = await pollUploadStatus(settings, uploadResult.id);
      if (uploadMediaAssetId) {
        console.log('Got upload_media_asset_id, creating post with tags...');
        const descriptionInput = document.getElementById('danbooru-description-input') as HTMLTextAreaElement;
        const postId = await createDanbooruPost(
          settings,
          uploadMediaAssetId,
          tagString,
          rating,
          sourceInput.value
        );

        // Add artist commentary if we have title or description
        const pageTitle = image.pageTitle || '';
        const description = descriptionInput.value;
        if (postId && (pageTitle.trim() || description.trim())) {
          await createArtistCommentary(settings, postId, pageTitle, description);
        }

        closeDanbooruModal();
        showToast('Successfully uploaded and tagged!', 'success');
      } else {
        console.warn('Polling completed but no upload_media_asset_id returned');
        closeDanbooruModal();
        showToast('Upload created but could not auto-tag. Please tag manually on Danbooru.', 'success');
      }
    } else {
      console.error('Unexpected upload response format:', uploadResult);
      closeDanbooruModal();
      showToast('Upload created! Check Danbooru to complete.', 'success');
    }
  } catch (error) {
    console.error('Danbooru upload error:', error);
    showToast(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  } finally {
    danbooruSubmitBtn.disabled = false;
    danbooruSubmitBtn.textContent = 'Upload to Danbooru';
  }
}

async function pollUploadStatus(settings: DanbooruSettings, uploadId: number): Promise<number | null> {
  console.log(`Polling upload ${uploadId} for completion...`);

  for (let i = 0; i < DANBOORU_POLL_MAX_ATTEMPTS; i++) {
    await new Promise(resolve => setTimeout(resolve, DANBOORU_POLL_DELAY_MS));

    try {
      const response = await fetch(`${settings.danbooruUrl}/uploads/${uploadId}.json`, {
        headers: {
          'Authorization': 'Basic ' + btoa(`${settings.danbooruUsername}:${settings.danbooruApiKey}`),
        },
      });

      if (response.ok) {
        const upload = await response.json();
        const uploadMediaAssetId = upload.upload_media_assets?.[0]?.id;
        const mediaAssetId = upload.upload_media_assets?.[0]?.media_asset_id;
        console.log(`Poll attempt ${i + 1}/${DANBOORU_POLL_MAX_ATTEMPTS}: status="${upload.status}", upload_media_asset_id=${uploadMediaAssetId || 'null'}, media_asset_id=${mediaAssetId || 'null'}`);

        // Check for error status
        if (upload.status === 'error') {
          console.error('Upload processing error:', upload.error);
          return null;
        }

        // If status is completed and we have upload_media_asset_id, return it
        if (upload.status === 'completed' && uploadMediaAssetId && mediaAssetId) {
          console.log(`Upload completed! upload_media_asset_id: ${uploadMediaAssetId}, media_asset_id: ${mediaAssetId}`);
          return uploadMediaAssetId;
        }
      } else {
        console.error(`Failed to fetch upload status: ${response.status}`);
      }
    } catch (error) {
      console.error('Error polling upload status:', error);
    }
  }

  console.warn(`Upload polling timed out after ${DANBOORU_POLL_MAX_ATTEMPTS * DANBOORU_POLL_DELAY_MS / 1000} seconds`);
  return null;
}

async function createDanbooruPost(
  settings: DanbooruSettings,
  uploadMediaAssetId: number,
  tagString: string,
  rating: string,
  source: string
): Promise<number | null> {
  const postData: any = {
    upload_media_asset_id: uploadMediaAssetId,
  };

  if (tagString.trim()) {
    postData.tag_string = tagString.trim();
  }

  if (rating) {
    postData.rating = rating;
  }

  if (source.trim()) {
    postData.source = source.trim();
  }

  console.log('Creating post with JSON:', postData);

  const response = await fetch(`${settings.danbooruUrl}/posts.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${settings.danbooruUsername}:${settings.danbooruApiKey}`),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to create post:', response.status, errorText);
    throw new Error('Upload succeeded but post creation failed. Please create post manually on Danbooru.');
  }

  const post = await response.json();
  console.log('Post created successfully! Post ID:', post.id);
  console.log('Full post response:', post);
  return post.id;
}

async function createArtistCommentary(
  settings: DanbooruSettings,
  postId: number,
  originalTitle: string,
  originalDescription: string
) {
  const commentaryData: any = {};

  if (originalTitle.trim()) {
    commentaryData.original_title = originalTitle.trim();
  }

  if (originalDescription.trim()) {
    commentaryData.original_description = originalDescription.trim();
  }

  console.log('Creating artist commentary for post', postId, ':', commentaryData);

  try {
    const response = await fetch(`${settings.danbooruUrl}/posts/${postId}/artist_commentary/create_or_update.json`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Basic ' + btoa(`${settings.danbooruUsername}:${settings.danbooruApiKey}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commentaryData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to create artist commentary:', response.status, errorText);
      // Don't throw - commentary is optional, post was already created successfully
      return;
    }

    // Check if response has content before parsing JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const text = await response.text();
      if (text && text.trim()) {
        const commentary = JSON.parse(text);
        console.log('Artist commentary created successfully:', commentary);
      } else {
        console.log('Artist commentary created successfully (no response body)');
      }
    } else {
      console.log('Artist commentary created successfully (response status:', response.status, ')');
    }
  } catch (error) {
    console.error('Error creating artist commentary:', error);
    // Don't throw - commentary is optional, post was already created successfully
  }
}
