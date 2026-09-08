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
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const searchSeq = useRef(0);
  const dupSeq = useRef(0);

  // Load / search companies from the server as the user types (not only top recent)
  useEffect(() => {
    const q = value.trim();
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      applicationsAPI.getCompanies(q)
        .then((response) => {
          if (seq !== searchSeq.current) return;
          setCompanies(response.data?.companies || []);
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setCompanies([]);
        });
    }, q ? 200 : 0);

    return () => clearTimeout(timer);
  }, [value]);

  // Exact duplicate check against all applications (same rule as Generate)
  useEffect(() => {
    const name = prettyCompanyName(value);
    if (!name) {
      setDuplicateInfo(null);
      return undefined;
    }

    const seq = ++dupSeq.current;
    const timer = setTimeout(() => {
      applicationsAPI.checkDuplicate(name)
        .then((response) => {
          if (seq !== dupSeq.current) return;
          const isDuplicate = Boolean(response.data?.isDuplicate);
          const fromList = companies.find(
            (c) => c.companyName.toLowerCase() === name.toLowerCase()
          );
          setDuplicateInfo({
            companyName: fromList?.companyName || name,
            isDuplicate,
            lastAppliedAt: fromList?.lastAppliedAt || null,
            applicationCount: fromList?.applicationCount || (isDuplicate ? 1 : 0)
          });
        })
        .catch(() => {
          if (seq !== dupSeq.current) return;
          setDuplicateInfo(null);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [value, companies]);

  useEffect(() => {
    const onDocMouseDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const query = value.trim().toLowerCase();

  const matches = useMemo(() => {
    const list = !query
      ? companies
      : companies
          .filter((company) => company.companyName.toLowerCase().includes(query))
          .sort((a, b) => {
            const aStarts = a.companyName.toLowerCase().startsWith(query) ? 0 : 1;
            const bStarts = b.companyName.toLowerCase().startsWith(query) ? 0 : 1;
            if (aStarts !== bStarts) return aStarts - bStarts;
            return new Date(b.lastAppliedAt || 0) - new Date(a.lastAppliedAt || 0);
          });
    return list.slice(0, 50);
  }, [companies, query]);

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
        <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-white border border-gray-200 rounded-lg dark:bg-gray-900 dark:border-gray-700">
          {matches.map((company, index) => (
            <li key={company.companyName.toLowerCase()}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectCompany(company)}
                className={`w-full text-left px-3 py-2 ${
                  index === highlight
                    ? 'bg-primary-50 dark:bg-primary-900/30'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{company.companyName}</span>
                  {company.isDuplicate && (
                    <span className="shrink-0 text-xs font-medium text-yellow-800 bg-yellow-100 px-2 py-0.5 rounded dark:text-yellow-200 dark:bg-yellow-900/40">
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

      {duplicateInfo?.isDuplicate && (
        <p className="text-sm text-yellow-800 mt-2 dark:text-yellow-200">
          You already applied to <strong>{duplicateInfo.companyName}</strong> in the last 30 days
          {formatAppliedAt(duplicateInfo.lastAppliedAt) ? ` (${formatAppliedAt(duplicateInfo.lastAppliedAt)})` : ''}.
        </p>
      )}
      {duplicateInfo && !duplicateInfo.isDuplicate && duplicateInfo.applicationCount > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          Previous application{duplicateInfo.applicationCount > 1 ? 's' : ''} to this company
          {formatAppliedAt(duplicateInfo.lastAppliedAt) ? ` · last ${formatAppliedAt(duplicateInfo.lastAppliedAt)}` : ''}.
        </p>
      )}
      {!duplicateInfo?.isDuplicate && !(duplicateInfo?.applicationCount > 0) && (
        <p className="text-xs text-gray-500 mt-1">Type to search past companies. New names can still be entered.</p>
      )}
    </div>
  );
}
