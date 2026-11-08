/**
 * Resume generation + Excel export, run entirely inside the extension.
 *
 * Loaded by background.js (importScripts), so the run survives the popup being closed.
 * An alarm keeps the service worker awake and resumes the loop if Chrome recycles it.
 * Progress lives in chrome.storage (`generateState`) for the popup to render.
 */
(() => {
  const KEEPALIVE_ALARM = 'generate-keepalive';
  const DEFAULT_API_URL = 'https://ai-resume-builder-api-8aj2.onrender.com';
  let generating = false;

  const pretty = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '';
    if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) return trimmed;
    return trimmed.replace(/\S+/g, (w) => (w.length <= 4 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  };

  const safeName = (name) => String(name || 'file').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'file';

  async function apiBaseUrl() {
    const { config } = await chrome.storage.local.get(['config']);
    return String(config?.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '').replace(/\/api$/i, '');
  }

  async function setState(patch) {
    const { generateState } = await chrome.storage.local.get(['generateState']);
    const next = { ...(generateState || {}), ...patch, at: Date.now() };
    await chrome.storage.local.set({ generateState: next });
    return next;
  }

  function toDataUrl(bytes, mime) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  }

  // Resolves once the download finishes, so the recorded path is final and nothing is left
  // in flight (an in-progress download dies with the browser).
  function waitForDownload(id, timeoutMs = 60000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = async () => {
        const [item] = await chrome.downloads.search({ id });
        if (!item) return resolve({ error: 'download vanished' });
        if (item.state === 'complete') return resolve({ filename: item.filename });
        if (item.state === 'interrupted') return resolve({ error: item.error || 'interrupted' });
        if (Date.now() - started > timeoutMs) return resolve({ filename: item.filename, error: 'timeout' });
        setTimeout(poll, 250);
      };
      poll();
    });
  }

  // The API only serves these to an authenticated request, so fetch here and hand
  // chrome.downloads a data: URL (service workers cannot create blob: URLs).
  async function downloadAuthed(url, token, filename) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const id = await chrome.downloads.download({
      url: toDataUrl(bytes, res.headers.get('content-type') || 'application/octet-stream'),
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });
    const done = await waitForDownload(id);
    if (done.error && !done.filename) throw new Error(done.error);
    return done.filename || filename;
  }

  const COLUMNS = [
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Company', key: 'company', width: 26 },
    { header: 'Role', key: 'role', width: 34 },
    { header: 'Match %', key: 'match', width: 9 },
    { header: 'Posted', key: 'posted', width: 14 },
    { header: 'Location', key: 'location', width: 20 },
    { header: 'Salary', key: 'salary', width: 18 },
    { header: 'JD link', key: 'link', width: 46 },
    { header: 'Resume PDF', key: 'resumePdf', width: 32 },
    { header: 'Resume DOCX', key: 'resumeDocx', width: 32 },
    { header: 'Cover letter PDF', key: 'coverPdf', width: 32 },
    { header: 'Cover letter DOCX', key: 'coverDocx', width: 32 },
    { header: 'Application', key: 'application', width: 13 },
    { header: 'Collected', key: 'collectedAt', width: 20 },
    { header: 'Generated', key: 'generatedAt', width: 20 },
    { header: 'Range', key: 'range', width: 11 },
    { header: 'Error', key: 'error', width: 50 }
  ];

  function fileCell(path) {
    if (!path) return '';
    return { text: String(path).split(/[\\/]/).pop(), link: `file:///${String(path).replace(/\\/g, '/')}` };
  }

  const stamp = (iso) => (iso ? String(iso).slice(0, 19).replace('T', ' ') : '');

  async function writeExcel(jobs, folder) {
    const rows = jobs.map((j) => ({
      status: j.genStatus || 'pending',
      company: j.company || '',
      role: j.genRole || j.title || '',
      match: typeof j.matchScore === 'number' ? j.matchScore : '',
      posted: j.posted || '',
      location: j.location || '',
      salary: j.salary || '',
      link: j.url ? { text: j.url, link: j.url } : '',
      resumePdf: fileCell(j.files?.resumePdf),
      resumeDocx: fileCell(j.files?.resumeDocx),
      coverPdf: fileCell(j.files?.coverPdf),
      coverDocx: fileCell(j.files?.coverDocx),
      application: j.applicationId ? `#${j.applicationId}` : '',
      collectedAt: stamp(j.collectedAt),
      generatedAt: stamp(j.generatedAt),
      range: j.range || '',
      error: j.genError || ''
    }));

    const bytes = self.XlsxWriter.buildXlsx({ sheetName: 'Jobs', columns: COLUMNS, rows });
    const id = await chrome.downloads.download({
      url: toDataUrl(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      filename: `${folder}/jobs.xlsx`,
      saveAs: false,
      conflictAction: 'uniquify'
    });
    const done = await waitForDownload(id);
    if (done.error && !done.filename) throw new Error(`could not save the Excel file: ${done.error}`);
    return done.filename || `${folder}/jobs.xlsx`;
  }

  async function run() {
    if (generating) return;
    generating = true;
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });

    try {
      const { authToken } = await chrome.storage.local.get(['authToken']);
      if (!authToken) { await setState({ status: 'error', note: 'Sign in first.' }); return; }

      const base = await apiBaseUrl();

      for (;;) {
        const { collectedJobs, generateState } = await chrome.storage.local.get(['collectedJobs', 'generateState']);
        if (generateState?.cancel) { await setState({ status: 'stopped', note: 'stopped by you' }); return; }

        const jobs = Array.isArray(collectedJobs) ? collectedJobs : [];
        const folder = generateState?.folder || 'AI-Resume-Builder';
        const template = generateState?.template || 'classic';
        const index = jobs.findIndex((j) => !j.genStatus || j.genStatus === 'pending');
        const done = jobs.filter((j) => j.genStatus && j.genStatus !== 'pending').length;

        if (index < 0) {
          const file = await writeExcel(jobs, folder);
          await setState({
            status: 'done', file, note: `Saved to ${file}`, done, total: jobs.length,
            generated: jobs.filter((j) => j.genStatus === 'generated').length,
            failed: jobs.filter((j) => j.genStatus === 'failed').length,
            skipped: jobs.filter((j) => j.genStatus === 'skipped').length
          });
          return;
        }

        const job = jobs[index];
        const company = pretty(job.company);
        await setState({ status: 'running', total: jobs.length, done, note: `${company || 'job'} — ${job.title || ''}` });

        if (!job.jd || job.jd.length < 200) {
          jobs[index] = { ...job, genStatus: 'skipped', genError: 'No job description captured' };
        } else if (!company) {
          jobs[index] = { ...job, genStatus: 'skipped', genError: 'No company name detected' };
        } else {
          try {
            const res = await fetch(`${base}/api/cv/generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({ jobDescription: job.jd, jdLink: job.url, companyName: company, force: true, template })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `generate failed (${res.status})`);

            const app = data.application || {};
            const files = {};
            if (app.id) {
              const stem = `${folder}/${safeName(app.companyName || company)}_${safeName(app.jobTitle || job.title || 'role')}_${app.id}`;
              const targets = [
                ['resumePdf', `${base}/api/cv/download/pdf/${app.id}`, `${stem}_resume.pdf`],
                ['resumeDocx', `${base}/api/cv/download/docx/${app.id}`, `${stem}_resume.docx`],
                ['coverPdf', `${base}/api/cv/download/cover-letter/pdf/${app.id}`, `${stem}_cover.pdf`],
                ['coverDocx', `${base}/api/cv/download/cover-letter/docx/${app.id}`, `${stem}_cover.docx`]
              ];
              const downloadErrors = [];
              for (const [key, url, filename] of targets) {
                try {
                  files[key] = await downloadAuthed(url, authToken, filename);
                } catch (err) {
                  if (key.startsWith('resume')) downloadErrors.push(`${key}: ${err.message}`);
                }
              }
              if (downloadErrors.length) files.errors = downloadErrors.join('; ');
            }
            jobs[index] = {
              ...job,
              genStatus: 'generated',
              genError: files.errors || '',
              applicationId: app.id || null,
              genRole: app.jobTitle || job.title || '',
              company: app.companyName || company,
              generatedAt: new Date().toISOString(),
              files
            };
          } catch (error) {
            jobs[index] = { ...job, genStatus: 'failed', genError: error.message };
          }
        }

        await chrome.storage.local.set({ collectedJobs: jobs });
      }
    } catch (error) {
      await setState({ status: 'error', note: error.message });
    } finally {
      generating = false;
      chrome.alarms.clear(KEEPALIVE_ALARM);
    }
  }

  // If Chrome recycled the worker mid-run, this brings it back and the loop picks up
  // where the stored job statuses left off.
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== KEEPALIVE_ALARM || generating) return;
    const { generateState } = await chrome.storage.local.get(['generateState']);
    if (generateState?.status === 'running' && !generateState?.cancel) run();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'generate:start') {
      (async () => {
        const { collectedJobs } = await chrome.storage.local.get(['collectedJobs']);
        const jobs = (Array.isArray(collectedJobs) ? collectedJobs : []).map((j) => (
          message.retry && (j.genStatus === 'failed' || (message.retry === 'all' && j.genStatus))
            ? { ...j, genStatus: 'pending', genError: '' }
            : j
        ));
        await chrome.storage.local.set({ collectedJobs: jobs });
        await setState({
          status: 'running',
          cancel: false,
          note: 'starting…',
          done: jobs.filter((j) => j.genStatus && j.genStatus !== 'pending').length,
          total: jobs.length,
          file: '',
          folder: `AI-Resume-Builder/batch-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`,
          template: message.template || 'classic'
        });
        run();
        sendResponse({ ok: true, total: jobs.length });
      })();
      return true;
    }

    if (message?.type === 'generate:stop') {
      setState({ cancel: true, status: 'stopping', note: 'finishing the current job…' }).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message?.type === 'generate:excel') {
      (async () => {
        try {
          const { collectedJobs, generateState } = await chrome.storage.local.get(['collectedJobs', 'generateState']);
          const file = await writeExcel(collectedJobs || [], generateState?.folder || 'AI-Resume-Builder');
          sendResponse({ ok: true, file });
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
      })();
      return true;
    }

    return undefined;
  });
})();
