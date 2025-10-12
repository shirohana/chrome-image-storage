import { saveImage, getImageCount } from '../storage/service';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-image',
    title: 'Save to Image Storage',
    contexts: ['image'],
  });
  updateBadge();
});

async function updateBadge() {
  const count = await getImageCount();
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#007bff' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function openOrFocusViewer() {
  const viewerUrl = chrome.runtime.getURL('src/viewer/index.html');
  const tabs = await chrome.tabs.query({ url: viewerUrl });

  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id!, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: viewerUrl });
  }
}

chrome.action.onClicked.addListener(() => {
  openOrFocusViewer();
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  openOrFocusViewer();
});

// Listen for badge update requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_BADGE') {
    updateBadge();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-image' && info.srcUrl && tab?.id) {
    const imageUrl = info.srcUrl;
    const pageUrl = info.pageUrl || tab.url || '';
    const pageTitle = tab.title || '';

    let imageId: string;

    try {
      // Try content script first (can access DOM for canvas capture)
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'CAPTURE_IMAGE',
        imageUrl: imageUrl,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      // Use captured blob from content script
      imageId = await saveImage(imageUrl, pageUrl, pageTitle, response.blob);
    } catch (contentScriptError) {
      // Content script failed, try background fetch with modified headers
      const ruleId = Math.floor(Date.now() / 1000); // Use seconds as integer ID
      try {
        const imageHost = new URL(imageUrl).host;

        // Add declarativeNetRequest rule to modify headers
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: [
            {
              id: ruleId,
              priority: 1,
              action: {
                type: 'modifyHeaders',
                requestHeaders: [
                  {
                    header: 'Referer',
                    operation: 'set',
                    value: pageUrl,
                  },
                ],
              },
              condition: {
                urlFilter: imageHost,
                resourceTypes: ['xmlhttprequest'],
              },
            },
          ],
          removeRuleIds: [],
        });

        // Fetch the image
        const response = await fetch(imageUrl);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();
        imageId = await saveImage(imageUrl, pageUrl, pageTitle, blob);
      } catch (fetchError) {
        // Both methods failed - show error notification
        const errorMsg = fetchError instanceof Error
          ? fetchError.message
          : 'Unknown error';

        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('src/icons/icon-48.png'),
          title: 'Failed to Save Image',
          message: `Could not save image: ${errorMsg}`,
        });
        return; // Exit early
      } finally {
        // Clean up the rule
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: [],
          removeRuleIds: [ruleId],
        }).catch(() => {
          // Ignore cleanup errors
        });
      }
    }

    // Update badge counter
    await updateBadge();

    // Check settings for system notifications
    const settings = await chrome.storage.local.get(['showNotifications']);
    const showNotifications = settings.showNotifications ?? false;

    if (showNotifications) {
      chrome.notifications.create(
        imageId,
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('src/icons/icon-48.png'),
          title: 'Image Saved',
          message: 'Image has been saved to your storage',
        }
      );
    }

    // Always send message to viewer for toast notification
    chrome.runtime.sendMessage({ type: 'IMAGE_SAVED', imageId }).catch(() => {
      // Viewer page not open, ignore error
    });
  }
});
