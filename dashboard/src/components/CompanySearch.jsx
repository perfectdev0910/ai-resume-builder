import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { applicationsAPI } from '../utils/api';

function trimCompanyName(name) {
  return String(name || '').trim();
}

function prettyCompanyName(name) {
  const trimmed = trimCompanyName(name);
  if (!trimmed) return '';
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
    return trimmed;
  }
  return trimmed.replace(/\S+/g, (word) => {
    if (word.length <= 4 && word === word.toUpperCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function formatAppliedAt(value) {
  if (!value) return '';
  try {
    const date = typeof value === 'string' ? parseISO(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return '';
  }
}

export default function CompanySearch({ value, onChange, disabled }) {
  const [companies, setCompanies] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    applicationsAPI.getCompanies()
      .then((response) => {
        if (!cancelled) setCompanies(response.data?.companies || []);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onDocMouseDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const query = value.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!query) return companies.slice(0, 8);
    return companies
      .filter((company) => company.companyName.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.companyName.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.companyName.toLowerCase().startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return new Date(b.lastAppliedAt || 0) - new Date(a.lastAppliedAt || 0);
      })
      .slice(0, 8);
  }, [companies, query]);

  const exactMatch = useMemo(() => {
    const normalized = prettyCompanyName(value).toLowerCase();
    if (!normalized) return null;
    return companies.find((company) => company.companyName.toLowerCase() === normalized) || null;
  }, [companies, value]);

  const selectCompany = (company) => {
    onChange(company.companyName);
    setOpen(false);
  };

  const commitTypedValue = () => {
    const next = prettyCompanyName(value);
    if (next !== value) onChange(next);
  };

  return (
    <div ref={wrapRef} className="relative">
      <label className="label">Company Name *</label>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => commitTypedValue()}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          if (!pasted) return;
          e.preventDefault();
          onChange(prettyCompanyName(pasted));
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((index) => (index + 1) % matches.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((index) => (index - 1 + matches.length) % matches.length);
          } else if (e.key === 'Enter' && matches[highlight]) {
            e.preventDefault();
            selectCompany(matches[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="input"
        placeholder="Search or type a company name"
        disabled={disabled}
        autoComplete="off"
        required
      />

      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-white border border-gray-200 rounded-lg">
          {matches.map((company, index) => (
            <li key={company.companyName.toLowerCase()}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectCompany(company)}
                className={`w-full text-left px-3 py-2 ${
                  index === highlight ? 'bg-primary-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-gray-900">{company.companyName}</span>
                  {company.isDuplicate && (
                    <span className="shrink-0 text-xs font-medium text-yellow-800 bg-yellow-100 px-2 py-0.5 rounded">
                      Last 30 days
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Applied {formatAppliedAt(company.lastAppliedAt) || 'previously'}
                  {company.applicationCount > 1 ? ` · ${company.applicationCount} times` : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {exactMatch?.isDuplicate && (
        <p className="text-sm text-yellow-800 mt-2">
          You already applied to <strong>{exactMatch.companyName}</strong> in the last 30 days
          {formatAppliedAt(exactMatch.lastAppliedAt) ? ` (${formatAppliedAt(exactMatch.lastAppliedAt)})` : ''}.
        </p>
      )}
      {exactMatch && !exactMatch.isDuplicate && (
        <p className="text-xs text-gray-500 mt-2">
          Previous application{exactMatch.applicationCount > 1 ? 's' : ''} to this company
          {formatAppliedAt(exactMatch.lastAppliedAt) ? ` · last ${formatAppliedAt(exactMatch.lastAppliedAt)}` : ''}.
        </p>
      )}
      {!exactMatch && (
        <p className="text-xs text-gray-500 mt-1">Type to search past companies. New names can still be entered.</p>
      )}
    </div>
  );
}
