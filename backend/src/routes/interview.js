/**
 * Live interview assistant used by the Interview Copilot Chrome extension.
 *
 * POST /api/interview/answer  — streams a spoken-style answer to an interviewer's question
 *                               (Server-Sent Events) grounded in the candidate's resume + the JD.
 * GET  /api/interview/context — lists applications the user can pick as interview context.
 */
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { loadUserProfile, describeProfile } = require('../services/profile');
const { streamChat } = require('../services/openai');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const router = express.Router();

const MAX_QUESTION = 1500;
const MAX_HISTORY = 6;          // previous Q&A turns sent back for continuity
const CONTEXT_TTL_MS = 5 * 60 * 1000;

// Built prompts are cached per user+application so each question costs one DB roundtrip at most.
const contextCache = new Map();

async function buildContext(userId, applicationId) {
  const key = `${userId}:${applicationId || 'none'}`;
  const cached = contextCache.get(key);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) return cached.value;

  const profile = await loadUserProfile(userId);
  if (!profile) return null;

  let application = null;
  if (applicationId) {
    application = await db.getOne(
      isPostgres
        ? 'SELECT id, job_title, company_name, jd_content FROM applications WHERE id = $1 AND user_id = $2'
        : 'SELECT id, job_title, company_name, jd_content FROM applications WHERE id = ? AND user_id = ?',
      [applicationId, userId]
    );
  }

  const value = {
    profileText: describeProfile(profile),
    candidateName: profile.user.full_name || 'the candidate',
    jobTitle: application?.job_title || '',
    companyName: application?.company_name || '',
    jobDescription: String(application?.jd_content || '').slice(0, 5000)
  };
  contextCache.set(key, { at: Date.now(), value });
  return value;
}

function systemPrompt(ctx) {
  return `You are ${ctx.candidateName}, a senior professional in a live job interview${ctx.companyName ? ` with ${ctx.companyName}` : ''}${ctx.jobTitle ? ` for the ${ctx.jobTitle} role` : ''}.
Answer the interviewer's question exactly as you would say it out loud — first person, natural spoken English, confident and warm, the way an experienced senior engineer/leader talks.

Rules:
- Ground everything in the CANDIDATE PROFILE below. Never invent employers, titles, dates or numbers. If the profile lacks a detail, speak in general terms from experience rather than fabricating specifics.
- Tailor to the JOB DESCRIPTION: mirror its priorities, tech and language where relevant.
- Be impressive but human: lead with the direct answer, back it with one concrete example (situation → what you did → result/impact), then close with how it applies to this role. Show judgement, trade-offs and ownership — the things senior people mention.
- Keep it tight enough to say in about 45–75 seconds (roughly 90–160 words). Yes/no or factual questions get a short direct answer plus one sentence of context.
- No markdown, no bullet lists, no headings, no "Great question", no restating the question, no sign-off. Plain paragraphs only.
- If the question is unclear or not actually a question, give the most useful short reply and, if helpful, one clarifying question.

## CANDIDATE PROFILE
${ctx.profileText}
${ctx.jobDescription ? `\n## JOB DESCRIPTION\n${ctx.jobDescription}` : ''}`;
}

router.get('/context', authMiddleware, async (req, res) => {
  try {
    const rows = await db.getAll(
      isPostgres
        ? 'SELECT id, job_title, company_name, applied_at FROM applications WHERE user_id = $1 ORDER BY applied_at DESC LIMIT 50'
        : 'SELECT id, job_title, company_name, applied_at FROM applications WHERE user_id = ? ORDER BY applied_at DESC LIMIT 50',
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

router.post('/answer', authMiddleware, async (req, res) => {
  const question = String(req.body.question || '').trim().slice(0, MAX_QUESTION);
  if (!question) return res.status(400).json({ error: 'Question is required' });

  const applicationId = req.body.applicationId ? Number(req.body.applicationId) : null;
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-MAX_HISTORY) : [];

  let ctx;
  try {
    ctx = await buildContext(req.user.id, applicationId);
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
  messages.push({ role: 'user', content: question });

  // Server-Sent Events: the extension renders tokens as they arrive.
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
      onToken: (token) => {
        full += token;
        send('token', { t: token });
      }
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

module.exports = router;
