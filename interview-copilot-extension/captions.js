/**
 * Interview Copilot — caption reader (content script).
 *
 * Reads the meeting platform's own live captions from the DOM (Google Meet, Zoom web,
 * Microsoft Teams) and forwards what other participants say to the side panel. When a
 * speaker's turn looks like a question and they pause, it is emitted as `copilot:question`.
 *
 * No audio is recorded: the user must turn on captions in the meeting (Meet: "cc" button).
 */
(() => {
  if (window.__interviewCopilotLoaded) return;
  window.__interviewCopilotLoaded = true;

  const host = location.hostname;
  const PLATFORM = host.includes('meet.google.com') ? 'meet'
    : host.includes('zoom.us') ? 'zoom'
    : host.includes('teams.') ? 'teams'
    : host.includes('webex.com') ? 'webex'
    : 'generic';

  const QUESTION_WORDS = /^(what|why|how|when|where|which|who|whom|can|could|would|should|do|does|did|are|is|was|were|have|has|had|tell me|walk me|describe|explain|give me|talk|share|let'?s|any|so,?)\b/i;
  const QUESTION_HINTS = /\b(tell me about|walk me through|describe|explain|how (do|did|would|have|about)|what('s| is| are| was| would| do| did)|why (did|do|would|are|is)|can you|could you|have you|do you|did you|are you|would you|your experience|experience with|example of|difference between|approach to|thoughts on)\b/i;

  const SETTLE_MS = 1400;          // silence after a question before we emit it
  const MIN_QUESTION_CHARS = 12;
  const MAX_UTTERANCE_CHARS = 700;

  let enabled = false;
  let selfNames = new Set();       // names the panel tells us belong to the user
  const emitted = new Map();       // question text -> time emitted (finished blocks stay in the DOM)
  const speakers = new Map();      // speaker -> { text, timer, lastChange }

  // ---------------------------------------------------------------------------
  // Platform adapters: return [{ speaker, text }] for the currently visible captions.
  // Selectors are best-effort; each one falls back to scanning for "name + text" pairs.
  // ---------------------------------------------------------------------------
  function readMeet() {
    const out = [];
    // Meet renders each caption block with a speaker name element followed by the spoken text.
    const region = document.querySelector('[aria-label="Captions"], [aria-live="polite"][role="region"], div[jscontroller][class*="caption" i]');
    const blocks = region ? Array.from(region.children) : Array.from(document.querySelectorAll('div[class*="caption" i] > div'));
    for (const block of blocks) {
      const nameEl = block.querySelector('[class*="name" i], [data-self-name], span:first-child');
      const speaker = (nameEl?.textContent || '').trim();
      const texts = Array.from(block.querySelectorAll('span, div')).map((el) => el.textContent.trim()).filter(Boolean);
      const text = texts.filter((t) => t !== speaker).join(' ').replace(/\s+/g, ' ').trim();
      if (text) out.push({ speaker: speaker || 'Speaker', text });
    }
    return out.length ? dedupe(out) : readGeneric();
  }

  function readZoom() {
    const out = [];
    for (const el of document.querySelectorAll('[class*="live-transcription" i] [class*="item" i], [class*="lt-subtitle" i], [class*="closed-caption" i]')) {
      const speaker = (el.querySelector('[class*="name" i]')?.textContent || '').trim();
      const text = (el.querySelector('[class*="text" i]')?.textContent || el.textContent || '').replace(speaker, '').replace(/\s+/g, ' ').trim();
      if (text) out.push({ speaker: speaker || 'Speaker', text });
    }
    return out.length ? dedupe(out) : readGeneric();
  }

  function readTeams() {
    const out = [];
    for (const el of document.querySelectorAll('[data-tid*="caption" i], [class*="caption" i] [class*="item" i], [class*="ui-chat__message" i]')) {
      const speaker = (el.querySelector('[data-tid*="author" i], [class*="author" i], [class*="name" i]')?.textContent || '').trim();
      const text = (el.querySelector('[data-tid*="text" i], [class*="content" i], [class*="text" i]')?.textContent || el.textContent || '').replace(speaker, '').replace(/\s+/g, ' ').trim();
      if (text) out.push({ speaker: speaker || 'Speaker', text });
    }
    return out.length ? dedupe(out) : readGeneric();
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((c) => { const k = `${c.speaker}\n${c.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function readWebex() {
    const out = [];
    for (const el of document.querySelectorAll('[class*="caption" i] [class*="item" i], [class*="closed-caption" i] > div, [class*="transcript" i] [class*="row" i]')) {
      const speaker = (el.querySelector('[class*="name" i], [class*="speaker" i]')?.textContent || '').trim();
      const text = (el.querySelector('[class*="text" i], [class*="content" i]')?.textContent || el.textContent || '').replace(speaker, '').replace(/\s+/g, ' ').trim();
      if (text) out.push({ speaker: speaker || 'Speaker', text });
    }
    return out.length ? dedupe(out) : readGeneric();
  }

  // ---------------------------------------------------------------------------
  // Generic reader: works on any meeting site by watching text that behaves like live
  // captions — small text blocks that keep growing in place as someone speaks.
  // Speaker names are recognised when the platform shows "Name: text" or a short name
  // element right before the text; otherwise the speaker is "Speaker".
  // ---------------------------------------------------------------------------
  const liveNodes = new Map();   // element -> { text, seenAt, updates }
  const GENERIC_MAX = 600;
  const NAME_RE = /^([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3})\s*[:\-\u2013\u2014]\s+(.+)$/s;

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isEditable(el) {
    return Boolean(el.closest('input, textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]'));
  }

  // The element that holds one caption line: start at the changed text and climb only while
  // the parent has no other text-bearing children (so sibling lines never merge into one blob).
  function textChildren(el) {
    let n = 0;
    for (const c of el.childNodes) {
      if (c.nodeType === Node.TEXT_NODE ? c.textContent.trim() : (c.textContent || '').trim()) n++;
    }
    return n;
  }

  function captionContainer(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || el.nodeType !== Node.ELEMENT_NODE || isEditable(el)) return null;
    while (el.parentElement && el.parentElement !== document.body) {
      const parent = el.parentElement;
      if ((parent.textContent || '').trim().length > GENERIC_MAX) break;
      if (textChildren(parent) > 1) break;
      el = parent;
      if (el.matches('p, li, [role="listitem"], [class*="caption" i], [class*="subtitle" i], [class*="transcript" i]')) break;
    }
    return el;
  }

  function noteGenericChange(node) {
    const el = captionContainer(node);
    if (!el || !isVisible(el)) return;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > GENERIC_MAX) return;
    // Ignore clocks/counters: mostly digits and punctuation.
    if (/^[\d\s:./%-]+$/.test(text)) return;
    const prev = liveNodes.get(el);
    if (prev && prev.text === text) return;
    liveNodes.set(el, { text, seenAt: Date.now(), updates: (prev?.updates || 0) + 1 });
    if (liveNodes.size > 60) {
      const oldest = [...liveNodes.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt)[0];
      if (oldest) liveNodes.delete(oldest[0]);
    }
  }

  function readGeneric() {
    const out = [];
    const now = Date.now();
    // Oldest first, so the most recently updated block ends up as the speaker's "latest".
    const entries = [...liveNodes.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt);
    for (const [el, info] of entries) {
      if (!el.isConnected) { liveNodes.delete(el); continue; }
      if (now - info.seenAt > 20000) continue;
      let speaker = '';
      let text = info.text;
      const m = NAME_RE.exec(text);
      if (m) { speaker = m[1]; text = m[2]; }
      else {
        // Name shown in a separate element: a short, capitalised sibling right before the text
        // (or the first child of the line) is usually the speaker.
        const looksLikeName = (t) => t && t.length <= 40 && t.split(/\s+/).length <= 4 && /^[A-Z]/.test(t) && !/[?!.]$/.test(t) && t !== text;
        for (const cand of [el.previousElementSibling, el.firstElementChild, el.parentElement?.firstElementChild]) {
          if (!cand || cand === el) continue;
          const ct = (cand.textContent || '').replace(/[:\-\u2013\u2014]\s*$/, '').trim();
          if (!looksLikeName(ct)) continue;
          speaker = ct;
          if (text.startsWith(ct)) text = text.slice(ct.length).replace(/^[\s:\-\u2013\u2014]+/, '');
          break;
        }
      }
      if (text) out.push({ speaker: speaker || 'Speaker', text });
    }
    return out;
  }

  const readers = { meet: readMeet, zoom: readZoom, teams: readTeams, webex: readWebex, generic: readGeneric };

  // ---------------------------------------------------------------------------
  // Turn tracking
  // ---------------------------------------------------------------------------
  function isSelf(speaker) {
    const s = speaker.toLowerCase();
    if (!s || s === 'you' || s === 'me') return true;
    for (const n of selfNames) if (n && s.includes(n)) return true;
    return false;
  }

  function looksLikeQuestion(text) {
    const t = text.trim();
    if (t.length < MIN_QUESTION_CHARS) return false;
    if (/\?\s*$/.test(t)) return true;
    // Captions often drop the question mark: fall back to phrasing cues on the last sentence.
    const last = (t.split(/(?<=[.!?])\s+/).pop() || t)
      // Leading connectors ("And how…", "So, what…", "Okay, tell me…") don't change the question.
      .replace(/^(?:(?:and|so|okay|ok|alright|right|great|cool|now|also|then|well|um|uh)[,\s]+)+/i, '');
    return QUESTION_WORDS.test(last) || QUESTION_HINTS.test(last);
  }

  function alreadyEmitted(text) {
    const clean = text.trim();
    const now = Date.now();
    for (const [t, at] of emitted) {
      if (now - at > 10 * 60 * 1000) { emitted.delete(t); continue; }
      // Same question, or a longer version of one we already sent (captions keep growing).
      if (t === clean || clean.startsWith(t) || t.startsWith(clean)) return true;
    }
    return false;
  }

  function emitQuestion(speaker, text) {
    const clean = text.trim();
    if (alreadyEmitted(clean)) return;
    emitted.set(clean, Date.now());
    chrome.runtime.sendMessage({ type: 'copilot:question', platform: PLATFORM, speaker, text: clean }).catch(() => {});
  }

  function scheduleSettle(speaker) {
    const s = speakers.get(speaker);
    if (!s) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      const text = s.text;
      if (text.trim()) chrome.runtime.sendMessage({ type: 'copilot:utterance', platform: PLATFORM, speaker, text: text.trim() }).catch(() => {});
      if (looksLikeQuestion(text)) emitQuestion(speaker, text);
      // A finished turn is reset so the next one starts clean.
      s.text = '';
    }, SETTLE_MS);
  }

  function ingest(captions) {
    // Only the most recent block per speaker can still be changing; older ones are history.
    const latest = new Map();
    for (const c of captions) latest.set(c.speaker, c);
    for (const { speaker, text } of latest.values()) {
      if (isSelf(speaker)) continue;
      if (alreadyEmitted(text)) continue;
      let s = speakers.get(speaker);
      if (!s) { s = { text: '', timer: null, lastChange: 0 }; speakers.set(speaker, s); }
      // Live caption lines grow/replace in place; keep the longest current version of the turn.
      if (text !== s.text) {
        if (text.startsWith(s.text) || s.text.startsWith(text)) {
          s.text = text.length >= s.text.length ? text : s.text;
        } else if (s.text && !text.includes(s.text.slice(-40))) {
          // New utterance from the same speaker: settle the previous one first.
          if (looksLikeQuestion(s.text)) emitQuestion(speaker, s.text);
          s.text = text;
        } else if (alreadyEmitted(text)) {
          // A finished block that is still on screen — nothing new.
          continue;
        } else {
          s.text = text;
        }
        s.text = s.text.slice(-MAX_UTTERANCE_CHARS);
        s.lastChange = Date.now();
        chrome.runtime.sendMessage({ type: 'copilot:caption', platform: PLATFORM, speaker, text: s.text }).catch(() => {});
        scheduleSettle(speaker);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Observe the page
  // ---------------------------------------------------------------------------
  let observer = null;
  let poll = null;
  let scanScheduled = false;

  function scan() {
    scanScheduled = false;
    if (!enabled) return;
    try { ingest(readers[PLATFORM]()); } catch { /* DOM changed under us */ }
  }

  function start() {
    if (observer) return;
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') noteGenericChange(r.target);
        else for (const n of r.addedNodes) noteGenericChange(n);
      }
      if (scanScheduled) return;
      scanScheduled = true;
      requestAnimationFrame(scan);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    poll = setInterval(scan, 1000);
    chrome.runtime.sendMessage({ type: 'copilot:status', platform: PLATFORM, listening: true }).catch(() => {});
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    clearInterval(poll);
    poll = null;
    speakers.clear();
    liveNodes.clear();
    chrome.runtime.sendMessage({ type: 'copilot:status', platform: PLATFORM, listening: false }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'copilot:listen') {
      enabled = Boolean(message.enabled);
      selfNames = new Set((message.selfNames || []).map((n) => String(n).toLowerCase()).filter(Boolean));
      if (enabled) start(); else stop();
      sendResponse({ ok: true, platform: PLATFORM });
    } else if (message?.type === 'copilot:ping') {
      sendResponse({ ok: true, platform: PLATFORM, listening: enabled });
    }
    return true;
  });

  chrome.runtime.sendMessage({ type: 'copilot:ready', platform: PLATFORM }).catch(() => {});
})();
