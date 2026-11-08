/**
 * Interview Copilot — side panel.
 * ChatGPT-style thread: interviewer questions come in (from captions or typed), answers stream
 * token-by-token from the backend (DeepSeek), grounded in the user's resume + the chosen JD.
 */
const DEFAULT_API = 'https://ai-resume-builder-api-8aj2.onrender.com';
const MEETING_HOSTS = /meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com/;
const PLATFORM_NAMES = { meet: 'Google Meet', zoom: 'Zoom', teams: 'Teams', webex: 'Webex', generic: 'this page' };

const $ = (id) => document.getElementById(id);
const els = {
  login: $('view-login'), main: $('view-main'),
  loginForm: $('login-form'), loginEmail: $('login-email'), loginPassword: $('login-password'), loginApi: $('login-api'), loginError: $('login-error'), loginSubmit: $('login-submit'),
  appSelect: $('context-select'), briefToggle: $('brief-toggle'), brief: $('brief'), listen: $('listen-toggle'), menuToggle: $('menu-toggle'), menu: $('menu'),
  sessionBar: $('session-bar'), sessionTime: $('session-time'), sessionInfo: $('session-info'), endInterview: $('end-interview'),
  autoAnswer: $('auto-answer'), selfName: $('self-name'), accountEmail: $('account-email'), logout: $('logout'), clear: $('clear'),
  status: $('status'), statusText: $('status-text'), thread: $('thread'), empty: $('empty'),
  liveCaption: $('live-caption'), askForm: $('ask-form'), askInput: $('ask-input'), askSubmit: $('ask-submit'),
  sourceSeg: $('source-seg'), meter: $('meter'),
  appSearchToggle: $('app-search-toggle'), appSearchRow: $('app-search-row'), appSearch: $('app-search'), appSearchHint: $('app-search-hint')
};

const state = {
  apiUrl: DEFAULT_API,
  token: null,
  user: null,
  applicationId: '',
  applicationLabel: '',   // kept so a search that hides it does not lose the selection
  eventId: '',            // selected calendar interview event (preferred context)
  brief: null,            // brief for the selected event, or for the chosen application
  autoAnswer: true,
  selfName: '',
  listening: false,
  invokedTabId: null,     // tab the icon/shortcut was last used on — the only one we can capture
  source: 'voice',        // 'voice' (tab audio + local Whisper) or 'captions' (platform captions)
  meetingTabId: null,
  history: [],            // [{ question, answer }]
  inFlight: null,         // AbortController of the current answer
  session: null           // { startedAt, transcript: [{at, speaker, text}], qa: [], leadIn: [] } while listening
};

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */
async function loadState() {
  const s = await chrome.storage.local.get(['apiUrl', 'token', 'user', 'applicationId', 'applicationLabel', 'eventId', 'autoAnswer', 'selfName', 'history', 'source']);
  state.eventId = s.eventId || '';
  state.source = s.source === 'captions' ? 'captions' : 'voice';
  state.apiUrl = (s.apiUrl || DEFAULT_API).replace(/\/+$/, '').replace(/\/api$/i, '');
  state.token = s.token || null;
  state.user = s.user || null;
  state.applicationId = s.applicationId || '';
  state.applicationLabel = s.applicationLabel || '';
  state.autoAnswer = s.autoAnswer !== false;
  state.selfName = s.selfName || '';
  state.history = Array.isArray(s.history) ? s.history.slice(-40) : [];
}
const save = (patch) => chrome.storage.local.set(patch);

/* ------------------------------------------------------------------ */
/* api                                                                 */
/* ------------------------------------------------------------------ */
function api(path) { return `${state.apiUrl}/api${path}`; }
function authHeaders() { return { Authorization: `Bearer ${state.token}` }; }

