// Background service worker for AI Resume Builder

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default configuration
    chrome.storage.local.set({
      config: {
        apiUrl: 'http://localhost:3000',
        dashboardUrl: 'http://localhost:5173'
      }
    });
    console.log('AI Resume Builder extension installed');
  }
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getAuthToken') {
    chrome.storage.local.get(['authToken'], (result) => {
      sendResponse({ token: result.authToken });
    });
    return true; // Required for async response
  }

  if (message.action === 'openDashboard') {
    chrome.storage.local.get(['config'], (result) => {
      const dashboardUrl = result.config?.dashboardUrl || 'http://localhost:5173';
      chrome.tabs.create({ url: dashboardUrl });
    });
  }

  if (message.action === 'notify') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: message.title || 'AI Resume Builder',
      message: message.message
    });
  }
});

// Context menu for quick actions
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'scrapeJD',
    title: 'Scrape Job Description',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'scrapeJD') {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        // Trigger scraping
        chrome.runtime.sendMessage({ action: 'triggerScrape' });
      }
    });
  }
});
