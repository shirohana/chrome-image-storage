// Capture image data from DOM to avoid CORS issues
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_IMAGE') {
    const img = findImageElement(message.imageUrl);

    if (img) {
      captureImageAsBlob(img)
        .then(blob => {
          sendResponse({ blob, width: img.naturalWidth, height: img.naturalHeight });
        })
        .catch(error => {
          sendResponse({ error: error.message });
        });
    } else {
      sendResponse({ error: 'Image not found in DOM' });
    }

    return true; // Keep message channel open for async response
  }
});

function findImageElement(url: string): HTMLImageElement | null {
  const images = document.querySelectorAll('img');

  // Try exact match first
  for (const img of images) {
    if (img.src === url || img.currentSrc === url) {
      return img;
    }
  }

  // Normalize and compare URLs
  try {
    const normalizedUrl = new URL(url, window.location.href).href;

    for (const img of images) {
      try {
        const imgSrc = img.src || img.currentSrc;
        if (!imgSrc) continue;

        const imgUrl = new URL(imgSrc, window.location.href).href;

        // Try exact normalized match
        if (imgUrl === normalizedUrl) {
          return img;
        }

        // Try without query parameters (some sites use cache busters)
        const urlWithoutQuery = imgUrl.split('?')[0];
        const targetWithoutQuery = normalizedUrl.split('?')[0];
        if (urlWithoutQuery === targetWithoutQuery) {
          return img;
        }
      } catch (e) {
        // Skip invalid URLs
        continue;
      }
    }
  } catch (e) {
    // Invalid URL, can't normalize
  }

  return null;
}

async function captureImageAsBlob(img: HTMLImageElement): Promise<Blob> {
  // Wait for image to be fully loaded
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      setTimeout(() => reject(new Error('Image load timeout')), 5000);
    });
  }

  // Check if image has valid dimensions
  if (img.naturalWidth === 0 || img.naturalHeight === 0) {
    throw new Error('Image has no dimensions');
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Draw image to canvas
  ctx.drawImage(img, 0, 0);

  // Convert to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to convert canvas to blob'));
      }
    });
  });
}