async function apiJson(path, options = {}) {
  const res = await fetch(api(path), { ...options, headers: { 'Content-Type': 'application/json', ...(state.token ? authHeaders() : {}), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { await signOut(); throw new Error('Session expired — please sign in again'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ------------------------------------------------------------------ */
/* ui helpers                                                          */
/* ------------------------------------------------------------------ */
function setStatus(text, kind = '') {
  els.statusText.textContent = text;
  els.status.className = `status ${kind}`;
}

function showView(name) {
  els.login.hidden = name !== 'login';
  els.main.hidden = name !== 'main';
}

function scrollToBottom() { els.thread.scrollTop = els.thread.scrollHeight; }

function addMessage(kind, text, meta = '') {
  els.empty.hidden = true;
  const wrap = document.createElement('div');
  wrap.className = `msg ${kind}`;
  const metaEl = document.createElement('div');
  metaEl.className = 'meta';
  metaEl.textContent = meta;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.append(metaEl, bubble);
  els.thread.appendChild(wrap);
  scrollToBottom();
  return { wrap, bubble, metaEl };
}

function addActions(msg, answerText) {
  const actions = document.createElement('div');
  actions.className = 'actions';
  const copy = document.createElement('button');
  copy.textContent = 'Copy';
  copy.onclick = async () => { try { await navigator.clipboard.writeText(answerText()); copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200); } catch {} };
  const shorter = document.createElement('button');
  shorter.textContent = 'Shorter';
  shorter.onclick = () => ask(`${msg.question} (Answer in 2–3 sentences.)`, { label: 'Shorter answer', display: msg.question });
  const regen = document.createElement('button');
  regen.textContent = 'Regenerate';
  regen.onclick = () => ask(msg.question, { display: msg.question });
  actions.append(copy, shorter, regen);
  msg.wrap.appendChild(actions);
}

function renderHistory() {
  els.thread.querySelectorAll('.msg').forEach((m) => m.remove());
  els.empty.hidden = state.history.length > 0;
  for (const turn of state.history) {
    addMessage('q', turn.question, turn.source === 'captions' ? 'Interviewer' : 'You asked');
    const a = addMessage('a', turn.answer, 'Suggested answer');
    addActions({ wrap: a.wrap, question: turn.question }, () => turn.answer);
  }
}

/* ------------------------------------------------------------------ */
/* answering (SSE stream)                                              */
/* ------------------------------------------------------------------ */
async function ask(question, { source = 'typed', display = question, leadIn = '' } = {}) {
  const q = String(question || '').trim();
  if (!q) return;
  if (state.inFlight) state.inFlight.abort();
  const controller = new AbortController();
  state.inFlight = controller;

  addMessage('q', display, source === 'captions' ? 'Interviewer' : 'You asked');
  const a = addMessage('a', '', 'Suggested answer');
  a.bubble.classList.add('streaming');
  const started = performance.now();
  let firstTokenAt = 0;
  let full = '';

  try {
    const res = await fetch(api('/interview/answer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ question: q, eventId: state.eventId || null, applicationId: state.applicationId || null, context: leadIn || '', history: state.history.slice(-6) }),
      signal: controller.signal
    });
    if (res.status === 401) { await signOut(); throw new Error('Session expired — please sign in again'); }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.*)$/m.exec(frame)?.[1];
        const dataLine = /^data: (.*)$/m.exec(frame)?.[1];
        if (!event || !dataLine) continue;
        const data = JSON.parse(dataLine);
        if (event === 'token') {
          if (!firstTokenAt) firstTokenAt = performance.now();
          full += data.t;
          a.bubble.textContent = full;
          scrollToBottom();
        } else if (event === 'done') {
          full = data.answer || full;
          done = true;
        } else if (event === 'error') {
          throw new Error(data.error || 'Failed to generate answer');
        }
      }
    }

    a.bubble.classList.remove('streaming');
    a.bubble.textContent = full;
    const total = ((performance.now() - started) / 1000).toFixed(1);
    const ttft = firstTokenAt ? ((firstTokenAt - started) / 1000).toFixed(1) : '–';
    a.metaEl.innerHTML = `Suggested answer <span class="timing">· first words ${ttft}s · done ${total}s</span>`;
    addActions({ wrap: a.wrap, question: q }, () => full);

    state.history.push({ question: q, answer: full, source, at: Date.now() });
    state.history = state.history.slice(-40);
    save({ history: state.history });
    if (state.session) { state.session.qa.push({ question: q, answer: full }); updateSessionBar(); }
  } catch (err) {
    if (controller.signal.aborted) { a.wrap.remove(); return; }
    a.bubble.classList.remove('streaming');
    a.wrap.classList.add('error');
    a.bubble.textContent = err.message || 'Failed to generate answer';
  } finally {
    if (state.inFlight === controller) state.inFlight = null;
  }
}

/* ------------------------------------------------------------------ */
/* question detection (same heuristics as captions.js)                 */
/* ------------------------------------------------------------------ */
const QUESTION_WORDS = /^(what|why|how|when|where|which|who|whom|can|could|would|should|do|does|did|are|is|was|were|have|has|had|tell me|walk me|describe|explain|give me|talk|share|let'?s|any|so,?)\b/i;
const QUESTION_HINTS = /\b(tell me about|walk me through|describe|explain|how (do|did|would|have|about)|what('s| is| are| was| would| do| did)|why (did|do|would|are|is)|can you|could you|have you|do you|did you|are you|would you|your experience|experience with|example of|difference between|approach to|thoughts on)\b/i;
function looksLikeQuestion(text) {
  const t = String(text || '').trim();
  if (t.length < 12) return false;
  if (/\?\s*$/.test(t)) return true;
  const last = (t.split(/(?<=[.!?])\s+/).pop() || t).replace(/^(?:(?:and|so|okay|ok|alright|right|great|cool|now|also|then|well|um|uh)[,\s]+)+/i, '');
  return QUESTION_WORDS.test(last) || QUESTION_HINTS.test(last);
}

/* ------------------------------------------------------------------ */
/* voice source: tab audio -> local Whisper                            */
/* ------------------------------------------------------------------ */
const voice = {
  utterance: '',          // text of the current turn (accumulates across short pauses)
  lastFinalAt: 0,
  settleTimer: null
};

function showLive(who, text, interim = false) {
  els.liveCaption.hidden = false;
  els.liveCaption.querySelector('.who').textContent = who;
  const t = els.liveCaption.querySelector('.text');
  t.textContent = text;
  t.classList.toggle('interim', interim);
}

function recordUtterance(text, speaker = 'Interviewer') {
  if (!state.session || !text) return;
  const at = Math.round((Date.now() - state.session.startedAt) / 1000);
  state.session.transcript.push({ at, speaker, text });
  state.session.leadIn.push(text);
  updateSessionBar();
}

// Everything the interviewer said since the previous question, excluding the question itself.
function takeLeadIn(question) {
  if (!state.session) return '';
  const parts = state.session.leadIn.slice();
  state.session.leadIn = [];
  const q = String(question || '').trim();
  const filtered = parts.filter((p) => p && q && !q.includes(p.trim()) && !p.trim().includes(q));
  return filtered.join(' ').trim().slice(-4000);
}

function handleVoiceTranscript({ text, final }) {
  if (!final) { showLive('Interviewer', (voice.utterance ? voice.utterance + ' ' : '') + text, true); return; }
  recordUtterance(text);
  // Whisper returns one utterance per pause; join fragments that belong to the same question
  // (a sentence that hasn't ended yet, or a very quick follow-on).
  const now = Date.now();
  const continues = voice.utterance && (now - voice.lastFinalAt < 2500) && !/[.?!]\s*$/.test(voice.utterance);
  voice.utterance = continues ? `${voice.utterance} ${text}` : text;
  voice.lastFinalAt = now;
  showLive('Interviewer', voice.utterance, false);
  clearTimeout(voice.settleTimer);
  const decide = () => {
    const q = voice.utterance.trim();
    voice.utterance = '';
    if (looksLikeQuestion(q)) onDetectedQuestion(q);
  };
  // Ends with a question mark: answer right away; otherwise wait briefly for a continuation.
  if (/\?\s*$/.test(voice.utterance)) decide();
  else voice.settleTimer = setTimeout(decide, 1200);
}

function onDetectedQuestion(text) {
  if (!state.listening) return;
  const leadIn = takeLeadIn(text);
  if (state.autoAnswer) {
    ask(text, { source: 'captions', leadIn });
  } else {
    state.pendingLeadIn = leadIn;
    els.askInput.value = text;
    els.askInput.focus();
    setStatus('Question detected — press Enter to answer.', 'warn');
  }
}

async function startVoice(tab) {
  await VoiceEngine.start(tab.id, {
    model: 'fast',
    handlers: {
      progress: (m) => setStatus(`Loading speech model (one-time download) — ${m.file.split('/').pop()} ${m.progress}%`, 'warn'),
      ready: (m) => setStatus(m.device === 'webgpu' ? "Listening to the meeting audio (GPU). The interviewer's questions will appear here." : 'Listening to the meeting audio (CPU — expect a few seconds per sentence; switch Source to Captions if too slow).', 'ok'),
      level: (m) => {
        els.meter.firstElementChild.style.width = `${Math.round(Math.min(1, m.level * 12) * 100)}%`;
        els.liveCaption.classList.toggle('speaking', m.speaking);
        if (els.liveCaption.hidden) showLive('Interviewer', '…');
      },
      transcript: handleVoiceTranscript,
      error: (m) => setStatus(`Speech recognition error: ${m.error}`, 'err'),
      ended: () => { if (state.listening) setListening(false); setStatus('The meeting tab stopped sharing audio. Press Ctrl+Shift+Y on the meeting tab to start again.', 'warn'); }
    }
  });
  if (!VoiceEngine.isReady()) setStatus('Loading speech model (one-time download, about 40 MB)…', 'warn');
}

/* ------------------------------------------------------------------ */
/* meeting tab / captions                                              */
/* ------------------------------------------------------------------ */
// Prefer a known meeting platform; otherwise attach to whatever web page is active
// (generic caption detection works on any browser-based meeting).
async function findMeetingTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const isWeb = (t) => /^https?:/i.test(t.url || '');
  if (state.invokedTabId != null) {
    const invoked = tabs.find((t) => t.id === state.invokedTabId && isWeb(t));
    if (invoked) return invoked;
  }
  const active = tabs.find((t) => t.active);
  if (active && MEETING_HOSTS.test(active.url || '')) return active;
  const known = tabs.find((t) => MEETING_HOSTS.test(t.url || ''));
  if (known) return known;
  return active && isWeb(active) ? active : null;
}

async function sendToTab(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch { return null; }
}

async function setListening(on) {
  if (on) {
    const tab = await findMeetingTab();
    if (!tab) { setStatus('Open your meeting in a normal web tab in this window, then press Listen.', 'warn'); return; }

    if (state.source === 'voice') {
      try {
        await startVoice(tab);
      } catch (err) {
        const notInvoked = /not been invoked|activeTab/i.test(err.message || '');
        setStatus(notInvoked
          ? 'Chrome only lets me capture a tab you invoked me on: switch to the meeting tab, press Ctrl+Shift+Y (or click the Interview Copilot icon), and listening starts.'
          : `Could not capture the tab audio: ${err.message}. Switch Source to Captions (menu) as a fallback.`, 'err');
        return;
      }
      state.meetingTabId = tab.id;
      state.listening = true;
      els.listen.classList.add('on');
      els.listen.querySelector('.label').textContent = 'Listening';
      startSession();
      return;
    }

    let pong = await sendToTab(tab.id, { type: 'copilot:ping' });
    if (!pong) {
      // Content script not injected yet (extension installed after the tab opened): inject now.
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['captions.js'] }); pong = await sendToTab(tab.id, { type: 'copilot:ping' }); } catch {}
    }
    if (!pong) { setStatus('Could not attach to the meeting tab. Reload the meeting page and try again.', 'err'); return; }
    const selfNames = [state.selfName, state.user?.full_name, (state.user?.full_name || '').split(' ')[0]].filter(Boolean);
    await sendToTab(tab.id, { type: 'copilot:listen', enabled: true, selfNames });
    state.meetingTabId = tab.id;
    state.listening = true;
    els.listen.classList.add('on');
    els.listen.querySelector('.label').textContent = 'Listening';
    startSession();
    const where = PLATFORM_NAMES[pong.platform] || 'this page';
    setStatus(pong.platform === 'generic'
      ? `Listening on ${new URL(tab.url).hostname} (generic caption detection). Turn on captions / live transcript in the meeting.`
      : `Listening to ${where} captions. Make sure captions are turned on in the meeting.`, 'ok');
  } else {
    clearTimeout(voice.settleTimer);
    voice.utterance = '';
    if (state.session && !state.session.ending) await endInterview({ silent: true });
    VoiceEngine.stop();
    if (state.meetingTabId != null) await sendToTab(state.meetingTabId, { type: 'copilot:listen', enabled: false });
    state.listening = false;
    els.listen.classList.remove('on');
    els.listen.querySelector('.label').textContent = 'Listen';
    els.liveCaption.hidden = true;
    if (!els.status.classList.contains('ok') && !els.status.classList.contains('err')) setStatus('Paused. Press Listen (or Ctrl+Shift+Y on the meeting tab) to start again.');
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message?.type?.startsWith('copilot:')) return;
  if (message.type === 'copilot:invoked') {
    state.invokedTabId = message.tabId;
    if (message.startListening && !state.listening && state.token) setListening(true);
    else if (!state.listening && state.token) setStatus('Ready — press Listen (or Ctrl+Shift+Y) to hear this tab.');
    return;
  }
  if (message.tabId != null && state.meetingTabId != null && message.tabId !== state.meetingTabId) return;
  if (message.type === 'copilot:caption') {
    if (state.source === 'captions') showLive(message.speaker, message.text);
  } else if (message.type === 'copilot:utterance') {
    if (state.source === 'captions') recordUtterance(message.text, message.speaker || 'Interviewer');
  } else if (message.type === 'copilot:question') {
    if (state.source === 'captions') onDetectedQuestion(message.text);
  } else if (message.type === 'copilot:status' && message.listening === false && state.listening) {
    // Page navigated / content script reset
    setStatus('Meeting page reloaded — press Listen again.', 'warn');
    state.listening = false;
    els.listen.classList.remove('on');
    els.listen.querySelector('.label').textContent = 'Listen';
  }
});

