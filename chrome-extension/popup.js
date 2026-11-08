// Default configuration
const DEFAULT_CONFIG = {
  apiUrl: 'https://ai-resume-builder-api-8aj2.onrender.com',
  dashboardUrl: 'https://ai-resume-builder-rtl9.vercel.app/'
};

function getApiBase() {
  const raw = String(config.apiUrl || DEFAULT_CONFIG.apiUrl).replace(/\/+$/, '');
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

function getServerOrigin() {
  return getApiBase().replace(/\/api$/, '');
}

function apiPath(path) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBase()}${suffix}`;
}

function resolveFileUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  let url;
  if (/^https?:\/\//i.test(pathOrUrl)) {
    url = pathOrUrl;
  } else {
    const origin = getServerOrigin();
    url = pathOrUrl.startsWith('/') ? `${origin}${pathOrUrl}` : `${origin}/uploads/${pathOrUrl}`;
  }
  // Local /uploads require auth; append token for <a href> downloads
  if (authToken && url.includes('/uploads/')) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}access_token=${encodeURIComponent(authToken)}`;
  }
  return url;
}

// Helper to sanitize filename
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').trim();
}

function prettyCompanyName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
    return trimmed;
  }
  return trimmed.replace(/\S+/g, (word) => {
    if (word.length <= 4 && word === word.toUpperCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

// State
let config = { ...DEFAULT_CONFIG };
let authToken = null;
let currentUser = null;
let currentJd = null;
let currentJdLink = null;
let currentJobTitle = null;
let currentCompanyName = null;
let pendingGenerateCallback = null;

// DOM Elements
const authView = document.getElementById('authView');
const mainView = document.getElementById('mainView');
const settingsView = document.getElementById('settingsView');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const settingsForm = document.getElementById('settingsForm');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await checkAuth();
  setupEventListeners();
});

// Load configuration from storage
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(['config', 'authToken', 'currentUser']);
    if (result.config) config = { ...DEFAULT_CONFIG, ...result.config };
    if (result.authToken) authToken = result.authToken;
    if (result.currentUser) currentUser = result.currentUser;
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

// Save configuration to storage
async function saveConfig() {
  try {
    await chrome.storage.local.set({ config });
  } catch (error) {
    console.error('Error saving config:', error);
  }
}

// Save auth data
async function saveAuth(token, user) {
  authToken = token;
  currentUser = user;
  try {
    await chrome.storage.local.set({ authToken, currentUser });
  } catch (error) {
    console.error('Error saving auth:', error);
  }
}

// Clear auth data
async function clearAuth() {
  authToken = null;
  currentUser = null;
  try {
    await chrome.storage.local.remove(['authToken', 'currentUser']);
  } catch (error) {
    console.error('Error clearing auth:', error);
  }
}

// Check authentication status
async function checkAuth() {
  if (authToken && currentUser) {
    try {
      const response = await fetch(apiPath('/auth/me'), {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (response.ok) {
        showMainView();
        return;
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    }
    await clearAuth();
  }
  showAuthView();
}

// View management
function showAuthView() {
  authView.classList.remove('hidden');
  mainView.classList.add('hidden');
  settingsView.classList.add('hidden');
}

function showMainView() {
  authView.classList.add('hidden');
  mainView.classList.remove('hidden');
  settingsView.classList.add('hidden');
  document.getElementById('userName').textContent = currentUser?.full_name || 'User';
}

function showSettingsView() {
  authView.classList.add('hidden');
  mainView.classList.add('hidden');
  settingsView.classList.remove('hidden');
  document.getElementById('apiUrl').value = config.apiUrl;
  document.getElementById('dashboardUrl').value = config.dashboardUrl;
}

// Setup event listeners
// Some builds of popup.html don't contain every optional control; binding defensively keeps
// one missing element from aborting the rest of the wiring.
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
  return Boolean(el);
}

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      if (tab.dataset.tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
      } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
      }
    });
  });

  // Login form
  loginForm.addEventListener('submit', handleLogin);

  // Register form
  registerForm.addEventListener('submit', handleRegister);

  // Settings
  on('settingsBtn', 'click', showSettingsView);
  on('cancelSettings', 'click', () => {
    if (authToken) showMainView();
    else showAuthView();
  });
  settingsForm.addEventListener('submit', handleSaveSettings);

  // Logout
  on('logoutBtn', 'click', handleLogout);

  // Collect jobs
  on('collectBtn', 'click', handleCollect);
  on('exportCollectedBtn', 'click', exportCollected);
  on('clearCollectedBtn', 'click', clearCollected);
  on('collectTarget', 'change', renderCollectStats);
  for (const id of ['collectSkipEasyApply', 'collectSkipDuplicates', 'collectMarkApplied']) {
    on(id, 'change', saveCollectOptions);
  }
  loadCollectOptions();
  on('autoStartBtn', 'click', startAutoCollect);
  on('autoStopBtn', 'click', stopAutoCollect);
  watchAutoProgress();
  on('genStartBtn', 'click', () => startGeneration(false));
  on('genRetryBtn', 'click', () => startGeneration(true));
  on('genStopBtn', 'click', stopGeneration);
  on('genExcelBtn', 'click', downloadExcelAgain);
  renderCollectStats();

  // Scrape button
  on('scrapeBtn', 'click', handleScrape);

  // Generate button
  on('generateBtn', 'click', () => handleGenerate(false));

  // Manual JD input
  on('manualJd', 'input', (e) => {
    currentJd = e.target.value;
    updateGenerateButton();
  });

  on('manualJdLink', 'input', (e) => {
    currentJdLink = e.target.value;
  });

  // Quick links
  on('openDashboardLink', 'click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: config.dashboardUrl });
  });

  on('viewHistoryLink', 'click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${config.dashboardUrl}/history` });
  });

  on('editProfileLink', 'click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${config.dashboardUrl}/profile` });
  });

  on('dashboardLink', 'click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: config.dashboardUrl });
  });

  // Duplicate modal buttons
  on('cancelDuplicate', 'click', hideDuplicateModal);
  on('proceedDuplicate', 'click', () => {
    hideDuplicateModal();
    if (pendingGenerateCallback) {
      pendingGenerateCallback();
    }
  });

  // Update state when scraped fields change
  document.getElementById('scrapedJobTitle')?.addEventListener('input', (e) => {
    currentJobTitle = e.target.value;
  });
  document.getElementById('scrapedCompanyName')?.addEventListener('input', (e) => {
    currentCompanyName = e.target.value;
  });
  document.getElementById('manualCompanyName')?.addEventListener('input', (e) => {
    currentCompanyName = e.target.value;
  });
  ['scrapedCompanyName', 'manualCompanyName'].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('blur', () => {
      const normalized = prettyCompanyName(input.value);
      if (normalized !== input.value) input.value = normalized;
      currentCompanyName = normalized;
    });
    input.addEventListener('paste', (e) => {
      const pasted = e.clipboardData?.getData('text');
      if (!pasted) return;
      e.preventDefault();
      input.value = prettyCompanyName(pasted);
      currentCompanyName = input.value;
    });
  });
}

