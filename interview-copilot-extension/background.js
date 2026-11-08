// Opens the side panel from the toolbar icon / keyboard shortcut and relays messages
// between the meeting tab's content script and the panel.
//
// Tab audio capture is only allowed on tabs where the extension was "invoked" (activeTab):
// the icon click or the shortcut is that invocation, so both also tell the panel which tab
// is now capturable.

async function invoke(tab, { startListening = false } = {}) {
  if (!tab?.id) return;
  try { await chrome.sidePanel.open({ tabId: tab.id, windowId: tab.windowId }); } catch {}
  // Give the panel a moment to load if it was just opened.
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'copilot:invoked', tabId: tab.id, tabUrl: tab.url, startListening }).catch(() => {});
  }, 300);
}

chrome.runtime.onInstalled.addListener(() => {
  // We handle the click ourselves so it counts as invoking the extension on the active tab.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => invoke(tab));

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-listen') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  invoke(tab, { startListening: true });
});

// Content script -> side panel. The panel listens for copilot:question / copilot:caption.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || !message.type?.startsWith('copilot:') || !sender.tab) return;
  chrome.runtime.sendMessage({ ...message, tabId: sender.tab.id, tabUrl: sender.tab.url }).catch(() => {});
});