/* ------------------------------------------------------------------ */
/* interview session: transcript, recording, end-of-interview upload    */
/* ------------------------------------------------------------------ */
function startSession() {
  if (state.session) return;
  state.session = { startedAt: Date.now(), transcript: [], qa: [], leadIn: [], ending: false };
  els.sessionBar.hidden = !state.eventId;
  clearInterval(state.sessionTimer);
  state.sessionTimer = setInterval(updateSessionBar, 1000);
  updateSessionBar();
}

function updateSessionBar() {
  if (!state.session) return;
  const sec = Math.round((Date.now() - state.session.startedAt) / 1000);
  els.sessionTime.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  els.sessionInfo.textContent = `${state.source === 'voice' ? 'recording' : 'transcript'} · ${state.session.qa.length} question${state.session.qa.length === 1 ? '' : 's'}`;
  els.sessionBar.hidden = !state.eventId;
}

// Stop listening, upload the recording + transcript to the selected interview event, and show
// the generated summary. With no event selected the session is simply discarded.
async function endInterview({ silent = false } = {}) {
  const session = state.session;
  if (!session || session.ending) return;
  session.ending = true;
  clearInterval(state.sessionTimer);
  els.sessionBar.hidden = true;

  const { blob, durationSec } = state.source === 'voice' ? await VoiceEngine.finishRecording() : { blob: null, durationSec: Math.round((Date.now() - session.startedAt) / 1000) };
  state.session = null;

  const nothingCaptured = !blob && !session.transcript.length && !session.qa.length;
  if (!state.eventId || nothingCaptured) {
    if (!silent && !state.eventId) setStatus('Interview ended. Select an interview in the dropdown before you start if you want the recording and summary saved to it.', 'warn');
    return;
  }

  const form = new FormData();
  if (blob) form.append('recording', blob, `interview.${/ogg/.test(blob.type) ? 'ogg' : 'webm'}`);
  form.append('transcript', JSON.stringify(session.transcript));
  form.append('qa', JSON.stringify(session.qa));
  form.append('durationSec', String(durationSec || 0));

  const note = addMessage('a', 'Uploading the recording and transcript, generating your meeting summary…', 'Interview ended');
  note.bubble.classList.add('streaming');
  setStatus('Uploading recording and generating summary…', 'warn');
  try {
    const res = await fetch(api(`/interview/events/${state.eventId}/recording`), { method: 'POST', headers: authHeaders(), body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    note.bubble.classList.remove('streaming');
    note.bubble.classList.add('summary');
    note.bubble.textContent = data.summary || 'Saved. (No summary was generated.)';
    note.metaEl.textContent = `Meeting summary · saved to ${state.brief?.event?.companyName || 'the interview'} in the app`;
    if (data.warning) setStatus(data.warning, 'warn');
    else setStatus('Recording, transcript and summary saved. You can review them on the Interviews page.', 'ok');
    loadBrief({ eventId: state.eventId });
  } catch (err) {
    note.bubble.classList.remove('streaming');
    note.wrap.classList.add('error');
    note.bubble.textContent = `Could not save the interview: ${err.message}`;
    setStatus(err.message, 'err');
  }
}

/* ------------------------------------------------------------------ */
/* meeting brief                                                       */
/* ------------------------------------------------------------------ */
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function downloadResume(applicationId, type, name) {
  try {
    const res = await fetch(api(`/cv/download/${type}/${applicationId}`), { headers: authHeaders() });
    if (!res.ok) throw new Error('Download failed');
    const url = URL.createObjectURL(await res.blob());
    if (type === 'pdf') { window.open(url, '_blank'); return; }
    const a = document.createElement('a'); a.href = url; a.download = `resume-${(name || 'resume').replace(/\s+/g, '-')}.docx`; a.click();
  } catch (err) {
    setStatus(err.message, 'err');
  }
}

function renderBrief(brief) {
  const ev = brief?.event;
  const app = brief?.application;
  // Going from "no context" to a real one: show the panel, since the resume and JD
  // are the reason you picked it. Once it exists, respect however you left it.
  const hadBrief = !els.briefToggle.hidden;
  // An application picked straight from the history has no meeting around it, but
  // it still carries the two things that matter here: the JD and the resume.
  if (!ev && !app) { els.brief.hidden = true; els.briefToggle.hidden = true; return; }
  const parts = [];

  if (ev) {
    const stage = (ev.stage || 'not_sure').replace(/_/g, ' ');
    const when = ev.start ? new Date(ev.start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    parts.push(`<h4>Meeting</h4><div class="chips"><span class="chip">${escapeHtml(ev.companyName || ev.title)}</span>${ev.jobTitle ? `<span class="chip">${escapeHtml(ev.jobTitle)}</span>` : ''}<span class="chip">${escapeHtml(stage)}</span>${when ? `<span class="chip">${escapeHtml(when)}</span>` : ''}</div>`);
    if (ev.attendees?.length) parts.push(`<p class="muted">With: ${escapeHtml(ev.attendees.filter((a) => !a.self).map((a) => a.name || a.email).join(', '))}</p>`);
    if (ev.notes) parts.push(`<h4>My note</h4><p>${escapeHtml(ev.notes)}</p>`);
    if (ev.summary) parts.push(`<h4>Summary of this meeting</h4><p>${escapeHtml(ev.summary)}</p>`);
  } else {
    const applied = app.appliedAt ? new Date(app.appliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    parts.push(`<h4>Application</h4><div class="chips"><span class="chip">${escapeHtml(app.companyName || 'Unknown company')}</span>${app.jobTitle ? `<span class="chip">${escapeHtml(app.jobTitle)}</span>` : ''}${applied ? `<span class="chip">applied ${escapeHtml(applied)}</span>` : ''}</div>`);
    parts.push('<p class="muted">Answers use this job description and the resume you applied with.</p>');
  }

  if (brief.previous?.length) {
    parts.push('<h4>Previous rounds</h4>');
    for (const step of brief.previous) {
      const d = step.start ? new Date(step.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      parts.push(`<div class="step ${escapeHtml(step.status || '')}"><b>${escapeHtml((step.stage || 'interview').replace(/_/g, ' '))}</b> · ${escapeHtml(d)} · ${escapeHtml((step.status || '').replace(/_/g, ' '))}${step.notes ? `<div class="summary">Note: ${escapeHtml(step.notes)}</div>` : ''}${step.summary ? `<div class="summary">${escapeHtml(step.summary)}</div>` : '<div class="muted">No summary recorded.</div>'}</div>`);
    }
  }
  const links = [];
  const jdLink = ev?.jdLink || app?.jdLink;
  if (jdLink) links.push(`<a class="btn small" href="${escapeHtml(jdLink)}" target="_blank" rel="noreferrer">JD link</a>`);
  if (ev?.meetingLink) links.push(`<a class="btn small" href="${escapeHtml(ev.meetingLink)}" target="_blank" rel="noreferrer">Join call</a>`);
  if (app?.hasPdf) links.push(`<button class="btn small" data-resume="pdf">Resume PDF</button>`);
  if (app?.hasDoc) links.push(`<button class="btn small" data-resume="docx">Resume DOCX</button>`);
  if (links.length) parts.push(`<h4>Resume & JD</h4><div class="row">${links.join('')}</div>`);
  else if (app) parts.push('<p class="muted">No resume or JD link stored for this application.</p>');
  if (app?.jdContent) parts.push(`<details><summary>Job description</summary><div class="jd">${escapeHtml(app.jdContent)}</div></details>`);
  els.brief.innerHTML = parts.join('');
  if (app) els.brief.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => downloadResume(app.id, b.dataset.resume, app.companyName)));
  els.briefToggle.hidden = false;
  if (!hadBrief) els.brief.hidden = false;
}

/** The brief comes from the event when there is one, otherwise from the application. */
async function loadBrief({ eventId, applicationId }) {
  const path = eventId
    ? `/interview/events/${eventId}/brief`
    : applicationId ? `/interview/applications/${applicationId}/brief` : '';
  if (!path) { state.brief = null; renderBrief(null); return; }
  try {
    const data = await apiJson(path);
    state.brief = data;
    renderBrief(data);
  } catch (err) {
    state.brief = null;
    renderBrief(null);
    setStatus(err.message, 'err');
  }
}

/* ------------------------------------------------------------------ */
/* auth + context                                                      */
/* ------------------------------------------------------------------ */
async function signIn(email, password, apiUrl) {
  state.apiUrl = (apiUrl || DEFAULT_API).replace(/\/+$/, '').replace(/\/api$/i, '');
  const data = await apiJson('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!data.token) throw new Error(data.message || 'Login failed');
  state.token = data.token;
  state.user = data.user || null;
  await save({ apiUrl: state.apiUrl, token: state.token, user: state.user });
}

async function signOut() {
  state.token = null;
  state.user = null;
  await chrome.storage.local.remove(['token', 'user']);
  showView('login');
}

function applyContextSelection(value) {
  const [kind, id] = String(value || '').split(':');
  state.eventId = kind === 'event' ? id : '';
  state.applicationId = kind === 'app' ? id : '';
  // Remember the label so the choice survives a later search that excludes it.
  state.applicationLabel = kind === 'app'
    ? ([...els.appSelect.options].find((o) => o.value === value)?.textContent || state.applicationLabel || '')
    : '';
  save({ eventId: state.eventId, applicationId: state.applicationId, applicationLabel: state.applicationLabel });
  loadBrief({ eventId: state.eventId, applicationId: state.applicationId });
  if (state.session) updateSessionBar();
}

function applicationLabel(app) {
  const when = app.appliedAt ? new Date(app.appliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  return `${app.companyName || 'Unknown'}${app.jobTitle ? ` — ${app.jobTitle}` : ''}${when ? ` (${when})` : ''}`;
}

/**
 * Rebuilds just the Applications group, so a search can replace it without
 * disturbing the calendar interviews above it. The application currently in use
 * is kept in the list even when it falls outside the results — losing your
 * context because you typed in a search box would be infuriating.
 */
function renderApplicationOptions(apps) {
  let group = els.appSelect.querySelector('optgroup[data-apps]');
  if (!group) {
    group = document.createElement('optgroup');
    group.label = 'Applications';
    group.dataset.apps = '1';
  }
  group.replaceChildren();

  const selected = state.applicationId ? String(state.applicationId) : '';
  let selectedListed = false;
  for (const app of apps) {
    const opt = document.createElement('option');
    opt.value = `app:${app.id}`;
    opt.textContent = applicationLabel(app);
    if (String(app.id) === selected) selectedListed = true;
    group.appendChild(opt);
  }
  if (selected && !selectedListed && state.applicationLabel) {
    const opt = document.createElement('option');
    opt.value = `app:${selected}`;
    opt.textContent = state.applicationLabel;
    group.insertBefore(opt, group.firstChild);
  }

  if (group.children.length) els.appSelect.appendChild(group);
  else group.remove();
}

let searchTimer = null;

/** Searches the whole history (the plain list is only the 50 most recent). */
async function searchApplications(query) {
  const q = String(query || '').trim();
  els.appSearchHint.textContent = 'searching…';
  try {
    const ctx = await apiJson(`/interview/context${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    const apps = ctx.applications || [];
    renderApplicationOptions(apps);
    els.appSearchHint.textContent = q
      ? `${apps.length}${apps.length === 50 ? '+' : ''} match${apps.length === 1 ? '' : 'es'}`
      : '50 most recent';
    const current = state.eventId ? `event:${state.eventId}` : state.applicationId ? `app:${state.applicationId}` : '';
    if ([...els.appSelect.options].some((o) => o.value === current)) els.appSelect.value = current;
  } catch (err) {
    els.appSearchHint.textContent = err.message;
  }
}

async function loadApplications() {
  try {
    const [ctx, evs] = await Promise.all([apiJson('/interview/context'), apiJson('/interview/events').catch(() => ({ events: [] }))]);
    els.appSelect.innerHTML = '<option value="">General (profile only)</option>';
    const events = evs.events || [];
    if (events.length) {
      const g = document.createElement('optgroup'); g.label = 'Interviews (calendar)';
      for (const ev of events) {
        const opt = document.createElement('option');
        opt.value = `event:${ev.id}`;
        const when = ev.start ? new Date(ev.start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        opt.textContent = `${when} · ${ev.companyName || ev.title}${ev.jobTitle ? ` — ${ev.jobTitle}` : ''} (${(ev.stage || 'not sure').replace(/_/g, ' ')})${ev.hasRecording ? ' ✓' : ''}`;
        g.appendChild(opt);
      }
      els.appSelect.appendChild(g);
    }
    const apps = ctx.applications || [];
    renderApplicationOptions(apps);
    // Restore the previous choice; otherwise default to the nearest upcoming interview.
    const wanted = state.eventId ? `event:${state.eventId}` : state.applicationId ? `app:${state.applicationId}` : '';
    const has = (v) => [...els.appSelect.options].some((o) => o.value === v);
    if (wanted && has(wanted)) els.appSelect.value = wanted;
    else {
      const now = Date.now();
      const next = events.find((e) => new Date(e.end || e.start).getTime() >= now) || events[events.length - 1];
      els.appSelect.value = next ? `event:${next.id}` : (apps[0] ? `app:${apps[0].id}` : '');
    }
    applyContextSelection(els.appSelect.value);
  } catch (err) {
    setStatus(err.message, 'err');
  }
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */
els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.loginError.hidden = true;
  els.loginSubmit.disabled = true;
  els.loginSubmit.textContent = 'Signing in…';
  try {
    await signIn(els.loginEmail.value.trim(), els.loginPassword.value, els.loginApi.value.trim());
    await enterMain();
  } catch (err) {
    els.loginError.textContent = err.message;
    els.loginError.hidden = false;
  } finally {
    els.loginSubmit.disabled = false;
    els.loginSubmit.textContent = 'Sign in';
  }
});

els.appSelect.addEventListener('change', () => applyContextSelection(els.appSelect.value));
els.appSearchToggle.addEventListener('click', () => {
  els.appSearchRow.hidden = !els.appSearchRow.hidden;
  if (!els.appSearchRow.hidden) els.appSearch.focus();
});
els.appSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = els.appSearch.value;
  // Debounced: one request per pause in typing, not one per keystroke.
  searchTimer = setTimeout(() => searchApplications(q), 300);
});
els.briefToggle.addEventListener('click', () => { els.brief.hidden = !els.brief.hidden; });
els.endInterview.addEventListener('click', () => setListening(false));
els.listen.addEventListener('click', () => setListening(!state.listening));
els.menuToggle.addEventListener('click', () => { els.menu.hidden = !els.menu.hidden; });
els.autoAnswer.addEventListener('change', () => { state.autoAnswer = els.autoAnswer.checked; save({ autoAnswer: state.autoAnswer }); });
els.selfName.addEventListener('change', () => { state.selfName = els.selfName.value.trim(); save({ selfName: state.selfName }); if (state.listening) setListening(true); });
els.sourceSeg.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-source]');
  if (!btn) return;
  const next = btn.dataset.source;
  if (next === state.source) return;
  const wasListening = state.listening;
  if (wasListening) await setListening(false);
  state.source = next;
  save({ source: next });
  els.sourceSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.source === next));
  setStatus(next === 'voice'
    ? 'Voice mode: the meeting tab audio is transcribed locally. Press Listen.'
    : 'Captions mode: turn on captions in the meeting, then press Listen.');
  if (wasListening) await setListening(true);
});
els.logout.addEventListener('click', signOut);
els.clear.addEventListener('click', () => { state.history = []; save({ history: [] }); renderHistory(); });

els.askForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = els.askInput.value.trim();
  if (!q) return;
  els.askInput.value = '';
  els.askInput.style.height = 'auto';
  const leadIn = state.pendingLeadIn || '';
  state.pendingLeadIn = '';
  ask(q, { source: 'typed', leadIn });
});
els.askInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); els.askForm.requestSubmit(); }
});
els.askInput.addEventListener('input', () => {
  els.askInput.style.height = 'auto';
  els.askInput.style.height = `${Math.min(120, els.askInput.scrollHeight)}px`;
});

async function enterMain() {
  showView('main');
  els.accountEmail.textContent = state.user?.email || '';
  els.autoAnswer.checked = state.autoAnswer;
  els.selfName.value = state.selfName;
  els.sourceSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.source === state.source));
  // Warm the speech model in the background so the first question isn't delayed by the load.
  if (state.source === 'voice') VoiceEngine.preload('fast');
  renderHistory();
  await loadApplications();
  const tab = await findMeetingTab();
  if (tab) setStatus(state.source === 'voice' ? 'Meeting tab found. Press Listen to start hearing the interviewer.' : (MEETING_HOSTS.test(tab.url || '') ? 'Meeting tab found. Turn on captions in the meeting and press Listen.' : 'Open your meeting in a web tab, turn on captions, then press Listen.'));
}

(async () => {
  await loadState();
  els.loginApi.value = state.apiUrl;
  if (state.token) {
    try { const me = await apiJson('/auth/me'); state.user = me.user || state.user; save({ user: state.user }); await enterMain(); return; } catch {}
  }
  showView('login');
})();
