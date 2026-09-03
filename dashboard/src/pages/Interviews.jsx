import { useEffect, useMemo, useState } from 'react';
import { applicationsAPI, interviewsAPI } from '../utils/api';
import { formatDateKey } from '../utils/timezone';

const STEPS = [
  { id: 'phone_call', label: 'Phone call', className: 'bg-green-100 text-green-800' },
  { id: 'hr_call', label: 'HR call', className: 'bg-blue-100 text-blue-800' },
  { id: 'hiring_manager', label: 'Hiring Manager', className: 'bg-indigo-100 text-indigo-800' },
  { id: 'technical', label: 'Technical', className: 'bg-amber-100 text-amber-800' },
  { id: 'onsite', label: 'Onsite', className: 'bg-purple-100 text-purple-800' },
  { id: 'offer', label: 'Offer', className: 'bg-emerald-100 text-emerald-800' }
];

const STATUSES = [
  { id: 'todo', label: 'To-do', className: 'bg-pink-100 text-pink-800' },
  { id: 'waiting_feedback', label: 'Waiting Feedback', className: 'bg-sky-100 text-sky-800' },
  { id: 'passed', label: 'Passed', className: 'bg-green-100 text-green-800' },
  { id: 'rejected', label: 'Rejected', className: 'bg-gray-100 text-gray-600' }
];

const TECH_OPTIONS = ['Backend', 'Frontend', 'Full-stack', 'DevOps', 'Cloud', 'AI/ML', 'Java', 'Python', 'React', 'Node.js', 'AWS'];

function optionById(list, id) {
  return list.find((item) => item.id === id) || null;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function PillSelect({ value, options, placeholder, onChange }) {
  const selected = optionById(options, value);
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || '')}
      className={`w-full min-w-[8rem] border-0 bg-transparent text-xs font-medium rounded-md px-2 py-1 focus:ring-2 focus:ring-primary-500 ${
        selected ? selected.className : 'text-gray-400'
      }`}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  );
}