// Handle login
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch(apiPath('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');

    await saveAuth(data.token, data.user);
    showMainView();
  } catch (error) {
    alert(error.message);
  }
}

// Handle register
async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const full_name = document.getElementById('regName').value;

  try {
    const response = await fetch(apiPath('/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Registration failed');

    if (data.requiresApproval || !data.token) {
      alert(data.message || 'Registration successful. Your account is pending admin approval.');
      document.querySelector('.tab[data-tab="login"]')?.click();
      return;
    }

    await saveAuth(data.token, data.user);
    showMainView();
    chrome.tabs.create({ url: `${config.dashboardUrl}/profile` });
  } catch (error) {
    alert(error.message);
  }
}

// Handle logout
async function handleLogout() {
  await clearAuth();
  showAuthView();
}

// Handle save settings
async function handleSaveSettings(e) {
  e.preventDefault();
  config.apiUrl = document.getElementById('apiUrl').value || DEFAULT_CONFIG.apiUrl;
  config.dashboardUrl = document.getElementById('dashboardUrl').value || DEFAULT_CONFIG.dashboardUrl;
  await saveConfig();
  alert('Settings saved!');
  if (authToken) showMainView();
  else showAuthView();
}

// Handle scrape
/* ------------------------------------------------------------------ */
/* Collect jobs: read the job cards on the page you are browsing,       */
/* de-duplicate against previous runs, and store them for the CLI.      */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Generate resumes + Excel. The run happens in the background worker,  */
/* so it continues after this popup closes.                             */
/* ------------------------------------------------------------------ */
// Progress notes contain company names and file paths taken from the page, so they are
// escaped before they go anywhere near innerHTML.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function send(message) {
  return new Promise((resolve) => {
    try { chrome.runtime.sendMessage(message, (r) => { void chrome.runtime.lastError; resolve(r || {}); }); }
    catch { resolve({}); }
  });
}

