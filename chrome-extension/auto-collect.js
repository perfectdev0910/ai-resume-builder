/**
 * Auto-collect (content script).
 *
 * Drives the job list in the tab you already have open: opens each job in turn, waits for its
 * description to render, hands it to the extension (which applies the Easy-Apply / duplicate /
 * already-collected filters), optionally clicks the board's own "Applied" control, then moves on.
 * Scrolls to load more when the visible cards run out.
 *
 * The loop lives in the page so it keeps running while the popup is closed. Progress is reported
 * through the background worker; press Stop in the popup (or close the tab) to end it.
 */
(() => {
  if (window.__autoCollect && window.__autoCollect.running) {
    return { ok: false, reason: 'already-running' };
  }

  const state = window.__autoCollect || (window.__autoCollect = {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const rand = (min, max) => min + Math.random() * (max - min);

  /* ---------------------------------------------------------------- */
  /* page helpers (mirrors collector.js, kept standalone on purpose)    */
  /* ---------------------------------------------------------------- */
  function jobIdFromHref(href) {
    if (!href) return '';
    try {
      const u = new URL(href, location.origin);
      if (u.origin !== location.origin) return '';
      const m = u.pathname.match(/\/jobs?\/(?:info|detail|view)\/([\w-]+)/i);
      if (m) return m[1];
      return u.searchParams.get('jobId') || u.searchParams.get('job_id') || u.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function jobLinks() {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const id = jobIdFromHref(a.getAttribute('href'));
      if (!id || seen.has(id)) continue;
      const r = a.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      seen.add(id);
      out.push({ id, link: a });
    }
    return out;
  }

  function cardFor(link) {
    const countJobs = (el) => {
      const ids = new Set();
      for (const a of el.querySelectorAll('a[href]')) {
        const id = jobIdFromHref(a.getAttribute('href'));
        if (id) ids.add(id);
      }
      return ids.size;
    };
    let best = link;
    let el = link;
    for (let i = 0; i < 10 && el.parentElement && el.parentElement !== document.body; i++) {
      const parent = el.parentElement;
      if (countJobs(parent) > 1) break;
      if (clean(parent.textContent).length > 1500) break;
      el = parent;
      best = el;
      if (/card|item|result|listing|row/i.test(String(best.className || '')) && clean(best.textContent).length > 60) break;
    }
    return best;
  }

  const MATCH_RE = /(\d{1,3})\s*%\s*(?:match|fit)?|\b(?:match|fit)\s*(?:score)?\s*[:\-]?\s*(\d{1,3})\s*%/i;
  const POSTED_RE = /\b(\d+\s*(?:minute|min|hour|hr|day|week|month)s?\s+ago|just posted|today|yesterday|new)\b/i;
  const SALARY_RE = /(\$\s?\d[\d,.]*\s*(?:k|K)?(?:\s*[-–—to]+\s*\$?\s?\d[\d,.]*\s*(?:k|K)?)?(?:\s*(?:\/|per\s)?\s*(?:yr|year|hour|hr|mo|month))?)/;
  const LOCATION_RE = /\b([A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+)*,\s*(?:[A-Z]{2}|[A-Z][a-z]+))\b|\b(remote|hybrid|on-?site)\b/i;
  const EASY_APPLY_RE = /\beasy\s*apply\b/i;
  const LINKEDIN_JOB_RE = /linkedin\.com\/(?:jobs|job)\//i;

  function fieldsFrom(el, fallbackTitle) {
    const t = clean(el.textContent).slice(0, 2500);
    const title = clean(el.querySelector('h1, h2, h3, [class*="title" i]')?.textContent) || fallbackTitle || '';
    let company = clean(el.querySelector('[class*="company" i], [data-company], [class*="employer" i]')?.textContent);
    if (!company) {
      const parts = clean(el.innerText || el.textContent).split('\n').map(clean).filter(Boolean);
      const idx = parts.findIndex((p) => p && title && p.includes(title.slice(0, 20)));
      company = idx >= 0 ? parts[idx + 1] || '' : parts[1] || '';
    }
    const match = t.match(MATCH_RE);
    const posted = t.match(POSTED_RE);
    const salary = t.match(SALARY_RE);
    const loc = t.match(LOCATION_RE);
    let applyUrl = '';
    for (const a of el.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (jobIdFromHref(href)) continue;
      if (LINKEDIN_JOB_RE.test(href) || /\bapply\b/i.test(clean(a.textContent))) {
        applyUrl = href;
        if (LINKEDIN_JOB_RE.test(href)) break;
      }
    }
    return {
      title: title.slice(0, 200),
      company: company.slice(0, 120),
      matchScore: match ? Number(match[1] || match[2]) : null,
      posted: posted ? posted[0] : '',
      salary: salary ? clean(salary[1]).slice(0, 80) : '',
      location: loc ? clean(loc[0]).slice(0, 80) : '',
      applyUrl,
      easyApply: EASY_APPLY_RE.test(t) || (LINKEDIN_JOB_RE.test(applyUrl) && EASY_APPLY_RE.test(t))
    };
  }

  function detailPane() {
    const candidates = ['[class*="job-detail" i]', '[class*="jobDetail" i]', '[class*="description" i]', '[class*="job-desc" i]', 'article', 'main'];
    let best = null;
    let bestLen = 0;
    for (const sel of candidates) {
      for (const el of document.querySelectorAll(sel)) {
        const len = clean(el.innerText || el.textContent).length;
        if (len > bestLen && len < 60000) { best = el; bestLen = len; }
      }
      if (bestLen > 400) break;
    }
    return best;
  }

  function detailText() {
    const el = detailPane();
    return el ? clean(el.innerText || el.textContent).slice(0, 12000) : '';
  }

  const APPLIED_RE = /^(i\s*)?(have\s*)?applied$|^mark(ed)?\s*(as)?\s*applied$/i;

  function clickApplied() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]')).filter((el) => {
      const t = clean(el.textContent);
      if (!t || t.length > 30 || !APPLIED_RE.test(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!candidates.length) return { ok: false, reason: 'no-applied-button' };
    const target = candidates[0];
    if (target.disabled || target.getAttribute('aria-disabled') === 'true') return { ok: true, already: true };
    target.click();
    return { ok: true };
  }

  /* ---------------------------------------------------------------- */
  /* loop                                                              */
  /* ---------------------------------------------------------------- */
  const send = (message) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(message, (r) => { void chrome.runtime.lastError; resolve(r || {}); }); }
    catch { resolve({}); }
  });

  async function waitForDetail(jobId, previousText, timeoutMs = 9000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const text = detailText();
      const urlId = jobIdFromHref(location.href);
      const looksNew = text.length > 300 && text !== previousText;
      if (looksNew && (!urlId || urlId === jobId)) return text;
      await sleep(250);
    }
    return detailText();
  }

  function scrollContainerOf(el) {
    let node = el;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 40) return node;
      node = node.parentElement;
    }
    return null;
  }

  async function loadMore() {
    const links = jobLinks();
    const before = links.length;
    const lastLink = links.length ? links[links.length - 1].link : null;

    // Bringing the last card into view is what triggers lazy loading on most boards, and it
    // works whether the list scrolls inside a pane or with the window.
    if (lastLink) {
      try { lastLink.scrollIntoView({ block: 'end', behavior: 'smooth' }); } catch {}
      await sleep(600);
      const container = scrollContainerOf(lastLink);
      if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await sleep(1600);
    if (jobLinks().length > before) return true;

    // Some layouts keep the list in a pane that only reacts to its own scroll event.
    for (const el of document.querySelectorAll('div, section, main, ul')) {
      const style = getComputedStyle(el);
      if (!/auto|scroll/.test(style.overflowY)) continue;
      if (el.scrollHeight <= el.clientHeight + 10) continue;
      if (!el.querySelector('a[href]')) continue;
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    await sleep(1600);
    if (jobLinks().length > before) return true;

    // No infinite scroll: try a "next page" control.
    const next = Array.from(document.querySelectorAll('button, a, [role="button"]')).find((el) => {
      const t = clean(el.textContent);
      const label = clean(el.getAttribute('aria-label'));
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled &&
        (/^next( page)?$/i.test(t) || /next page/i.test(label) || (t === '›' || t === '>' || t === '→'));
    });
    if (next) {
      next.click();
      await sleep(2500);
      return jobLinks().length > 0;
    }
    return false;
  }

  async function run(options) {
    const target = Math.max(1, Number(options.target) || 25);
    const delayMs = Math.max(400, Number(options.delayMs) || 1500);
    const markApplied = options.markApplied !== false;

    state.running = true;
    state.stop = false;
    const processed = new Set();
    let collected = Number(options.alreadyCollected) || 0;
    let visited = 0;
    let emptyRounds = 0;
    let lastDetail = '';
    const counts = { added: 0, easyApply: 0, duplicate: 0, seen: 0, noJd: 0, applied: 0 };

    const report = (status, note) => send({
      type: 'auto:progress',
      progress: { status, note: note || '', collected, target, visited, counts, at: Date.now() }
    });

    await report('running', 'starting');

    try {
      while (!state.stop && collected < target) {
        const links = jobLinks().filter((j) => !processed.has(j.id));

        if (!links.length) {
          const more = await loadMore();
          emptyRounds = more ? 0 : emptyRounds + 1;
          if (emptyRounds >= 2) { await report('done', 'no more jobs on this page'); break; }
          await report('running', 'loading more jobs…');
          continue;
        }
        emptyRounds = 0;

        for (const { id, link } of links) {
          if (state.stop || collected >= target) break;
          processed.add(id);
          visited++;

          const card = cardFor(link);
          const cardFields = fieldsFrom(card, clean(link.textContent));

          // Cheap filters first — no need to open a job we will not keep.
          const pre = await send({ type: 'auto:precheck', job: { jobId: id, ...cardFields } });
          if (pre?.skip) {
            if (pre.reason === 'easy-apply') counts.easyApply++;
            else if (pre.reason === 'duplicate') counts.duplicate++;
            else if (pre.reason === 'already-collected') counts.seen++;
            await report('running', `skipped ${cardFields.company || 'job'} (${pre.reason})`);
            continue;
          }

          try { link.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
          await sleep(200);
          link.click();

          const jd = await waitForDetail(id, lastDetail);
          lastDetail = jd;

          const pane = detailPane();
          const detailFields = pane ? fieldsFrom(pane, cardFields.title) : {};
          const job = {
            jobId: id,
            url: new URL(link.getAttribute('href'), location.origin).toString(),
            ...cardFields,
            title: cardFields.title || detailFields.title || '',
            company: cardFields.company || detailFields.company || '',
            easyApply: cardFields.easyApply || detailFields.easyApply || false,
            jd: jd && jd.length > 300 ? jd : ''
          };

          if (!job.jd) counts.noJd++;

          const result = await send({ type: 'auto:add', job });
          if (result?.added) {
            collected = result.total;
            counts.added++;
            if (markApplied && job.jd) {
              const applied = clickApplied();
              if (applied.ok && !applied.already) counts.applied++;
              await sleep(300);
            }
            await report('running', `${job.company || 'job'} — ${job.title || ''}`);
          } else {
            if (result?.reason === 'easy-apply') counts.easyApply++;
            else if (result?.reason === 'duplicate') counts.duplicate++;
            else if (result?.reason === 'already-collected') counts.seen++;
            await report('running', `skipped ${job.company || 'job'} (${result?.reason || 'filtered'})`);
          }

          // Human pace: a little jitter so it is not a metronome.
          await sleep(rand(delayMs, delayMs * 1.6));
        }
      }

      await report(state.stop ? 'stopped' : (collected >= target ? 'done' : 'done'), state.stop ? 'stopped by you' : 'finished');
    } catch (error) {
      await report('error', error.message);
    } finally {
      state.running = false;
    }
  }

  // Control channel from the popup / background.
  if (!state.listening) {
    state.listening = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'auto:stop') { state.stop = true; sendResponse({ ok: true }); }
      else if (message?.type === 'auto:status') sendResponse({ running: Boolean(state.running) });
      return true;
    });
  }

  const options = window.__autoCollectOptions || {};
  run(options);
  return { ok: true, started: true };
})();
