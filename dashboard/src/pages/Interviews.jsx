import { useEffect, useMemo, useState } from 'react';
import { applicationsAPI, interviewsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatInTimeZone, resolveTimeZone } from '../utils/timezone';

const STAGE_META = {
  hr_screen: { label: 'HR Screen', className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' },
  assessment: { label: 'Assessment', className: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' },
  technical: { label: 'Technical', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  background_check: { label: 'Background Check', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200' },
  onsite_final: { label: 'Onsite / Final', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200' },
  offer: { label: 'Offer', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' }
};

const PLATFORM_LABELS = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Teams',
  phone: 'Phone',
  other: 'Other'
};

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' }
];

function stageLabel(stage) {
  return STAGE_META[stage]?.label || stage;
}

function stageClass(stage) {
  return STAGE_META[stage]?.className || 'bg-gray-100 text-gray-700';
}

function toLocalInputs(iso, timeZone) {
  if (!iso) return { date: '', time: '' };
  try {
    const formatted = formatInTimeZone(iso, timeZone, "yyyy-MM-dd'T'HH:mm");
    const [date, time] = formatted.split('T');
    return { date: date || '', time: time || '' };
  } catch {
    return { date: '', time: '' };
  }
}

function localInputsToIso(date, time, timeZone) {
  if (!date) return null;
  const hhmm = time || '09:00';
  const guess = new Date(`${date}T${hhmm}:00`);
  if (Number.isNaN(guess.getTime())) return null;
  // Store as ISO UTC; browser local is acceptable for scheduling inputs
  return guess.toISOString();
}

function resumeHref(item) {
  return item.resumePdfUrl || item.resumeDocUrl || null;
}

export default function Interviews() {
  const { user } = useAuth();
  const timeZone = resolveTimeZone(user?.timezone);
  const [interviews, setInterviews] = useState([]);
  const [stages, setStages] = useState(Object.keys(STAGE_META));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [stageFilter, setStageFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    try {
      const params = { tab };
      if (stageFilter) params.stage = stageFilter;
      if (search.trim()) params.q = search.trim();
      const res = await interviewsAPI.getAll(params);
      const rows = res.data?.interviews || [];
      setInterviews(rows);
      if (res.data?.stages?.length) setStages(res.data.stages);
      setSelectedId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id || null;
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load interviews');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
  }, [tab, stageFilter]);

  const selected = useMemo(
    () => interviews.find((item) => item.id === selectedId) || null,
    [interviews, selectedId]
  );

  const replaceInterview = (updated) => {
    setInterviews((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  };

  const persist = async (id, patch) => {
    setSaving(true);
    setError('');
    try {
      const res = await interviewsAPI.update(id, patch);
      replaceInterview(res.data.interview);
      return res.data.interview;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const runProgress = async (id, action) => {
    setSaving(true);
    setError('');
    try {
      const res = await interviewsAPI.progress(id, action);
      const updated = res.data.interview;
      if (tab !== 'all') {
        await load();
        setSelectedId(updated.id);
      } else {
        replaceInterview(updated);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update progress');
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setLoading(true);
    load();
  };

  const handleCreated = async (interview) => {
    setShowAdd(false);
    setTab('all');
    setStageFilter('');
    setSearch('');
    setLoading(true);
    await load();
    setSelectedId(interview.id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Interviews</h1>
          <p className="text-sm text-gray-500 mt-1">Track stages for each company from your applications</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + Add Interview
        </button>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearch} className="relative flex-1 min-w-[220px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input py-2 pl-10"
            placeholder="Search company, role or interviewer..."
          />
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </form>

        <div className="flex gap-1 p-1 rounded-full bg-gray-100 dark:bg-gray-800">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                tab === item.id
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="input py-2 w-auto min-w-[140px]"
        >
          <option value="">All stages</option>
          {stages.map((stage) => (
            <option key={stage} value={stage}>{stageLabel(stage)}</option>
          ))}
        </select>

        {saving && <span className="text-xs text-gray-400">Saving…</span>}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 text-red-700 text-sm px-4 py-2 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)] gap-4 items-start">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/60">
                <tr>
                  <th className="px-4 py-3 font-medium">Company / Role</th>
                  <th className="px-3 py-3 font-medium">Stage</th>
                  <th className="px-3 py-3 font-medium">Date & Time</th>
                  <th className="px-3 py-3 font-medium">Duration</th>
                  <th className="px-3 py-3 font-medium">Platform</th>
                  <th className="px-3 py-3 font-medium">Resume</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {interviews.map((item) => {
                  const active = item.id === selectedId;
                  const href = resumeHref(item);
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`cursor-pointer transition-colors ${
                        active
                          ? 'bg-amber-50/80 dark:bg-amber-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {active && <span className="w-2 h-2 rounded-full bg-primary-500 shrink-0" />}
                          <div className={!active ? 'pl-4' : ''}>
                            <p className="font-medium text-gray-900 dark:text-gray-100">{item.companyName}</p>
                            <p className="text-xs text-gray-500">{item.jobTitle || '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${stageClass(item.stage)}`}>
                          {stageLabel(item.stage)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {item.interviewAt
                          ? formatInTimeZone(item.interviewAt, timeZone, 'HH:mm MMM d')
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-gray-600">{item.durationMinutes ? `${item.durationMinutes}m` : '—'}</td>
                      <td className="px-3 py-3 text-gray-600">{PLATFORM_LABELS[item.platform] || item.platform || '—'}</td>
                      <td className="px-3 py-3">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200"
                            title={item.resumeLabel || 'Resume'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {interviews.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center text-gray-400">
                      No interviews yet. Add one from a company you already applied to.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100 dark:border-gray-800">
            Click a row — everything in the panel is editable: stage, status, time, link, resume, interviewer, notes.
          </p>
        </div>

        {selected ? (
          <InterviewDetailPanel
            item={selected}
            timeZone={timeZone}
            stages={stages}
            saving={saving}
            onSave={(patch) => persist(selected.id, patch)}
            onProgress={(action) => runProgress(selected.id, action)}
            onDelete={async () => {
              if (!confirm(`Remove interview for ${selected.companyName}?`)) return;
              await interviewsAPI.delete(selected.id);
              setSelectedId(null);
              setLoading(true);
              await load();
            }}
          />
        ) : (
          <div className="card p-8 text-center text-gray-400">
            Select an interview to see details
          </div>
        )}
      </div>

      {showAdd && (
        <AddInterviewModal
          onClose={() => setShowAdd(false)}
          onCreated={handleCreated}
          onError={setError}
        />
      )}
    </div>
  );
}

function InterviewDetailPanel({ item, timeZone, stages, saving, onSave, onProgress, onDelete }) {
  const local = toLocalInputs(item.interviewAt, timeZone);
  const [date, setDate] = useState(local.date);
  const [time, setTime] = useState(local.time);
  const [duration, setDuration] = useState(item.durationMinutes || 30);
  const [platform, setPlatform] = useState(item.platform || 'google_meet');
  const [callLink, setCallLink] = useState(item.callLink || '');
  const [resumeLabel, setResumeLabel] = useState(item.resumeLabel || '');
  const [interviewer, setInterviewer] = useState(item.interviewer || '');
  const [notes, setNotes] = useState(item.notes || '');
  const [jobTitle, setJobTitle] = useState(item.jobTitle || '');
  const [jdLink, setJdLink] = useState(item.jdLink || '');
  const [stage, setStage] = useState(item.stage || 'hr_screen');

  useEffect(() => {
    const next = toLocalInputs(item.interviewAt, timeZone);
    setDate(next.date);
    setTime(next.time);
    setDuration(item.durationMinutes || 30);
    setPlatform(item.platform || 'google_meet');
    setCallLink(item.callLink || '');
    setResumeLabel(item.resumeLabel || '');
    setInterviewer(item.interviewer || '');
    setNotes(item.notes || '');
    setJobTitle(item.jobTitle || '');
    setJdLink(item.jdLink || '');
    setStage(item.stage || 'hr_screen');
  }, [item, timeZone]);

  const stageIndex = Math.max(0, stages.indexOf(item.stage));

  const saveDetails = () => {
    onSave({
      jobTitle,
      jdLink,
      resumeLabel,
      stage,
      interviewAt: localInputsToIso(date, time, timeZone),
      durationMinutes: Number(duration) || 30,
      platform,
      callLink,
      interviewer,
      notes
    });
  };

  return (
    <aside className="card p-5 space-y-5 sticky top-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400">Interview detail</p>
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">{item.companyName}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{item.jobTitle || 'No role set'}</p>
        <span className={`inline-flex mt-3 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${stageClass(item.stage)}`}>
          {stageLabel(item.stage)}
        </span>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          {stages.map((s, idx) => (
            <div key={s} className="flex-1 flex items-center">
              <div className={`w-3 h-3 rounded-full ${idx <= stageIndex ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
              {idx < stages.length - 1 && (
                <div className={`flex-1 h-0.5 ${idx < stageIndex ? 'bg-primary-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Stage {stageIndex + 1} of {stages.length} — {stageLabel(item.stage)}
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Update progress</p>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="input"
        >
          {stages.map((s) => (
            <option key={s} value={s}>{stageLabel(s)}</option>
          ))}
        </select>
        <div className="grid grid-cols-1 gap-2">
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => onProgress('complete')}>
            Mark completed
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => onProgress('next')}>
            Passed → Next stage
          </button>
          <button type="button" className="btn btn-danger" disabled={saving} onClick={() => onProgress('reject')}>
            Rejected / cancelled
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t border-gray-100 pt-4 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Everything is editable</p>
        <label className="block">
          <span className="label">Role</span>
          <input className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Date</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Time</span>
            <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Duration (min)</span>
            <input type="number" min="5" className="input" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Platform</span>
            <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {Object.entries(PLATFORM_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="label">Call link</span>
          <input className="input" value={callLink} onChange={(e) => setCallLink(e.target.value)} placeholder="https://meet.google.com/..." />
        </label>
        <label className="block">
          <span className="label">JD link</span>
          <input className="input" value={jdLink} onChange={(e) => setJdLink(e.target.value)} placeholder="https://..." />
        </label>
        <label className="block">
          <span className="label">Resume version</span>
          <input className="input" value={resumeLabel} onChange={(e) => setResumeLabel(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Interviewer</span>
          <input className="input" value={interviewer} onChange={(e) => setInterviewer(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Notes</span>
          <textarea className="input min-h-[90px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary w-full" disabled={saving} onClick={saveDetails}>
          Save details
        </button>
        <button type="button" className="btn btn-secondary w-full" onClick={onDelete}>
          Delete interview
        </button>
      </div>
    </aside>
  );
}

function AddInterviewModal({ onClose, onCreated, onError }) {
  const [q, setQ] = useState('');
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchCompanies = async (query = '') => {
    setLoading(true);
    try {
      const res = await applicationsAPI.getCompanies(query, { forInterview: true });
      setCompanies(res.data?.companies || []);
    } catch (err) {
      onError(err.response?.data?.error || 'Failed to load companies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies('');
  }, []);

  useEffect(() => {
    const id = setTimeout(() => fetchCompanies(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  const available = companies.filter((c) => !c.alreadyInterviewing);

  const create = async (company) => {
    setCreating(true);
    try {
      const res = await interviewsAPI.create({
        applicationId: company.applicationId,
        companyName: company.companyName
      });
      onCreated(res.data.interview);
    } catch (err) {
      onError(err.response?.data?.error || 'Failed to add interview');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-lg card p-5 space-y-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add interview</h3>
            <p className="text-sm text-gray-500 mt-1">
              Search a company from your applications. JD, resume, and job link fill automatically.
            </p>
          </div>
          <button type="button" className="text-gray-400 hover:text-gray-700" onClick={onClose}>Close</button>
        </div>

        <input
          autoFocus
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search companies..."
        />

        <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg dark:border-gray-800">
          {loading ? (
            <p className="p-4 text-sm text-gray-400">Loading…</p>
          ) : available.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">
              No available companies. Generate a CV first, or this company is already on the board.
            </p>
          ) : (
            available.map((company) => (
              <button
                key={`${company.companyName}-${company.applicationId}`}
                type="button"
                disabled={creating}
                onClick={() => create(company)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <p className="font-medium text-gray-900 dark:text-gray-100">{company.companyName}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {company.jobTitle || 'Unknown role'}
                  {company.jdLink ? ` · ${company.jdLink.replace(/^https?:\/\//, '').slice(0, 40)}` : ''}
                </p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