async function startGeneration(retry) {
  const jobs = await getCollected();
  const pending = jobs.filter((j) => !j.genStatus || j.genStatus === 'pending' || (retry && j.genStatus === 'failed'));
  if (!jobs.length) { renderGenProgress({ status: 'error', note: 'Collect some jobs first.' }); return; }
  if (!pending.length) { renderGenProgress({ status: 'error', note: 'Nothing left to generate — use "Download Excel again" for the report.' }); return; }
  const template = document.getElementById('genTemplate')?.value || 'classic';
  await send({ type: 'generate:start', template, retry: retry ? 'failed' : false });
  renderGenProgress({ status: 'running', note: 'starting…', done: 0, total: jobs.length });
  setGenButtons(true);
}

async function stopGeneration() {
  await send({ type: 'generate:stop' });
}

async function downloadExcelAgain() {
  const result = await send({ type: 'generate:excel' });
  renderGenProgress(result.ok
    ? { status: 'done', note: `Saved to ${result.file}` }
    : { status: 'error', note: result.error || 'Could not write the Excel file' });
}

function setGenButtons(running) {
  const start = document.getElementById('genStartBtn');
  const stop = document.getElementById('genStopBtn');
  if (!start || !stop) return;
  start.classList.toggle('hidden', running);
  stop.classList.toggle('hidden', !running);
}

function renderGenProgress(p) {
  const el = document.getElementById('genProgress');
  if (!el) return;
  if (!p || !p.status) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.className = `auto-progress ${p.status === 'error' ? 'error' : (p.status === 'done' || p.status === 'stopped') ? 'done' : ''}`;
  const total = p.total || 0;
  const pct = total ? Math.min(100, Math.round(((p.done || 0) / total) * 100)) : 0;
  const label = p.status === 'running' ? 'Generating…'
    : p.status === 'stopping' ? 'Stopping…'
    : p.status === 'stopped' ? 'Stopped'
    : p.status === 'error' ? 'Error' : 'Finished';
  const summary = p.status === 'done'
    ? `${p.generated || 0} generated${p.failed ? `, ${p.failed} failed` : ''}${p.skipped ? `, ${p.skipped} skipped` : ''}`
    : `${p.done || 0} / ${total}`;
  el.innerHTML = `<b>${label}</b> ${summary}` +
    (total ? `<div class="bar"><span style="width:${pct}%"></span></div>` : '') +
    (p.note ? `<div class="note">${esc(p.note)}</div>` : '');

  const retry = document.getElementById('genRetryBtn');
  if (retry) retry.classList.toggle('hidden', !(p.status === 'done' && p.failed));
}

async function refreshGenProgress() {
  const { generateState } = await chrome.storage.local.get(['generateState']);
  renderGenProgress(generateState);
  setGenButtons(generateState?.status === 'running' || generateState?.status === 'stopping');
}

