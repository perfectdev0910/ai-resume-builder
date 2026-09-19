const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { loadUserProfile, describeProfile } = require('../services/profile');
const { answerApplicationQuestion } = require('../services/openai');

const router = express.Router();

const MAX_QUESTIONS = 10;
const MAX_QUESTION_LENGTH = 1000;
const CONCURRENCY = 3;

// Answer application-form questions with DeepSeek, grounded in the user's profile + the JD.
// Body: { questions: string[], jobDescription, jobTitle?, companyName? } — each answer is two sentences.
router.post('/', authMiddleware, async (req, res) => {
  try {
    const jobDescription = String(req.body.jobDescription || '').trim();
    const rawQuestions = Array.isArray(req.body.questions) ? req.body.questions : [];
    const questions = rawQuestions
      .map((q) => String(q || '').trim())
      .filter(Boolean)
      .slice(0, MAX_QUESTIONS);

    if (!jobDescription) return res.status(400).json({ error: 'Job description is required' });
    if (!questions.length) return res.status(400).json({ error: 'At least one question is required' });
    if (questions.some((q) => q.length > MAX_QUESTION_LENGTH)) {
      return res.status(400).json({ error: `Each question must be under ${MAX_QUESTION_LENGTH} characters` });
    }

    const profile = await loadUserProfile(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    const profileText = describeProfile(profile);

    const jobTitle = String(req.body.jobTitle || '').trim();
    const companyName = String(req.body.companyName || '').trim();

    // A few at a time: fast for the user without hammering the upstream rate limit.
    const results = new Array(questions.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < questions.length) {
        const i = cursor++;
        try {
          const { answer } = await answerApplicationQuestion({
            question: questions[i], profileText, jobDescription, jobTitle, companyName
          });
          results[i] = { question: questions[i], answer };
        } catch (err) {
          results[i] = { question: questions[i], answer: '', error: err.message };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, questions.length) }, worker));

    const failed = results.filter((r) => r.error).length;
    res.status(failed === results.length ? 502 : 200).json({
      answers: results,
      ...(failed ? { error: failed === results.length ? 'Failed to answer the questions' : `${failed} of ${results.length} questions failed` } : {})
    });
  } catch (error) {
    console.error('Answer questions error:', error);
    res.status(500).json({ error: 'Failed to answer questions', details: error.message });
  }
});

module.exports = router;
