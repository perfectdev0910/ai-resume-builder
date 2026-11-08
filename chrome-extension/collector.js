/**
 * Job collector (content script, injected on demand from the popup).
 *
 * Reads the job cards that are already rendered on the page you are browsing and returns
 * them to the popup. It does not navigate, paginate, log in, or call any site API — you
 * control the browsing and the date filter; this only reads what is on your screen.
 */
(() => {
  const MAX_TEXT = 12000;

  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const text = (el) => (el ? clean(el.textContent) : '');

  // Jobright job links look like /jobs/info/<id> (list) or ?jobId=<id>.
  // Only the board's own links count — an external apply URL (e.g. a LinkedIn job page)
  // must never be mistaken for a job card of the site you are browsing.
  function jobIdFromHref(href) {
    if (!href) return '';
    try {
      const u = new URL(href, location.origin);
      if (u.origin !== location.origin) return '';
      const m = u.pathname.match(/\/jobs?\/(?:info|detail|view)\/([\w-]+)/i);
      if (m) return m[1];
      const q = u.searchParams.get('jobId') || u.searchParams.get('job_id') || u.searchParams.get('id');
      return q || '';
    } catch {
      return '';
    }
  }

  function absolute(href) {
    try { return new URL(href, location.origin).toString(); } catch { return href || ''; }
  }

  // The nearest ancestor that is still ONE job card: climb while the block contains only
  // this job's link — as soon as a parent holds another job link we have hit the list.
  function cardFor(link) {
    const jobLinkIds = (el) => {
      const ids = new Set();
      for (const a of el.querySelectorAll('a[href]')) {
        const id = jobIdFromHref(a.getAttribute('href'));
        if (id) ids.add(id);
      }
      return ids;
    };
    let best = link;
    let el = link;
    for (let i = 0; i < 10 && el.parentElement && el.parentElement !== document.body; i++) {
      const parent = el.parentElement;
      if (jobLinkIds(parent).size > 1) break;
      if (clean(parent.textContent).length > 1500) break;
      el = parent;
      best = el;
      if (/card|item|result|listing|row/i.test(String(best.className || '')) && clean(best.textContent).length > 60) break;
    }
    return best;
  }

  const EASY_APPLY_RE = /\beasy\s*apply\b/i;
  const LINKEDIN_JOB_RE = /linkedin\.com\/(?:jobs|job)\//i;

  // Jobright surfaces LinkedIn Easy Apply roles with an "Easy Apply" badge and/or a LinkedIn
  // apply link. Those are excluded from collection.
  function applyInfo(card) {
    const t = clean(card.textContent);
    let applyUrl = '';
    for (const a of card.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      const label = clean(a.textContent);
      if (LINKEDIN_JOB_RE.test(href) || /\bapply\b/i.test(label)) {
        if (!jobIdFromHref(href)) { applyUrl = absolute(href); if (LINKEDIN_JOB_RE.test(href)) break; }
      }
    }
    const easyApply = EASY_APPLY_RE.test(t) || (LINKEDIN_JOB_RE.test(applyUrl) && EASY_APPLY_RE.test(t));
    let applyHost = '';
    try { applyHost = applyUrl ? new URL(applyUrl).hostname.replace(/^www\./, '') : ''; } catch {}
    return { applyUrl, applyHost, easyApply, linkedin: LINKEDIN_JOB_RE.test(applyUrl) };
  }

  const MATCH_RE = /(\d{1,3})\s*%\s*(?:match|fit)?|\b(?:match|fit)\s*(?:score)?\s*[:\-]?\s*(\d{1,3})\s*%/i;
  const POSTED_RE = /\b(\d+\s*(?:minute|min|hour|hr|day|week|month)s?\s+ago|just posted|today|yesterday|new)\b/i;
  const SALARY_RE = /(\$\s?\d[\d,.]*\s*(?:k|K)?(?:\s*[-–—to]+\s*\$?\s?\d[\d,.]*\s*(?:k|K)?)?(?:\s*(?:\/|per\s)?\s*(?:yr|year|hour|hr|mo|month))?)/;
  const LOCATION_RE = /\b([A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+)*,\s*(?:[A-Z]{2}|[A-Z][a-z]+))\b|\b(remote|hybrid|on-?site)\b/i;

  function fieldsFromCard(card, link) {
    const t = clean(card.textContent).slice(0, 2000);
    const title = text(card.querySelector('h1, h2, h3, [class*="title" i]')) || clean(link.textContent);
    // Company: a labelled element, else the line right after the title.
    let company = text(card.querySelector('[class*="company" i], [data-company], [class*="employer" i]'));
    if (!company) {
      const parts = clean(card.innerText || card.textContent).split('\n').map(clean).filter(Boolean);
      const idx = parts.findIndex((p) => p && title && p.includes(title.slice(0, 20)));
      company = idx >= 0 ? parts[idx + 1] || '' : parts[1] || '';
    }
    const match = t.match(MATCH_RE);
    const posted = t.match(POSTED_RE);
    const salary = t.match(SALARY_RE);
    const location = t.match(LOCATION_RE);
    const apply = applyInfo(card);
    return {
      ...apply,
      title: title.slice(0, 200),
      company: company.slice(0, 120),
      matchScore: match ? Number(match[1] || match[2]) : null,
      posted: posted ? posted[0] : '',
      salary: salary ? clean(salary[1]).slice(0, 80) : '',
      location: location ? clean(location[0]).slice(0, 80) : ''
    };
  }

  // The open job's description, when the page shows one (detail pane or detail page).
  function detailText() {
    const candidates = [
      '[class*="job-detail" i]', '[class*="jobDetail" i]', '[class*="description" i]',
      '[class*="job-desc" i]', 'article', 'main'
    ];
    let best = '';
    for (const sel of candidates) {
      for (const el of document.querySelectorAll(sel)) {
        const t = clean(el.innerText || el.textContent);
        if (t.length > best.length && t.length < 60000) best = t;
      }
      if (best.length > 400) break;
    }
    return best.slice(0, MAX_TEXT);
  }

  function collect() {
    const out = [];
    const seen = new Set();
    const links = Array.from(document.querySelectorAll('a[href]'));

    for (const link of links) {
      const href = link.getAttribute('href');
      const id = jobIdFromHref(href);
      if (!id || seen.has(id)) continue;
      const card = cardFor(link);
      const fields = fieldsFromCard(card, link);
      if (!fields.title) continue;
      seen.add(id);
      out.push({ jobId: id, url: absolute(href), ...fields, jd: '' });
    }

    // If a job detail is open, attach its text to the matching entry (or add it standalone).
    const openId = jobIdFromHref(location.href);
    const jd = detailText();
    if (jd && jd.length > 300) {
      const existing = out.find((j) => j.jobId === openId);
      if (existing) {
        existing.jd = jd;
        const detailApply = applyInfo(document.body);
        if (detailApply.easyApply) existing.easyApply = true;
        if (!existing.applyUrl && detailApply.applyUrl) { existing.applyUrl = detailApply.applyUrl; existing.applyHost = detailApply.applyHost; }
      }
      else if (openId) {
        const detailApply = applyInfo(document.body);
        out.push({
          jobId: openId,
          url: location.href,
          ...detailApply,
          title: text(document.querySelector('h1')) || document.title,
          company: '',
          matchScore: null,
          posted: '',
          salary: '',
          location: '',
          jd
        });
      }
    }

    return { url: location.href, host: location.hostname, openJobId: openId || '', jobs: out };
  }

  return collect();
})();
