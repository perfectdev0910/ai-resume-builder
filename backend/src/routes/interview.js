/**
 * Live interview assistant used by the Interview Copilot Chrome extension.
 *
 * GET  /api/interview/context                 — applications the user can answer from
 * GET  /api/interview/events                  — calendar interview events to pick as context
 * GET  /api/interview/events/:id/brief        — meeting brief: event, note, previous steps + summaries, JD, resume
 * POST /api/interview/answer                  — streams a spoken-style answer (SSE); accepts eventId or applicationId
 * POST /api/interview/events/:id/recording    — upload the recording + transcript, generate the meeting summary
 */
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { loadUserProfile, describeProfile } = require('../services/profile');
const { streamChat, summarizeInterview } = require('../services/openai');
const calendar = require('./calendar');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const router = express.Router();

const MAX_QUESTION = 1500;
const MAX_CONTEXT = 4000;        // interviewer speech leading up to the question
const MAX_HISTORY = 6;           // previous Q&A turns sent back for continuity
const CONTEXT_TTL_MS = 5 * 60 * 1000;
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const useCloudStorage = process.env.STORAGE_PROVIDER && process.env.STORAGE_PROVIDER !== 'local' && (process.env.SUPABASE_URL || process.env.R2_ACCOUNT_ID);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024 } });

const p = (i) => (isPostgres ? `$${i}` : '?');

/* ------------------------------------------------------------------ */
/* context                                                             */
/* ------------------------------------------------------------------ */
const contextCache = new Map();

async function loadEventRow(userId, eventId) {
  return calendar.fetchEvent(userId, eventId);
}

async function previousSteps(userId, row) {
  const company = String(row.company_name || '').trim();
  if (!company) return [];
  const rows = await db.getAll(
    `${calendar.EVENT_SELECT} WHERE e.user_id = ${p(1)} AND e.hidden = ${isPostgres ? 'FALSE' : '0'} AND e.id != ${p(2)}
       AND LOWER(e.company_name) = LOWER(${p(3)}) AND e.start_at < ${p(4)} ORDER BY e.start_at ASC`,
    [userId, row.id, company, new Date(row.start_at).toISOString()]
  );
  return rows.map(calendar.formatEvent);
}

async function loadApplication(userId, applicationId) {
  if (!applicationId) return null;
  return db.getOne(
    `SELECT id, job_title, company_name, jd_link, jd_content, cv_doc_url, cv_pdf_url, applied_at FROM applications WHERE id = ${p(1)} AND user_id = ${p(2)}`,
    [applicationId, userId]
  );
}

async function buildContext(userId, { applicationId, eventId }) {
  const key = `${userId}:${eventId ? `e${eventId}` : applicationId ? `a${applicationId}` : 'none'}`;
  const cached = contextCache.get(key);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) return cached.value;

  const profile = await loadUserProfile(userId);
  if (!profile) return null;

  let event = null;
  let previous = [];
  if (eventId) {
    event = await loadEventRow(userId, eventId);
    if (event) {
      previous = await previousSteps(userId, event);
      if (!applicationId) applicationId = event.application_id;
    }
  }
  const application = await loadApplication(userId, applicationId);

  const value = {
    profileText: describeProfile(profile),
    candidateName: profile.user.full_name || 'the candidate',
    jobTitle: event?.job_title || application?.job_title || '',
    companyName: event?.company_name || application?.company_name || '',
    stage: event?.stage || '',
    jobDescription: String(application?.jd_content || '').slice(0, 5000),
    notes: String(event?.notes || '').slice(0, 1500),
    previousSummaries: previous
      .filter((e) => e.summary)
      .map((e) => `• ${e.stage ? e.stage.replace(/_/g, ' ') : 'interview'} on ${new Date(e.start).toDateString()}: ${e.summary.slice(0, 1200)}`)
      .join('\n')
      .slice(0, 3000)
  };
  contextCache.set(key, { at: Date.now(), value });
  return value;
}

