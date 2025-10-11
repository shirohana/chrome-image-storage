import { saveImage } from '../storage/service';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-image',
    title: 'Save to Image Storage',
    contexts: ['image'],
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/viewer/index.html') });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-image' && info.srcUrl && tab?.id) {
    const imageUrl = info.srcUrl;
    const pageUrl = info.pageUrl || tab.url || '';
    const pageTitle = tab.title || '';

    await saveImage(imageUrl, pageUrl, pageTitle);

    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/icons/icon-48.png'),
      title: 'Image Saved',
      message: 'Image has been saved to your storage',
    });
  }
});
