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

    const imageId = await saveImage(imageUrl, pageUrl, pageTitle);

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