/* ------------------------------------------------------------------ */
/* Auto-collect: the loop runs in the job board tab, so it keeps going  */
/* after this popup closes. Here we start/stop it and show progress.    */
/* ------------------------------------------------------------------ */
let autoProgressTimer = null;

async function startAutoCollect() {
  const btn = document.getElementById('autoStartBtn');
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Open the job board in a normal tab first.');

    const target = Math.max(1, Number(document.getElementById('collectTarget').value) || 25);
    const range = document.getElementById('collectRange').value;
    const already = (await getCollected()).length;

    await saveCollectOptions();
    await chrome.storage.local.set({
      autoCollect: { status: 'running', note: 'starting…', collected: already, target, visited: 0, counts: {}, range, tabId: tab.id, at: Date.now() }
    });

    // Options are read by the injected loop from the page's window object.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [{ target, alreadyCollected: already, markApplied: optionOn('collectMarkApplied'), delayMs: 1500 }],
      function: (opts) => { window.__autoCollectOptions = opts; }
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['auto-collect.js'] });

    setAutoButtons(true);
    renderAutoProgress({ status: 'running', note: 'starting…', collected: already, target, counts: {} });
  } catch (error) {
    setCollectStats(error.message, 'warn');
  } finally {
    btn.disabled = false;
  }
}

async function stopAutoCollect() {
  const { autoCollect } = await chrome.storage.local.get(['autoCollect']);
  const tabId = autoCollect?.tabId;
  if (tabId != null) {
    try { await chrome.tabs.sendMessage(tabId, { type: 'auto:stop' }); } catch { /* tab gone */ }
  }
  await chrome.storage.local.set({ autoCollect: { ...(autoCollect || {}), status: 'stopped', note: 'stopped by you' } });
  setAutoButtons(false);
}

function setAutoButtons(running) {
  const start = document.getElementById('autoStartBtn');
  const stop = document.getElementById('autoStopBtn');
  if (!start || !stop) return;
  start.classList.toggle('hidden', running);
  stop.classList.toggle('hidden', !running);
}

function renderAutoProgress(p) {
  const el = document.getElementById('autoProgress');
  if (!el) return;
  if (!p || !p.status) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.className = `auto-progress ${p.status === 'error' ? 'error' : (p.status === 'done' || p.status === 'stopped') ? 'done' : ''}`;
  const target = p.target || 1;
  const pct = Math.min(100, Math.round(((p.collected || 0) / target) * 100));
  const c = p.counts || {};
  const parts = [];
  if (c.easyApply) parts.push(`${c.easyApply} Easy Apply`);
  if (c.duplicate) parts.push(`${c.duplicate} already applied`);
  if (c.seen) parts.push(`${c.seen} already collected`);
  if (c.noJd) parts.push(`${c.noJd} without description`);
  const label = p.status === 'running' ? 'Collecting…' : p.status === 'stopped' ? 'Stopped' : p.status === 'error' ? 'Error' : 'Finished';
  el.innerHTML = `<b>${label}</b> ${p.collected || 0} / ${target} · ${p.visited || 0} opened` +
    `<div class="bar"><span style="width:${pct}%"></span></div>` +
    (parts.length ? `<div class="note">skipped: ${parts.join(' · ')}${c.applied ? ` · marked applied: ${c.applied}` : ''}</div>` : (c.applied ? `<div class="note">marked applied: ${c.applied}</div>` : '')) +
    (p.note ? `<div class="note">${esc(p.note)}</div>` : '');
}

async function refreshAutoProgress() {
  const { autoCollect } = await chrome.storage.local.get(['autoCollect']);
  renderAutoProgress(autoCollect);
  const running = autoCollect?.status === 'running';
  setAutoButtons(running);
  if (!running) renderCollectStats();
  return running;
}

function watchAutoProgress() {
  clearInterval(autoProgressTimer);
  refreshAutoProgress();
  refreshGenProgress();
  autoProgressTimer = setInterval(() => { refreshAutoProgress(); refreshGenProgress(); }, 700);
}