function systemPrompt(ctx) {
  return `You are ${ctx.candidateName}, a senior professional in a live job interview${ctx.companyName ? ` with ${ctx.companyName}` : ''}${ctx.jobTitle ? ` for the ${ctx.jobTitle} role` : ''}${ctx.stage ? ` (${ctx.stage.replace(/_/g, ' ')} stage)` : ''}.
Answer the interviewer's question exactly as you would say it out loud — first person, natural spoken English, confident and warm, the way an experienced senior engineer/leader talks.

Rules:
- Ground everything in the CANDIDATE PROFILE below. Never invent employers, titles, dates or numbers. If the profile lacks a detail, speak in general terms from experience rather than fabricating specifics.
- Tailor to the JOB DESCRIPTION: mirror its priorities, tech and language where relevant.
- Use everything the interviewer said leading up to the question (given as context) — it often contains the real intent, constraints or a scenario to respond to.
- Be impressive but human: lead with the direct answer, back it with one concrete example (situation → what you did → result/impact), then close with how it applies to this role. Show judgement, trade-offs and ownership — the things senior people mention.
- Keep it tight enough to say in about 45–75 seconds (roughly 90–160 words). Yes/no or factual questions get a short direct answer plus one sentence of context.
- No markdown, no bullet lists, no headings, no "Great question", no restating the question, no sign-off. Plain paragraphs only.
- If the question is unclear or not actually a question, give the most useful short reply and, if helpful, one clarifying question.

## CANDIDATE PROFILE
${ctx.profileText}
${ctx.jobDescription ? `\n## JOB DESCRIPTION\n${ctx.jobDescription}` : ''}${ctx.notes ? `\n## MY OWN NOTES FOR THIS INTERVIEW\n${ctx.notes}` : ''}${ctx.previousSummaries ? `\n## WHAT HAPPENED IN EARLIER ROUNDS WITH THIS COMPANY\n${ctx.previousSummaries}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* routes: context listing                                             */
/* ------------------------------------------------------------------ */
router.get('/context', authMiddleware, async (req, res) => {
  try {
    const rows = await db.getAll(
      `SELECT id, job_title, company_name, applied_at FROM applications WHERE user_id = ${p(1)} ORDER BY applied_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({
      applications: rows.map((r) => ({ id: r.id, jobTitle: r.job_title || '', companyName: r.company_name || '', appliedAt: r.applied_at }))
    });
  } catch (error) {
    console.error('Interview context error:', error);
    res.status(500).json({ error: 'Failed to load applications', details: error.message });
  }
});

// Interview events from the last 2 days onward (so a meeting that just ended can still be picked).
router.get('/events', authMiddleware, async (req, res) => {
  try {
    const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const rows = await db.getAll(
      `${calendar.EVENT_SELECT} WHERE e.user_id = ${p(1)} AND e.hidden = ${isPostgres ? 'FALSE' : '0'} AND e.end_at >= ${p(2)} ORDER BY e.start_at ASC LIMIT 60`,
      [req.user.id, since]
    );
    res.json({ events: rows.map(calendar.formatEvent).map((e) => ({
      id: e.id, title: e.title, companyName: e.companyName, jobTitle: e.jobTitle, stage: e.stage, status: e.status,
      start: e.start, end: e.end, applicationId: e.applicationId, hasRecording: Boolean(e.recordingUrl)
    })) });
  } catch (error) {
    console.error('Interview events error:', error);
    res.status(500).json({ error: 'Failed to load interview events', details: error.message });
  }
});

router.get('/events/:id/brief', authMiddleware, async (req, res) => {
  try {
    const row = await loadEventRow(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Event not found' });
    const event = calendar.formatEvent(row);
    const previous = await previousSteps(req.user.id, row);
    const application = await loadApplication(req.user.id, row.application_id);
    res.json({
      event,
      previous: previous.map((e) => ({ id: e.id, stage: e.stage, status: e.status, start: e.start, title: e.title, notes: e.notes, summary: e.summary, hasRecording: Boolean(e.recordingUrl) })),
      application: application ? {
        id: application.id, jobTitle: application.job_title, companyName: application.company_name,
        jdLink: application.jd_link, jdContent: String(application.jd_content || '').slice(0, 6000),
        hasDoc: Boolean(application.cv_doc_url), hasPdf: Boolean(application.cv_pdf_url), appliedAt: application.applied_at
      } : null
    });
  } catch (error) {
    console.error('Interview brief error:', error);
    res.status(500).json({ error: 'Failed to load meeting brief', details: error.message });
  }
});

/* ------------------------------------------------------------------ */
/* routes: streaming answer                                            */
/* ------------------------------------------------------------------ */
router.post('/answer', authMiddleware, async (req, res) => {
  const question = String(req.body.question || '').trim().slice(0, MAX_QUESTION);
  if (!question) return res.status(400).json({ error: 'Question is required' });

  const applicationId = req.body.applicationId ? Number(req.body.applicationId) : null;
  const eventId = req.body.eventId ? Number(req.body.eventId) : null;
  const leadIn = String(req.body.context || '').trim().slice(-MAX_CONTEXT);
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-MAX_HISTORY) : [];

  let ctx;
  try {
    ctx = await buildContext(req.user.id, { applicationId, eventId });
    if (!ctx) return res.status(404).json({ error: 'Profile not found' });
  } catch (error) {
    console.error('Interview context build error:', error);
    return res.status(500).json({ error: 'Failed to load interview context', details: error.message });
  }

  const messages = [{ role: 'system', content: systemPrompt(ctx) }];
  for (const turn of history) {
    if (turn?.question && turn?.answer) {
      messages.push({ role: 'user', content: String(turn.question).slice(0, 600) });
      messages.push({ role: 'assistant', content: String(turn.answer).slice(0, 1200) });
    }
  }
  messages.push({
    role: 'user',
    content: leadIn
      ? `What the interviewer said leading up to this (context, do not answer it separately):\n"""${leadIn}"""\n\nThe question:\n${question}`
      : question
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const abort = new AbortController();
  req.on('close', () => abort.abort());

  try {
    let full = '';
    await streamChat({
      messages,
      kind: 'fast',
      temperature: 0.6,
      max_tokens: 420,
      signal: abort.signal,
      onToken: (token) => { full += token; send('token', { t: token }); }
    });
    send('done', { answer: full.trim() });
  } catch (error) {
    if (!abort.signal.aborted) {
      console.error('Interview answer stream error:', error);
      send('error', { error: error.message || 'Failed to generate answer' });
    }
  } finally {
    res.end();
  }
});

/* ------------------------------------------------------------------ */
/* routes: recording upload + summary                                  */
/* ------------------------------------------------------------------ */
async function storeRecording(buffer, filename, mime) {
  if (useCloudStorage) {
    const storage = require('../services/storage');
    const result = await storage.uploadFile(buffer, filename, mime);
    return result.url || result.filename;
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

function parseJsonField(value, fallback) {
  if (value == null || value === '') return fallback;
  try { const v = JSON.parse(value); return v ?? fallback; } catch { return fallback; }
}

router.post('/events/:id/recording', authMiddleware, upload.single('recording'), async (req, res) => {
  try {
    const row = await loadEventRow(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Event not found' });

    const transcript = parseJsonField(req.body.transcript, []).filter((t) => t && typeof t.text === 'string')
      .map((t) => ({ at: Number(t.at) || 0, speaker: String(t.speaker || 'Interviewer').slice(0, 80), text: String(t.text).slice(0, 2000) }));
    const qa = parseJsonField(req.body.qa, []).filter((t) => t && t.question)
      .map((t) => ({ question: String(t.question).slice(0, 1000), answer: String(t.answer || '').slice(0, 2000) }));
    const durationSec = Math.max(0, Math.round(Number(req.body.durationSec) || 0));

    let recordingUrl = row.recording_url || null;
    if (req.file && req.file.buffer?.length) {
      const ext = /ogg/.test(req.file.mimetype) ? 'ogg' : 'webm';
      const filename = `interview_${row.id}_${uuidv4()}.${ext}`;
      recordingUrl = await storeRecording(req.file.buffer, filename, req.file.mimetype || 'audio/webm');
    }

    // Meeting summary for the next round (best effort — the upload succeeds even if the model is down).
    let summary = row.summary || '';
    let summaryError = null;
    if (transcript.length || qa.length) {
      try {
        const profile = await loadUserProfile(req.user.id);
        summary = await summarizeInterview({
          candidateName: profile?.user?.full_name || 'the candidate',
          companyName: row.company_name || '',
          jobTitle: row.job_title || '',
          stage: row.stage || '',
          transcript,
          qa
        });
      } catch (err) {
        summaryError = err.message;
        console.error('Interview summary error:', err);
      }
    }

    const sets = { recording_url: recordingUrl, recording_duration_sec: durationSec || null, recorded_at: new Date().toISOString(), transcript: JSON.stringify(transcript), summary: summary || null };
    const cols = Object.keys(sets);
    await db.runQuery(
      `UPDATE calendar_events SET ${cols.map((c, i) => `${c} = ${p(i + 1)}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ${p(cols.length + 1)} AND user_id = ${p(cols.length + 2)}`,
      [...cols.map((c) => sets[c]), row.id, req.user.id]
    );
    contextCache.clear();

    const updated = calendar.formatEvent(await loadEventRow(req.user.id, row.id));
    res.json({ event: updated, summary: updated.summary, ...(summaryError ? { warning: `Recording saved, but the summary could not be generated: ${summaryError}` } : {}) });
  } catch (error) {
    console.error('Interview recording upload error:', error);
    res.status(500).json({ error: 'Failed to save the recording', details: error.message });
  }
});

module.exports = router;
