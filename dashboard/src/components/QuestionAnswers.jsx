import { useState } from 'react';
import { cvAPI } from '../utils/api';

const MAX_QUESTIONS = 10;

const SUGGESTED = [
  'Why do you want to work at this company?',
  'Why are you a good fit for this role?',
  'Describe a challenging project you worked on and how you handled it.',
  'What are your salary expectations?',
  'When can you start?'
];

let nextId = 1;
const newRow = (question = '') => ({ id: nextId++, question, answer: '', loading: false, error: '', copied: false });

/**
 * Application-form questions answered by DeepSeek in the candidate's voice, using their
 * profile and the job description entered above.
 */
export default function QuestionAnswers({ jobDescription, companyName, jobTitle }) {
  const [rows, setRows] = useState([newRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const hasJd = Boolean(String(jobDescription || '').trim());
  const update = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = (question = '') => setRows((prev) => (prev.length >= MAX_QUESTIONS ? prev : [...prev, newRow(question)]));
  const removeRow = (id) => setRows((prev) => (prev.length === 1 ? [newRow()] : prev.filter((r) => r.id !== id)));

  // Ask DeepSeek for the given rows (all unanswered ones by default, or a single row to regenerate).
  const answer = async (targetIds) => {
    const targets = rows.filter((r) => targetIds.includes(r.id) && r.question.trim());
    if (!targets.length) return;
    setError('');
    setBusy(true);
    setRows((prev) => prev.map((r) => (targetIds.includes(r.id) ? { ...r, loading: true, error: '' } : r)));
    try {
      const res = await cvAPI.answerQuestions({
        questions: targets.map((r) => r.question.trim()),
        jobDescription,
        companyName,
        jobTitle
      });
      const answers = res.data?.answers || [];
      setRows((prev) => prev.map((r) => {
        const idx = targets.findIndex((t) => t.id === r.id);
        if (idx < 0) return r;
        const a = answers[idx] || {};
        return { ...r, loading: false, answer: a.answer || r.answer, error: a.error || '', copied: false };
      }));
      if (res.data?.error) setError(res.data.error);
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Failed to answer questions';
      setError(message);
      setRows((prev) => prev.map((r) => (targetIds.includes(r.id) ? { ...r, loading: false, error: message } : r)));
    } finally {
      setBusy(false);
    }
  };

  const answerAll = () => answer(rows.filter((r) => r.question.trim() && !r.answer).map((r) => r.id));
  const answerable = rows.some((r) => r.question.trim() && !r.answer);

  const copy = async (row) => {
    try {
      await navigator.clipboard.writeText(row.answer);
      update(row.id, { copied: true });
      setTimeout(() => update(row.id, { copied: false }), 1500);
    } catch {
      // clipboard unavailable — the textarea is selectable anyway
    }
  };

  return (
    <div className="card p-6 space-y-4" data-question-answers>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Application questions</h2>
          <p className="text-sm text-gray-500 mt-1">
            Paste the questions from the application form. Each one gets a two-sentence answer in your voice, based on your profile and the job description above.
          </p>
        </div>
      </div>

      {!hasJd && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 dark:bg-amber-900/30 dark:text-amber-200">
          Paste the job description above first — answers are tailored to it.
        </p>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 dark:bg-red-900/30 dark:text-red-200">{error}</div>
      )}

      <div className="space-y-4">
        {rows.map((row, index) => (
          <div key={row.id} className="rounded-lg border border-gray-200 p-4 space-y-3 dark:border-gray-700" data-question-row>
            <div className="flex items-start gap-2">
              <span className="mt-2.5 text-xs font-semibold text-gray-400 w-5 shrink-0">Q{index + 1}</span>
              <textarea
                className="input min-h-[44px] flex-1"
                rows={1}
                placeholder="e.g. Why do you want to work at this company?"
                value={row.question}
                onChange={(e) => update(row.id, { question: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && row.question.trim() && hasJd && !row.loading) {
                    e.preventDefault();
                    answer([row.id]);
                  }
                }}
                disabled={row.loading}
              />
              <button
                type="button"
                className="btn btn-primary py-2 px-3 text-sm shrink-0"
                disabled={!hasJd || !row.question.trim() || row.loading}
                onClick={() => answer([row.id])}
                title={row.answer ? 'Regenerate answer' : 'Get answer'}
              >
                {row.loading ? (
                  <span className="inline-flex items-center gap-2"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />Thinking…</span>
                ) : row.answer ? 'Regenerate' : 'Answer'}
              </button>
              <button
                type="button"
                className="text-gray-400 hover:text-red-600 px-1 mt-2"
                onClick={() => removeRow(row.id)}
                aria-label="Remove question"
                title="Remove"
              >
                ✕
              </button>
            </div>

            {row.error && <p className="text-xs text-red-600 pl-7">{row.error}</p>}

            {(row.answer || row.loading) && (
              <div className="pl-7 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Answer</span>
                  {row.answer && (
                    <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => copy(row)}>
                      {row.copied ? 'Copied!' : 'Copy'}
                    </button>
                  )}
                </div>
                {row.loading && !row.answer ? (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-3 bg-gray-200 rounded w-full dark:bg-gray-700" />
                    <div className="h-3 bg-gray-200 rounded w-11/12 dark:bg-gray-700" />
                    <div className="h-3 bg-gray-200 rounded w-4/5 dark:bg-gray-700" />
                  </div>
                ) : (
                  <textarea
                    className="input min-h-[72px] text-sm"
                    value={row.answer}
                    onChange={(e) => update(row.id, { answer: e.target.value })}
                    data-answer
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary py-1.5 px-3 text-sm" onClick={() => addRow()} disabled={rows.length >= MAX_QUESTIONS}>
            + Add question
          </button>
          <div className="relative group">
            <button type="button" className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1.5 dark:hover:text-gray-200">Suggestions ▾</button>
            <div className="absolute left-0 top-full z-10 hidden group-hover:block group-focus-within:block w-80 rounded-lg border border-gray-200 bg-white shadow-lg py-1 dark:border-gray-700 dark:bg-gray-900">
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="block w-full text-left text-sm px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => {
                    const empty = rows.find((r) => !r.question.trim());
                    if (empty) update(empty.id, { question: q });
                    else addRow(q);
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs text-gray-400">{rows.length}/{MAX_QUESTIONS}</span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!hasJd || !answerable || busy}
          onClick={answerAll}
          data-answer-all
        >
          {busy ? 'Answering…' : 'Answer all with AI'}
        </button>
      </div>
    </div>
  );
}