const COLLECT_OPTION_IDS = ['collectSkipEasyApply', 'collectSkipDuplicates', 'collectMarkApplied'];

async function loadCollectOptions() {
  const { collectOptions } = await chrome.storage.local.get(['collectOptions']);
  const opts = collectOptions || {};
  for (const id of COLLECT_OPTION_IDS) {
    const el = document.getElementById(id);
    if (el && opts[id] !== undefined) el.checked = Boolean(opts[id]);
  }
}

async function saveCollectOptions() {
  const opts = {};
  for (const id of COLLECT_OPTION_IDS) {
    const el = document.getElementById(id);
    if (el) opts[id] = el.checked;
  }
  await chrome.storage.local.set({ collectOptions: opts });
}

function optionOn(id) {
  const el = document.getElementById(id);
  return el ? el.checked : true;
}

/**
 * Same rule as the Generate page: a company counts as a duplicate when you already
 * applied to it within the last 30 days. Answers are cached for this popup session.
 */
const duplicateCache = new Map();
async function isDuplicateCompany(company) {
  const name = prettyCompanyName(company);
  if (!name) return false;
  const key = name.toLowerCase();
  if (duplicateCache.has(key)) return duplicateCache.get(key);
  try {
    const response = await fetch(apiPath(`/applications/check-duplicate?companyName=${encodeURIComponent(name)}`), {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const data = await response.json().catch(() => ({}));
    const dup = Boolean(data.isDuplicate);
    duplicateCache.set(key, dup);
    return dup;
  } catch {
    return false;   // never block collection on a failed check
  }
}

/**
 * Clicks the job board's own "Applied" control for the job whose description we just
 * captured — the same click you would make by hand. Best effort: returns why it failed.
 */
function markAppliedInPage() {
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const APPLIED_RE = /^(i\s*)?(have\s*)?applied$|^mark(ed)?\s*(as)?\s*applied$|^i applied$/i;
  const ALREADY_RE = /\b(applied|application sent|you applied)\b/i;

  const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
    .filter((el) => {
      const t = clean(el.textContent);
      if (!t || t.length > 30) return false;
      if (!APPLIED_RE.test(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

  if (!candidates.length) {
    const page = clean(document.body.innerText).slice(0, 4000);
    return { ok: false, reason: ALREADY_RE.test(page) ? 'already-applied-or-no-button' : 'no-applied-button' };
  }

  // Prefer a real button over a label.
  const target = candidates.find((el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') || candidates[0];
  const label = clean(target.textContent);
  const disabled = target.disabled || target.getAttribute('aria-disabled') === 'true' || /applied\b/i.test(target.className || '');
  if (disabled) return { ok: true, already: true, label };
  target.click();
  return { ok: true, label };
}

async function markAppliedOnBoard(tabId) {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId }, function: markAppliedInPage });
    return results?.[0]?.result || { ok: false, reason: 'no-result' };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function getCollected() {
  const { collectedJobs } = await chrome.storage.local.get(['collectedJobs']);
  return Array.isArray(collectedJobs) ? collectedJobs : [];
}

async function setCollected(jobs) {
  await chrome.storage.local.set({ collectedJobs: jobs });
}

function setCollectStats(text, kind = '') {
  const el = document.getElementById('collectStats');
  el.textContent = text;
  el.className = `collect-stats ${kind}`;
}

async function renderCollectStats() {
  const jobs = await getCollected();
  const target = Number(document.getElementById('collectTarget').value) || 0;
  if (!jobs.length) { setCollectStats('No jobs collected yet.'); return; }
  const withJd = jobs.filter((j) => j.jd && j.jd.length > 200).length;
  const done = target && jobs.length >= target;
  setCollectStats(
    `${jobs.length}${target ? ` / ${target}` : ''} jobs collected · ${withJd} with a job description` +
    (done ? ' · target reached — press Generate resumes & Excel below.' : ' · keep browsing and collect again.'),
    done ? 'ok' : ''
  );
}

async function handleCollect() {
  const btn = document.getElementById('collectBtn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Collecting…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const target = Math.max(1, Number(document.getElementById('collectTarget').value) || 25);
    const range = document.getElementById('collectRange').value;

    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js'] });
    const payload = results?.[0]?.result;
    if (!payload || !Array.isArray(payload.jobs)) throw new Error('Could not read any job cards on this page.');

    const skipEasyApply = optionOn('collectSkipEasyApply');
    const skipDuplicates = optionOn('collectSkipDuplicates');
    const markApplied = optionOn('collectMarkApplied');

    const existing = await getCollected();
    const seen = new Set(existing.map((j) => j.jobId || j.url));
    let added = 0;
    let updated = 0;
    let easySkipped = 0;
    let dupSkipped = 0;
    let newJdCaptured = false;

    for (const job of payload.jobs) {
      const key = job.jobId || job.url;

      if (seen.has(key)) {
        // Fill in the JD if we now have it (you opened the job after collecting the card).
        const prev = existing.find((j) => (j.jobId || j.url) === key);
        if (prev && !prev.jd && job.jd) {
          prev.jd = job.jd;
          updated++;
          if (key === payload.openJobId) newJdCaptured = true;
        }
        continue;
      }
      if (existing.length + added >= target) break;
      if (skipEasyApply && job.easyApply) { easySkipped++; continue; }
      if (skipDuplicates && await isDuplicateCompany(job.company)) { dupSkipped++; continue; }

      seen.add(key);
      existing.push({ ...job, range, source: payload.host, collectedAt: new Date().toISOString() });
      added++;
      if (job.jd && key === payload.openJobId) newJdCaptured = true;
    }

    await setCollected(existing);

    // Mark the open job as applied on the board once we have its description.
    let appliedNote = '';
    if (markApplied && newJdCaptured) {
      const result = await markAppliedOnBoard(tab.id);
      appliedNote = result.ok
        ? (result.already ? ' · already marked applied on the board' : ' · marked applied on the board')
        : ` · could not mark applied (${result.reason})`;
    }

    await renderCollectStats();
    const filtered = [];
    if (easySkipped) filtered.push(`${easySkipped} LinkedIn Easy Apply`);
    if (dupSkipped) filtered.push(`${dupSkipped} already applied in the last 30 days`);
    const filteredNote = filtered.length ? ` · ignored ${filtered.join(' and ')}` : '';

    if (!added && !updated) {
      setCollectStats(
        `Nothing new on this page${filteredNote || ` — all ${payload.jobs.length} jobs were already collected`}. Scroll or change the filter, then collect again.${appliedNote}`,
        'warn'
      );
    } else {
      const jobsWithoutJd = existing.filter((j) => !j.jd).length;
      setCollectStats(
        `+${added} new${updated ? `, ${updated} descriptions filled` : ''} · ${existing.length} / ${target} collected` +
        filteredNote +
        (jobsWithoutJd ? ` · ${jobsWithoutJd} still need a description (open them, then collect again)` : ' · all have descriptions') +
        appliedNote,
        existing.length >= target ? 'ok' : ''
      );
    }
  } catch (error) {
    setCollectStats(error.message, 'warn');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function exportCollected() {
  const jobs = await getCollected();
  if (!jobs.length) { setCollectStats('Nothing to export yet.', 'warn'); return; }
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), jobs }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: `collected-jobs-${new Date().toISOString().slice(0, 10)}.json`, saveAs: true });
  setCollectStats(`Exported ${jobs.length} jobs.`, 'ok');
}

async function clearCollected() {
  if (!confirm('Clear all collected jobs? This also forgets which ones were already collected.')) return;
  await setCollected([]);
  await renderCollectStats();
}

async function handleScrape() {
  const btn = document.getElementById('scrapeBtn');
  btn.disabled = true;
  btn.textContent = 'Scraping...';

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentJdLink = tab.url;

    // Inject content script and get JD
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: scrapeJobDescription
    });

    if (results && results[0] && results[0].result) {
      const { jobDescription, jobTitle, companyName, url } = results[0].result;
      currentJd = jobDescription;
      currentJobTitle = jobTitle;
      currentCompanyName = prettyCompanyName(companyName);
      currentJdLink = url || tab.url;

      document.getElementById('scrapedInfo').classList.remove('hidden');
      document.getElementById('scrapedJobTitle').value = jobTitle || '';
      document.getElementById('scrapedCompanyName').value = currentCompanyName || '';
      document.getElementById('scrapedJobLink').value = currentJdLink || '';
      document.getElementById('jdContent').value = jobDescription;

      updateGenerateButton();
    } else {
      throw new Error('Could not detect job description on this page');
    }
  } catch (error) {
    alert(error.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      Scrape Job Description
    `;
  }
}

// Scrape function to be injected into the page
function scrapeJobDescription() {
  // Common job description selectors for various job sites
  const selectors = [
    // LinkedIn
    '.jobs-description__content',
    '.jobs-box__html-content',
    // Indeed
    '#jobDescriptionText',
    '.jobsearch-jobDescriptionText',
    // Glassdoor
    '.jobDescriptionContent',
    '#JobDescriptionContainer',
    // Monster
    '.job-description',
    // ZipRecruiter
    '.job_description',
    // Workday
    '[data-automation-id="jobPostingDescription"]',
    // Greenhouse
    '#content .content',
    // Lever
    '.posting-page .content',
    // Generic
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[id*="job-description"]',
    '[id*="jobDescription"]',
    'article.job',
    '.job-details',
    '.description'
  ];

  let jobDescription = '';
  let jobTitle = '';
  let companyName = '';

  // Try to find job title
  const titleSelectors = [
    '.jobs-unified-top-card__job-title',
    '.jobsearch-JobInfoHeader-title',
    '.job-title',
    '[class*="job-title"]',
    'h1'
  ];

  for (const selector of titleSelectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim()) {
      jobTitle = el.textContent.trim();
      break;
    }
  }

  // Try to find company name
  const companySelectors = [
    // LinkedIn
    '.jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.job-details-jobs-unified-top-card__company-name a',
    // Indeed
    '.jobsearch-InlineCompanyRating-companyHeader',
    '[data-testid="inlineHeader-companyName"]',
    '.jobsearch-CompanyInfoContainer a',
    // Glassdoor
    '.css-87uc0g',
    '.employer-name',
    '[data-test="employer-name"]',
    // Monster
    '.company-name',
    // ZipRecruiter
    '.hiring_company_text',
    // Workday
    '[data-automation-id="jobPostingCompanyName"]',
    // Greenhouse
    '.company-name',
    // Lever
    '.posting-categories .sort-by-time',
    // Generic
    '[class*="company-name"]',
    '[class*="companyName"]',
    '[class*="employer"]',
    '[data-company]',
    '.company'
  ];

  for (const selector of companySelectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim()) {
      companyName = el.textContent.trim();
      break;
    }
  }

  // Try to find job description
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim().length > 100) {
      jobDescription = el.textContent.trim();
      break;
    }
  }

  // Fallback: get main content
  if (!jobDescription) {
    const main = document.querySelector('main') || document.querySelector('article') || document.body;
    jobDescription = main.textContent.trim().substring(0, 10000);
  }

  // Clean up whitespace
  jobDescription = jobDescription.replace(/\s+/g, ' ').trim();

  return { jobDescription, jobTitle, companyName };
}

// Update generate button state
function updateGenerateButton() {
  const btn = document.getElementById('generateBtn');
  const jdContent = document.getElementById('jdContent')?.value || '';
  const manualJd = document.getElementById('manualJd')?.value || '';
  
  btn.disabled = btn.dataset.generating === 'true' || !(currentJd || jdContent || manualJd);
}

// Show duplicate warning modal
function showDuplicateModal(companyName, callback) {
  const modal = document.getElementById('duplicateModal');
  document.getElementById('duplicateMessage').textContent = 
    `You have already applied to "${companyName}" in the last 30 days. Are you sure you want to proceed?`;
  modal.classList.remove('hidden');
  pendingGenerateCallback = callback;
}

// Hide duplicate modal
function hideDuplicateModal() {
  document.getElementById('duplicateModal').classList.add('hidden');
  pendingGenerateCallback = null;
}

// Handle generate
async function handleGenerate(skipDuplicateCheck = false) {
  const btn = document.getElementById('generateBtn');
  const statusSection = document.getElementById('statusSection');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const resultSection = document.getElementById('resultSection');
  const errorSection = document.getElementById('errorSection');

  // Get JD content and company name
  const jdContent = document.getElementById('jdContent')?.value || 
                    document.getElementById('manualJd')?.value || 
                    currentJd;
  
  const companyName = prettyCompanyName(
    document.getElementById('scrapedCompanyName')?.value ||
    document.getElementById('manualCompanyName')?.value ||
    currentCompanyName ||
    ''
  );

  const jobTitle = document.getElementById('scrapedJobTitle')?.value || currentJobTitle || '';
  const jdLink = document.getElementById('scrapedJobLink')?.value || 
                 document.getElementById('manualJdLink')?.value || 
                 currentJdLink || '';

  if (!jdContent) {
    alert('Please scrape or enter a job description first');
    return;
  }

  if (btn.dataset.generating === 'true') return;

  // Show loading
  btn.dataset.generating = 'true';
  btn.disabled = true;
  statusSection.classList.remove('hidden');
  loadingIndicator.classList.remove('hidden');
  resultSection.classList.add('hidden');
  errorSection.classList.add('hidden');

  try {
    const response = await fetch(apiPath('/cv/generate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        jobDescription: jdContent,
        jdLink: jdLink,
        jobTitle: jobTitle,
        companyName: companyName,
        force: skipDuplicateCheck === true
      })
    });

    const data = await response.json();
    if (response.status === 409 && data.isDuplicate) {
      loadingIndicator.classList.add('hidden');
      statusSection.classList.add('hidden');
      showDuplicateModal(companyName, () => handleGenerate(true));
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Failed to generate documents');

    // Show result
    loadingIndicator.classList.add('hidden');
    resultSection.classList.remove('hidden');

    // Set resume download links
    document.getElementById('downloadResumeDoc').href = resolveFileUrl(data.application.cvDocUrl);
    document.getElementById('downloadResumePdf').href = resolveFileUrl(data.application.cvPdfUrl);

    const coverLetterSection = document.getElementById('coverLetterResult');
    const hasCoverLetter = data.application.coverLetterDocUrl || data.application.coverLetterPdfUrl;
    if (coverLetterSection) {
      coverLetterSection.classList.toggle('hidden', !hasCoverLetter);
    }

    document.getElementById('downloadCoverLetterDoc').href = resolveFileUrl(data.application.coverLetterDocUrl);
    document.getElementById('downloadCoverLetterPdf').href = resolveFileUrl(data.application.coverLetterPdfUrl);

    if (data.warning) {
      document.getElementById('errorSection').classList.remove('hidden');
      document.getElementById('errorMessage').textContent = data.warning;
    }

    // Set download file names (sanitized for valid filenames)
    const fullName = sanitizeFilename(currentUser?.full_name || 'Resume');
    document.getElementById('downloadResumeDoc').download = `${fullName}_Resume.docx`;
    document.getElementById('downloadResumePdf').download = `${fullName}_Resume.pdf`;
    document.getElementById('downloadCoverLetterDoc').download = `${fullName}_Cover_Letter.docx`;
    document.getElementById('downloadCoverLetterPdf').download = `${fullName}_Cover_Letter.pdf`;

  } catch (error) {
    loadingIndicator.classList.add('hidden');
    errorSection.classList.remove('hidden');
    document.getElementById('errorMessage').textContent = error.message;
  } finally {
    btn.dataset.generating = 'false';
    btn.disabled = false;
  }
}
