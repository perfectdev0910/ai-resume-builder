importScripts('xlsx-writer.js', 'generator.js');

// Background service worker for AI Resume Builder

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default configuration
    chrome.storage.local.set({
      config: {
        apiUrl: 'https://ai-resume-builder-api-8aj2.onrender.com',
        dashboardUrl: 'https://ai-resume-builder-rtl9.vercel.app/'
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

// Context menu for quick actions. Guarded: without the "contextMenus" permission this API is
// undefined, and an unguarded call would abort the whole worker script — taking every listener
// registered below it down with it.
if (chrome.contextMenus) {
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
}

/* ------------------------------------------------------------------ */
/* Auto-collect support                                                */
/*                                                                     */
/* The loop runs in the Jobright tab (auto-collect.js) so it survives   */
/* the popup closing. Filtering, de-duplication, the API duplicate      */
/* check and storage all happen here, in the extension's own origin.    */
/* ------------------------------------------------------------------ */
const DEFAULT_API = 'https://ai-resume-builder-api-8aj2.onrender.com';
const duplicateCache = new Map();          // company (lowercased) -> boolean

function prettyCompanyName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed.replace(/\S+/g, (w) => (w.length <= 4 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
}

async function apiBase() {
  const { config } = await chrome.storage.local.get(['config']);
  return String(config?.apiUrl || DEFAULT_API).replace(/\/+$/, '').replace(/\/api$/i, '');
}

// Same rule as the Generate page: applied to this company within the last 30 days.
async function isDuplicateCompany(company) {
  const name = prettyCompanyName(company);
  if (!name) return false;
  const key = name.toLowerCase();
  if (duplicateCache.has(key)) return duplicateCache.get(key);
  try {
    const { authToken } = await chrome.storage.local.get(['authToken']);
    if (!authToken) return false;
    const res = await fetch(`${await apiBase()}/api/applications/check-duplicate?companyName=${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const data = await res.json().catch(() => ({}));
    const dup = Boolean(data.isDuplicate);
    duplicateCache.set(key, dup);
    return dup;
  } catch {
    return false;    // never block collection on a failed check
  }
}

async function getOptions() {
  const { collectOptions, autoCollect } = await chrome.storage.local.get(['collectOptions', 'autoCollect']);
  return {
    skipEasyApply: collectOptions?.collectSkipEasyApply !== false,
    skipDuplicates: collectOptions?.collectSkipDuplicates !== false,
    markApplied: collectOptions?.collectMarkApplied !== false,
    target: Number(autoCollect?.target) || 25,
    range: autoCollect?.range || 'any'
  };
}

// Decide whether a job is worth opening, using only what the card shows.
async function precheck(job) {
  const opts = await getOptions();
  const { collectedJobs } = await chrome.storage.local.get(['collectedJobs']);
  const jobs = Array.isArray(collectedJobs) ? collectedJobs : [];
  const key = job.jobId || job.url;

  if (jobs.some((j) => (j.jobId || j.url) === key)) return { skip: true, reason: 'already-collected' };
  if (opts.skipEasyApply && job.easyApply) return { skip: true, reason: 'easy-apply' };
  if (opts.skipDuplicates && job.company && await isDuplicateCompany(job.company)) return { skip: true, reason: 'duplicate' };
  return { skip: false };
}

async function addJob(job) {
  const opts = await getOptions();
  const { collectedJobs } = await chrome.storage.local.get(['collectedJobs']);
  const jobs = Array.isArray(collectedJobs) ? collectedJobs : [];
  const key = job.jobId || job.url;

  const existing = jobs.find((j) => (j.jobId || j.url) === key);
  if (existing) {
    if (!existing.jd && job.jd) {
      existing.jd = job.jd;
      await chrome.storage.local.set({ collectedJobs: jobs });
      return { added: false, updated: true, total: jobs.length, reason: 'already-collected' };
    }
    return { added: false, total: jobs.length, reason: 'already-collected' };
  }
  if (opts.skipEasyApply && job.easyApply) return { added: false, total: jobs.length, reason: 'easy-apply' };
  if (opts.skipDuplicates && job.company && await isDuplicateCompany(job.company)) return { added: false, total: jobs.length, reason: 'duplicate' };
  if (jobs.length >= opts.target) return { added: false, total: jobs.length, reason: 'target-reached' };

  jobs.push({ ...job, range: opts.range, source: 'auto', collectedAt: new Date().toISOString() });
  await chrome.storage.local.set({ collectedJobs: jobs });
  return { added: true, total: jobs.length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'auto:precheck') {
    precheck(message.job).then(sendResponse);
    return true;
  }
  if (message?.type === 'auto:add') {
    addJob(message.job).then(sendResponse);
    return true;
  }
  if (message?.type === 'auto:progress') {
    chrome.storage.local.get(['autoCollect']).then(({ autoCollect }) => {
      chrome.storage.local.set({ autoCollect: { ...(autoCollect || {}), ...message.progress } });
      sendResponse({ ok: true });
    });
    return true;
  }
  return undefined;
});