export default function Interviews() {
  const [interviews, setInterviews] = useState([]);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [openItem, setOpenItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async (q = search) => {
    try {
      const [interviewRes, appsRes] = await Promise.all([
        interviewsAPI.getAll(q ? { q } : {}),
        applicationsAPI.getAll({ limit: 100 })
      ]);
      const rows = interviewRes.data?.interviews || [];
      setInterviews(rows);
      setApplications(appsRes.data?.applications || []);
      setExpanded((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          if (next[row.id] === undefined) next[row.id] = true;
        }
        return next;
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load interviews');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const replaceItem = (updated) => {
    setInterviews((prev) => prev.map((parent) => {
      if (parent.id === updated.id) return { ...parent, ...updated, children: parent.children };
      return {
        ...parent,
        children: (parent.children || []).map((child) => (
          child.id === updated.id ? { ...child, ...updated, children: [] } : child
        ))
      };
    }));
    setOpenItem((current) => (current?.id === updated.id ? { ...current, ...updated } : current));
  };

  const persist = async (id, patch) => {
    setSaving(true);
    try {
      const response = await interviewsAPI.update(id, patch);
      replaceItem(response.data.interview);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save interview');
    } finally {
      setSaving(false);
    }
  };

  const addCompany = async () => {
    try {
      const response = await interviewsAPI.create({ companyName: 'Untitled company', status: 'todo' });
      setInterviews((prev) => [...prev, { ...response.data.interview, children: [] }]);
      setExpanded((prev) => ({ ...prev, [response.data.interview.id]: true }));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add company');
    }
  };

  const addSubItem = async (parent) => {
    try {
      const response = await interviewsAPI.create({
        parentId: parent.id,
        companyName: parent.companyName,
        jobTitle: 'New interview',
        jdLink: parent.jdLink,
        techStack: parent.techStack,
        status: 'todo'
      });
      const child = { ...response.data.interview, children: [] };
      setInterviews((prev) => prev.map((row) => (
        row.id === parent.id ? { ...row, children: [...(row.children || []), child] } : row
      )));
      setExpanded((prev) => ({ ...prev, [parent.id]: true }));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add sub-item');
    }
  };

  const removeItem = async (item) => {
    if (!confirm(`Delete ${item.jobTitle || item.companyName}?`)) return;
    try {
      await interviewsAPI.delete(item.id);
      setInterviews((prev) => prev
        .filter((row) => row.id !== item.id)
        .map((row) => ({
          ...row,
          children: (row.children || []).filter((child) => child.id !== item.id)
        })));
      if (openItem?.id === item.id) setOpenItem(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete interview');
    }
  };

  const visibleRows = useMemo(() => {
    const rows = [];
    for (const parent of interviews) {
      rows.push({ item: parent, depth: 0, parent });
      if (expanded[parent.id]) {
        for (const child of parent.children || []) {
          rows.push({ item: child, depth: 1, parent });
        }
      }
    }
    return rows;
  }, [interviews, expanded]);

  const handleSearch = (e) => {
    e.preventDefault();
    setLoading(true);
    load(search);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Interview scheduling</h1>
          <p className="text-gray-500 mt-1">Track companies, rounds, and meeting details in one table</p>
        </div>
        <button type="button" onClick={addCompany} className="btn btn-primary">
          + New company
        </button>
      </div>

      <form onSubmit={handleSearch} className="card p-4 flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input py-2 max-w-md"
          placeholder="Search company, role, or contact"
        />
        <button type="submit" className="btn btn-secondary py-2">Search</button>
        {search && (
          <button
            type="button"
            className="btn btn-secondary py-2"
            onClick={() => { setSearch(''); setLoading(true); load(''); }}
          >
            Clear
          </button>
        )}
        {saving && <span className="text-xs text-gray-400 ml-auto">Saving…</span>}
      </form>

      {error && (
        <div className="rounded-lg bg-red-50 text-red-700 text-sm px-4 py-2">{error}</div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium w-64">Company</th>
                <th className="px-3 py-3 font-medium w-40">JD</th>
                <th className="px-3 py-3 font-medium w-52">Tech stack</th>
                <th className="px-3 py-3 font-medium w-40">Resume</th>
                <th className="px-3 py-3 font-medium w-36">Step</th>
                <th className="px-3 py-3 font-medium w-36">Date</th>
                <th className="px-3 py-3 font-medium w-48">Meeting link</th>
                <th className="px-3 py-3 font-medium w-44">Contact</th>
                <th className="px-3 py-3 font-medium w-40">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRows.map(({ item, depth, parent }) => (
                <InterviewRow
                  key={item.id}
                  item={item}
                  depth={depth}
                  expanded={!!expanded[item.id]}
                  applications={applications}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                  onChange={(patch) => persist(item.id, patch)}
                  onOpen={() => setOpenItem(item)}
                  onAddChild={() => addSubItem(parent || item)}
                />
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-gray-400">
                    No interviews yet. Add a company to start scheduling.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addCompany}
          className="w-full text-left px-4 py-3 text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-700"
        >
          + New page
        </button>
      </div>
      <datalist id="interview-tech-options">
        {TECH_OPTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      {openItem && (
        <InterviewDrawer
          item={openItem}
          applications={applications}
          onClose={() => setOpenItem(null)}
          onChange={(patch) => persist(openItem.id, patch)}
          onDelete={() => removeItem(openItem)}
        />
      )}
    </div>
  );
}

function InterviewRow({ item, depth, expanded, applications, onToggle, onChange, onOpen, onAddChild }) {
  const isParent = !item.parentId;
  const title = isParent ? item.companyName : (item.jobTitle || item.companyName);
  const resumeLabel = item.resumeLabel || (item.applicationId ? 'Resume' : '');

  return (
    <tr className="group hover:bg-gray-50">
      <td className="px-4 py-2 align-top">
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 18 }}>
          {isParent ? (
            <button type="button" onClick={onToggle} className="w-5 h-5 text-gray-400 hover:text-gray-700">
              <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className="w-5" />
          )}
          <input
            defaultValue={title}
            key={`${item.id}-${title}`}
            className="flex-1 bg-transparent border-0 text-sm font-medium text-gray-900 focus:ring-0 p-0"
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (!value || value === title) return;
              onChange(isParent ? { companyName: value } : { jobTitle: value });
            }}
          />
          <button
            type="button"
            onClick={onOpen}
            className="opacity-0 group-hover:opacity-100 text-[10px] font-semibold uppercase tracking-wide text-primary-600 px-1.5 py-0.5 rounded border border-primary-200 bg-white"
          >
            Open
          </button>
        </div>
        {isParent && (
          <button type="button" onClick={onAddChild} className="ml-6 mt-1 text-xs text-gray-400 hover:text-primary-600">
            + New sub-item
          </button>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <input
          defaultValue={item.jdLink}
          key={`${item.id}-jd-${item.jdLink}`}
          placeholder="https://"
          className="w-full bg-transparent border-0 text-xs text-primary-600 focus:ring-0 p-0"
          onBlur={(e) => {
            if (e.target.value !== item.jdLink) onChange({ jdLink: e.target.value.trim() });
          }}
        />
        {item.jdLink && (
          <a href={item.jdLink} target="_blank" rel="noreferrer" className="block text-[11px] text-gray-400 truncate">
            {hostFromUrl(item.jdLink)}
          </a>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <TechStackEditor value={item.techStack} onChange={(techStack) => onChange({ techStack })} />
      </td>
      <td className="px-3 py-2 align-top">
        <select
          value={item.applicationId || ''}
          onChange={(e) => onChange({ applicationId: e.target.value ? Number(e.target.value) : null })}
          className="w-full bg-transparent border-0 text-xs text-gray-700 focus:ring-0 p-0"
        >
          <option value="">{resumeLabel || 'Link resume'}</option>
          {applications.map((app) => (
            <option key={app.id} value={app.id}>
              {app.companyName || 'Untitled'} — {app.jobTitle || 'Resume'}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 align-top">
        <PillSelect value={item.step} options={STEPS} placeholder="Step" onChange={(step) => onChange({ step })} />
      </td>
      <td className="px-3 py-2 align-top">
        <input
          type="date"
          value={item.interviewDate || ''}
          onChange={(e) => onChange({ interviewDate: e.target.value })}
          className="w-full bg-transparent border-0 text-xs text-gray-700 focus:ring-0 p-0"
        />
        {item.interviewDate && (
          <p className="text-[11px] text-gray-400">{formatDateKey(item.interviewDate, 'MMM d, yyyy')}</p>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <input
          defaultValue={item.meetingLink}
          key={`${item.id}-meet-${item.meetingLink}`}
          placeholder="Meet / Teams / phone"
          className="w-full bg-transparent border-0 text-xs text-gray-700 focus:ring-0 p-0"
          onBlur={(e) => {
            if (e.target.value !== item.meetingLink) onChange({ meetingLink: e.target.value.trim() });
          }}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <input
          defaultValue={item.contact}
          key={`${item.id}-contact-${item.contact}`}
          placeholder="Name or email"
          className="w-full bg-transparent border-0 text-xs text-gray-700 focus:ring-0 p-0"
          onBlur={(e) => {
            if (e.target.value !== item.contact) onChange({ contact: e.target.value.trim() });
          }}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <PillSelect value={item.status} options={STATUSES} placeholder="Status" onChange={(status) => onChange({ status })} />
      </td>
    </tr>
  );
}

function TechStackEditor({ value = [], onChange }) {
  const [draft, setDraft] = useState('');

  const add = (tag) => {
    const next = tag.trim();
    if (!next || value.includes(next)) return;
    onChange([...value, next]);
    setDraft('');
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1">
        {value.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onChange(value.filter((item) => item !== tag))}
            className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[11px]"
            title="Remove"
          >
            {tag}
          </button>
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          }
        }}
        list="interview-tech-options"
        placeholder="Add tag"
        className="w-full bg-transparent border-0 text-xs text-gray-500 focus:ring-0 p-0"
      />
    </div>
  );
}

function InterviewDrawer({ item, applications, onClose, onChange, onDelete }) {
  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <button type="button" className="flex-1 bg-black/20" onClick={onClose} aria-label="Close" />
      <aside className="w-full max-w-md h-full bg-white shadow-xl border-l border-gray-200 overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Interview</p>
            <h2 className="text-xl font-semibold text-gray-900">{item.jobTitle || item.companyName}</h2>
            <p className="text-sm text-gray-500">{item.companyName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">Close</button>
        </div>

        <label className="block">
          <span className="label">Company</span>
          <input className="input" defaultValue={item.companyName} onBlur={(e) => onChange({ companyName: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Role / round</span>
          <input className="input" defaultValue={item.jobTitle} onBlur={(e) => onChange({ jobTitle: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Job description URL</span>
          <input className="input" defaultValue={item.jdLink} onBlur={(e) => onChange({ jdLink: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Resume from history</span>
          <select
            className="input"
            value={item.applicationId || ''}
            onChange={(e) => onChange({ applicationId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">None</option>
            {applications.map((app) => (
              <option key={app.id} value={app.id}>
                {app.companyName || 'Untitled'} — {app.jobTitle || 'Resume'}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Step</span>
            <select className="input" value={item.step || ''} onChange={(e) => onChange({ step: e.target.value })}>
              <option value="">None</option>
              {STEPS.map((step) => <option key={step.id} value={step.id}>{step.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Status</span>
            <select className="input" value={item.status || ''} onChange={(e) => onChange({ status: e.target.value })}>
              {STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="label">Date</span>
          <input type="date" className="input" value={item.interviewDate || ''} onChange={(e) => onChange({ interviewDate: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Meeting link</span>
          <input className="input" defaultValue={item.meetingLink} onBlur={(e) => onChange({ meetingLink: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Contact</span>
          <input className="input" defaultValue={item.contact} onBlur={(e) => onChange({ contact: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Notes</span>
          <textarea
            className="input min-h-[120px]"
            defaultValue={item.notes}
            onBlur={(e) => onChange({ notes: e.target.value })}
          />
        </label>
        <button type="button" onClick={onDelete} className="btn btn-danger w-full">Delete</button>
      </aside>
    </div>
  );
}
