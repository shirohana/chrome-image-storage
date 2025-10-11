import { saveImage } from '../storage/service';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-image',
    title: 'Save to Image Storage',
    contexts: ['image'],
  });
});

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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-image' && info.srcUrl && tab?.id) {
    const imageUrl = info.srcUrl;
    const pageUrl = info.pageUrl || tab.url || '';
    const pageTitle = tab.title || '';

    const imageId = await saveImage(imageUrl, pageUrl, pageTitle);

    chrome.notifications.create(
      imageId,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('src/icons/icon-48.png'),
        title: 'Image Saved',
        message: 'Image has been saved to your storage',
      }
    );

    chrome.runtime.sendMessage({ type: 'IMAGE_SAVED', imageId }).catch(() => {
      // Viewer page not open, ignore error
    });
  }
});
