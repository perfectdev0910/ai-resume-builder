import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE_URL, applicationsAPI, calendarAPI, cvAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatInTimeZone, resolveTimeZone, zonedInputsToIso } from '../utils/timezone';

const TABS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'analysis', label: 'Analysis' }
];

const VIEWS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' }
];

const STAGE_META = {
  hr_screen: { label: 'HR Screen', className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' },
  assessment: { label: 'Assessment', className: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' },
  technical: { label: 'Technical', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  background_check: { label: 'Background Check', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200' },
  onsite_final: { label: 'Onsite / Final', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200' },
  offer: { label: 'Offer', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' }
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_PX = 48;
const DEFAULT_COLOR = '#6366f1';

// The OAuth popup's final page is served by the backend, so its messages come from the API origin.
const API_ORIGIN = new URL(API_BASE_URL, window.location.origin).origin;

/* ------------------------------------------------------------------ */
/* Date helpers (all "calendar day" math happens in the profile zone)  */
/* ------------------------------------------------------------------ */

function pad(n) {
  return String(n).padStart(2, '0');
}

function keyOf(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function startOfWeek(date) {
  return addDays(date, -date.getDay());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// yyyy-mm-dd of an instant in the profile timezone (all-day events keep their plain date).
function dayKeyInZone(iso, timeZone, allDay) {
  if (!iso) return '';
  if (allDay) return iso.slice(0, 10);
  try {
    return formatInTimeZone(iso, timeZone, 'yyyy-MM-dd');
  } catch {
    return iso.slice(0, 10);
  }
}

function minutesInZone(iso, timeZone) {
  try {
    const [h, m] = formatInTimeZone(iso, timeZone, 'HH:mm').split(':').map(Number);
    return h * 60 + m;
  } catch {
    return 0;
  }
}

function toLocalInputs(iso, timeZone, allDay) {
  if (!iso) return { date: '', time: '' };
  if (allDay) return { date: iso.slice(0, 10), time: '' };
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
  return zonedInputsToIso(date, time || '09:00', timeZone);
}

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = addDays(first, -first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    cells.push({ date: d, key: keyOf(d), inMonth: d.getMonth() === month });
  }
  if (cells.slice(35).every((c) => !c.inMonth)) cells.length = 35;
  return cells;
}

// First day of the month the calendar was connected — the earliest month we show.
function connectedMonthStart(status) {
  const raw = status?.connectedAt;
  const d = raw ? new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw) : new Date();
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  return new Date(base.getFullYear(), base.getMonth(), 1);
}

// SQLite returns "yyyy-mm-dd HH:MM:SS" in UTC without a zone marker; Postgres returns ISO.
function parseServerDate(value) {
  const raw = String(value || '');
  return new Date(/^d{4}-d{2}-d{2} d{2}:d{2}:d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
}

function relativeTime(value) {
  if (!value) return '';
  const d = parseServerDate(value);
  const diff = Math.max(0, Date.now() - d.getTime());
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function stageLabel(stage) {
  return STAGE_META[stage]?.label || '';
}

function eventLabel(ev) {
  return ev.companyName ? `${ev.companyName}${ev.jobTitle ? ` · ${ev.jobTitle}` : ''}` : ev.title;
}

function timeRange(ev, timeZone) {
  if (ev.allDay) return 'All day';
  const start = formatInTimeZone(ev.start, timeZone, 'HH:mm');
  const end = ev.end ? formatInTimeZone(ev.end, timeZone, 'HH:mm') : '';
  return end ? `${start} – ${end}` : start;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Interviews() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = TABS.some((t) => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'calendar';
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Interviews</h1>
          <p className="text-sm text-gray-500 mt-1">Your interview schedule and insights</p>
        </div>
        <div className="flex gap-1 p-1 rounded-full bg-gray-100 dark:bg-gray-800">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
                const next = new URLSearchParams(searchParams);
                next.set('tab', item.id);
                setSearchParams(next, { replace: true });
              }}
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
      </div>

      {tab === 'calendar' ? <CalendarTab /> : <AnalysisTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar tab                                                        */
/* ------------------------------------------------------------------ */

function CalendarTab() {
  const { user } = useAuth();
  const timeZone = resolveTimeZone(user?.timezone);
  const [searchParams, setSearchParams] = useSearchParams();

  const [status, setStatus] = useState(null); // { configured, connected, email, connectedAt }
  const [statusError, setStatusError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');
  const popupRef = useRef(null);

  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [selectedEventId, setSelectedEventId] = useState(null);

  const minMonth = useMemo(() => connectedMonthStart(status), [status?.connectedAt]);

  const loadStatus = async () => {
    try {
      const res = await calendarAPI.getGoogleStatus();
      setStatus(res.data);
      setStatusError('');
      return res.data;
    } catch (err) {
      setStatusError(err.response?.data?.error || 'Failed to check Google Calendar status');
      return null;
    }
  };

  // Full-page fallback: Google sends the browser back to /interviews?google=... after consent.
  useEffect(() => {
    const result = searchParams.get('google');
    if (result) {
      setNotice(result === 'connected'
        ? 'Google Calendar connected.'
        : `Google Calendar connection failed (${(searchParams.get('reason') || 'unknown').replace(/_/g, ' ')}).`);
      const next = new URLSearchParams(searchParams);
      next.delete('google');
      next.delete('reason');
      setSearchParams(next, { replace: true });
    }
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once connected, start on today (or the connected month if today is earlier — never before it).
  useEffect(() => {
    if (!status?.connected) return;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    setCursor(today < minMonth ? minMonth : today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, status?.connectedAt]);

  // Visible date range for the current view.
  const range = useMemo(() => {
    if (view === 'day') return { from: cursor, to: addDays(cursor, 1), days: [cursor] };
    if (view === 'week') {
      const from = startOfWeek(cursor);
      return { from, to: addDays(from, 7), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)) };
    }
    const grid = buildMonthGrid(cursor.getFullYear(), cursor.getMonth());
    return { from: grid[0].date, to: addDays(grid[grid.length - 1].date, 1), grid, days: grid.map((c) => c.date) };
  }, [view, cursor]);

  const loadEvents = async () => {
    setLoadingEvents(true);
    setEventsError('');
    try {
      // Pad a day either side so zone shifts near the edges still show up.
      const res = await calendarAPI.getEvents(addDays(range.from, -1).toISOString(), addDays(range.to, 1).toISOString());
      setEvents(res.data?.events || []);
    } catch (err) {
      if (err.response?.data?.reconnect) setStatus((prev) => (prev ? { ...prev, connected: false } : prev));
      setEventsError(err.response?.data?.error || 'Failed to load events');
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (status?.connected) loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, view, keyOf(cursor)]);

  // Keep the board live: the server re-syncs every 5 minutes, but when the user is actually
  // looking (page opened / tab focused) we sync right away if the last sync is older than
  // 20 seconds, and poll the database every minute so deletions and changes show up quickly.
  const lastSyncRef = useRef(0);
  useEffect(() => {
    lastSyncRef.current = status?.lastSyncedAt ? parseServerDate(status.lastSyncedAt).getTime() : 0;
  }, [status?.lastSyncedAt]);

  useEffect(() => {
    if (!status?.connected) return undefined;
    let cancelled = false;
    const refresh = async ({ forceSync = false } = {}) => {
      if (document.hidden || cancelled) return;
      const stale = Date.now() - lastSyncRef.current > 20 * 1000;
      if (forceSync && stale) {
        try {
          await calendarAPI.syncGoogle();
          lastSyncRef.current = Date.now();
        } catch {
          // background sync failures are silent; the manual button reports errors
        }
      }
      if (cancelled) return;
      loadStatus();
      loadEvents();
    };
    refresh({ forceSync: true });
    const id = setInterval(() => refresh({ forceSync: false }), 60 * 1000);
    const onVisible = () => { if (!document.hidden) refresh({ forceSync: true }); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, view, keyOf(cursor)]);

  /* ---- Google connection (popup) ---- */

  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    setNotice('');
    const w = 520;
    const h = 640;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open('about:blank', 'google-calendar-import', `popup,width=${w},height=${h},left=${left},top=${top}`);
    popupRef.current = popup;
    try {
      const res = await calendarAPI.getGoogleAuthUrl();
      if (popup && !popup.closed) {
        popup.location.href = res.data.url;
        popup.focus();
      } else {
        window.location.href = res.data.url;
      }
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      popupRef.current = null;
      setNotice(err.response?.data?.error || 'Could not start Google sign-in');
      setConnecting(false);
    }
  };

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== API_ORIGIN) return;
      const data = event.data;
      if (!data || data.source !== 'google-calendar') return;
      popupRef.current = null;
      setConnecting(false);
      setNotice(data.google === 'connected'
        ? 'Google Calendar connected and events imported.'
        : `Google Calendar connection failed (${String(data.reason || 'unknown').replace(/_/g, ' ')}).`);
      loadStatus();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connecting) return undefined;
    const id = setInterval(() => {
      const popup = popupRef.current;
      if (popup && popup.closed) {
        popupRef.current = null;
        setConnecting(false);
        loadStatus();
      }
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting]);

  const sync = async () => {
    setSyncing(true);
    setNotice('');
    try {
      const res = await calendarAPI.syncGoogle();
      const { imported = 0, updated = 0, removed = 0 } = res.data || {};
      setNotice(`Synced with Google: ${imported} new, ${updated} updated${removed ? `, ${removed} removed` : ''}.`);
      await loadEvents();
    } catch (err) {
      if (err.response?.data?.reconnect) setStatus((prev) => (prev ? { ...prev, connected: false } : prev));
      setNotice(err.response?.data?.error || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Google Calendar? Imported events and your edits will be removed.')) return;
    try {
      await calendarAPI.disconnectGoogle();
      setEvents([]);
      setSelectedEventId(null);
      setNotice('Google Calendar disconnected.');
      await loadStatus();
    } catch (err) {
      setNotice(err.response?.data?.error || 'Failed to disconnect');
    }
  };

  /* ---- Navigation ---- */

  const clampToMin = (d) => (d < minMonth ? minMonth : d);
  const atMin = view === 'month'
    ? keyOf(startOfMonth(cursor)) === keyOf(minMonth)
    : view === 'week' ? startOfWeek(cursor) <= minMonth : cursor <= minMonth;

  const shift = (delta) => {
    setCursor((prev) => {
      let next;
      if (view === 'month') next = new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
      else if (view === 'week') next = addDays(prev, 7 * delta);
      else next = addDays(prev, delta);
      return clampToMin(next);
    });
  };

  const todayKey = formatInTimeZone(new Date().toISOString(), timeZone, 'yyyy-MM-dd');

  const goToday = () => {
    const today = fromKey(todayKey);
    setCursor(clampToMin(today));
  };

  const headerLabel = (() => {
    if (view === 'month') return cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    if (view === 'day') return cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const a = range.from;
    const b = addDays(range.to, -1);
    const sameMonth = a.getMonth() === b.getMonth();
    const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const right = sameMonth
      ? `${b.getDate()}, ${b.getFullYear()}`
      : b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${left} – ${right}`;
  })();

  /* ---- Derived ---- */

  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      const key = dayKeyInZone(ev.start, timeZone, ev.allDay);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return map;
  }, [events, timeZone]);

  // Side panel: the clicked event, otherwise the first upcoming one (or the first in view).
  const panelEvent = useMemo(() => {
    const selected = events.find((e) => e.id === selectedEventId);
    if (selected) return selected;
    const nowIso = new Date().toISOString();
    return events.find((e) => (e.end || e.start) >= nowIso) || events[0] || null;
  }, [events, selectedEventId]);

  const handleSaved = (updated) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  const handleRemoved = (id) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setSelectedEventId(null);
  };

  /* ---- Render ---- */

  return (
    <div className="space-y-4">
      {notice && (
        <div className={`rounded-lg text-sm px-4 py-2 ${
          /failed|could not/i.test(notice)
            ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200'
            : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200'
        }`}>
          {notice}
        </div>
      )}
      {statusError && (
        <div className="rounded-lg bg-red-50 text-red-700 text-sm px-4 py-2 dark:bg-red-900/30 dark:text-red-200">{statusError}</div>
      )}

      {!status ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
        </div>
      ) : !status.connected ? (
        <div className="card p-10 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary-50 flex items-center justify-center dark:bg-primary-900/30">
            <svg className="w-7 h-7 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No calendar connected</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
              Click Import to connect your Google Calendar. Your events are imported and interview details
              (company, role, stage, links, attendees) are filled in automatically — you can edit everything.
            </p>
          </div>
          {status.configured ? (
            <button type="button" className="btn btn-primary" disabled={connecting} onClick={connect}>
              <GoogleIcon />
              {connecting ? 'Waiting for Google…' : 'Import'}
            </button>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 inline-block dark:bg-amber-900/30 dark:text-amber-200">
              Google Calendar isn't configured on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="card p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary px-3 py-1.5 disabled:opacity-40"
                onClick={() => shift(-1)}
                disabled={atMin}
                title={atMin ? 'Calendar starts from the month you connected' : 'Previous'}
                aria-label="Previous"
              >
                ‹
              </button>
              <button type="button" className="btn btn-secondary px-3 py-1.5" onClick={goToday}>Today</button>
              <button type="button" className="btn btn-secondary px-3 py-1.5" onClick={() => shift(1)} aria-label="Next">›</button>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 ml-2">{headerLabel}</h2>
              {loadingEvents && <span className="text-xs text-gray-400">Loading…</span>}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex gap-1 p-1 rounded-full bg-gray-100 dark:bg-gray-800">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setView(v.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      view === v.id ? 'bg-primary-600 text-white' : 'text-gray-600 hover:text-gray-900 dark:text-gray-300'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <span className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <GoogleIcon />
                {status.email || 'Google Calendar'}
              </span>
              <button
                type="button"
                className="btn btn-secondary py-1.5 px-3 text-xs"
                onClick={sync}
                disabled={syncing}
                title={status.lastSyncedAt ? `Last synced ${relativeTime(status.lastSyncedAt)} · auto-syncs every 5 min` : 'Auto-syncs every 5 min'}
              >
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
              {status.lastSyncedAt && (
                <span className="text-xs text-gray-400" data-last-synced>Synced {relativeTime(status.lastSyncedAt)}</span>
              )}
              <button type="button" className="btn btn-secondary py-1.5 px-3 text-xs" onClick={disconnect}>Disconnect</button>
            </div>
          </div>

          {eventsError && (
            <div className="rounded-lg bg-red-50 text-red-700 text-sm px-4 py-2 flex flex-wrap items-center justify-between gap-2 dark:bg-red-900/30 dark:text-red-200">
              <span>{eventsError}</span>
              {!status.connected && <button type="button" className="btn btn-primary py-1 px-3 text-xs" onClick={connect}>Reconnect</button>}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.9fr)] gap-4 items-start">
            {view === 'month' ? (
              <MonthView
                grid={range.grid}
                eventsByDay={eventsByDay}
                todayKey={todayKey}
                selectedEventId={panelEvent?.id || null}
                timeZone={timeZone}
                onOpenEvent={setSelectedEventId}
              />
            ) : (
              <TimeGridView
                days={range.days}
                eventsByDay={eventsByDay}
                todayKey={todayKey}
                selectedEventId={panelEvent?.id || null}
                timeZone={timeZone}
                onOpenEvent={setSelectedEventId}
              />
            )}

            <aside className="sticky top-4" data-event-panel>
              {panelEvent ? (
                <EventEditor
                  key={panelEvent.id}
                  event={panelEvent}
                  timeZone={timeZone}
                  isDefault={panelEvent.id !== selectedEventId}
                  onSaved={handleSaved}
                  onRemoved={handleRemoved}
                />
              ) : (
                <div className="card p-8 text-center text-gray-400 text-sm">
                  No events in this range. Click an event on the calendar to see and edit its details here.
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Month grid                                                          */
/* ------------------------------------------------------------------ */

function MonthView({ grid, eventsByDay, todayKey, selectedEventId, timeZone, onOpenEvent }) {
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 bg-gray-50 text-center text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/60">
        {WEEKDAYS.map((d) => <div key={d} className="py-2 font-medium">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 border-t border-gray-100 dark:border-gray-800">
        {grid.map((cell) => {
          const dayEvents = eventsByDay.get(cell.key) || [];
          const isToday = cell.key === todayKey;
          const isSelected = dayEvents.some((ev) => ev.id === selectedEventId);
          return (
            <div
              key={cell.key}
              role="button"
              tabIndex={0}
              onClick={() => { if (dayEvents[0]) onOpenEvent(dayEvents[0].id); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && dayEvents[0]) onOpenEvent(dayEvents[0].id); }}
              className={`min-h-[104px] p-1.5 text-left border-b border-r border-gray-100 transition-colors cursor-pointer dark:border-gray-800 ${
                cell.inMonth ? '' : 'bg-gray-50/60 text-gray-400 dark:bg-gray-900/40'
              } ${isSelected ? 'bg-primary-50/70 dark:bg-primary-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}
            >
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                isToday ? 'bg-primary-600 text-white' : cell.inMonth ? 'text-gray-800 dark:text-gray-200' : ''
              }`}>
                {cell.date.getDate()}
              </span>
              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 3).map((ev) => (
                  <EventChip key={ev.id} ev={ev} timeZone={timeZone} onOpen={onOpenEvent} selected={ev.id === selectedEventId} />
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[11px] text-gray-500 px-1">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventChip({ ev, timeZone, onOpen, selected = false }) {
  const color = ev.color || DEFAULT_COLOR;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(ev.id); }}
      className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight text-gray-800 hover:brightness-95 dark:text-gray-100 ${selected ? 'ring-2 ring-primary-500' : ''}`}
      style={{ backgroundColor: `${color}33`, borderLeft: `3px solid ${color}` }}
      title={`${eventLabel(ev)}${ev.stage ? ` (${stageLabel(ev.stage)})` : ''}`}
      data-event-chip
    >
      {!ev.allDay && <span className="text-gray-500 dark:text-gray-300 mr-1">{formatInTimeZone(ev.start, timeZone, 'HH:mm')}</span>}
      {eventLabel(ev)}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Day / Week time grid                                                */
/* ------------------------------------------------------------------ */

// Assign overlapping events to side-by-side lanes.
function layoutDay(dayEvents, timeZone, dayKey) {
  const timed = dayEvents
    .filter((ev) => !ev.allDay)
    .map((ev) => {
      const start = minutesInZone(ev.start, timeZone);
      let end = ev.end ? minutesInZone(ev.end, timeZone) : start + 30;
      if (ev.end && dayKeyInZone(ev.end, timeZone, false) !== dayKey) end = 24 * 60;
      if (end <= start) end = start + 30;
      return { ev, start, end };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const item of cluster) {
      let lane = lanes.findIndex((laneEnd) => laneEnd <= item.start);
      if (lane < 0) { lanes.push(item.end); lane = lanes.length - 1; } else lanes[lane] = item.end;
      item.lane = lane;
    }
    for (const item of cluster) { item.lanes = lanes.length; placed.push(item); }
    cluster = [];
  };
  for (const item of timed) {
    if (cluster.length && item.start >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length) flush();
  return placed;
}

function TimeGridView({ days, eventsByDay, todayKey, selectedEventId, timeZone, onOpenEvent }) {
  const scrollRef = useRef(null);

  // Current time in the profile zone, refreshed every minute, for the red "now" line.
  const [nowMinutes, setNowMinutes] = useState(() => minutesInZone(new Date().toISOString(), timeZone));
  useEffect(() => {
    const tick = () => setNowMinutes(minutesInZone(new Date().toISOString(), timeZone));
    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [timeZone]);

  const todayVisible = days.some((d) => keyOf(d) === todayKey);
  useEffect(() => {
    if (!scrollRef.current) return;
    // Open around the current time when today is on screen, otherwise at 8am.
    const target = todayVisible ? Math.max(0, (nowMinutes / 60) * HOUR_PX - 3 * HOUR_PX) : 8 * HOUR_PX;
    scrollRef.current.scrollTop = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, days[0] && keyOf(days[0])]);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const cols = days.length;
  const template = `56px repeat(${cols}, minmax(0, 1fr))`;

  return (
    <div className="card overflow-hidden">
      <div className="grid border-b border-gray-100 dark:border-gray-800" style={{ gridTemplateColumns: template }}>
        <div />
        {days.map((d) => {
          const key = keyOf(d);
          const isToday = key === todayKey;
          return (
            <div key={key} className="py-2 text-center border-l border-gray-100 dark:border-gray-800">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">{WEEKDAYS[d.getDay()]}</div>
              <div className={`mx-auto mt-0.5 w-7 h-7 rounded-full inline-flex items-center justify-center text-sm font-semibold ${
                isToday ? 'bg-primary-600 text-white' : 'text-gray-800 dark:text-gray-200'
              }`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid border-b border-gray-100 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-900/30" style={{ gridTemplateColumns: template }}>
        <div className="text-[10px] text-gray-400 px-1 py-1 text-right">all-day</div>
        {days.map((d) => {
          const key = keyOf(d);
          const allDay = (eventsByDay.get(key) || []).filter((ev) => ev.allDay);
          return (
            <div key={key} className="min-h-[28px] p-1 space-y-0.5 border-l border-gray-100 dark:border-gray-800">
              {allDay.map((ev) => <EventChip key={ev.id} ev={ev} timeZone={timeZone} onOpen={onOpenEvent} selected={ev.id === selectedEventId} />)}
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: '68vh' }}>
        <div className="grid relative" style={{ gridTemplateColumns: template, height: 24 * HOUR_PX }}>
          <div className="relative">
            {hours.map((h) => (
              <div key={h} className="absolute right-1 text-[10px] text-gray-400 -translate-y-1/2" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : `${pad(h)}:00`}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const key = keyOf(d);
            const placed = layoutDay(eventsByDay.get(key) || [], timeZone, key);
            const isToday = key === todayKey;
            const nowTop = (nowMinutes / 60) * HOUR_PX;
            return (
              <div key={key} className="relative border-l border-gray-100 dark:border-gray-800">
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-gray-100 dark:border-gray-800/80" style={{ top: h * HOUR_PX }} />
                ))}
                {todayVisible && (
                  // Google-style current-time indicator: solid red line with a dot on today,
                  // a faint line across the other days of the same view.
                  <div
                    className={`absolute inset-x-0 pointer-events-none z-20 ${isToday ? 'border-t-2 border-red-500' : 'border-t border-red-300/60'}`}
                    style={{ top: nowTop }}
                    data-now-line={isToday ? 'today' : 'other'}
                  >
                    {isToday && <span className="absolute -left-[6px] -top-[6px] w-3 h-3 rounded-full bg-red-500" />}
                  </div>
                )}
                {placed.map(({ ev, start, end, lane, lanes }) => {
                  const color = ev.color || DEFAULT_COLOR;
                  const top = (start / 60) * HOUR_PX;
                  const height = Math.max(22, ((end - start) / 60) * HOUR_PX - 2);
                  const width = 100 / lanes;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onOpenEvent(ev.id)}
                      className={`absolute rounded px-1.5 py-0.5 text-left text-[11px] leading-tight overflow-hidden text-gray-900 hover:brightness-95 dark:text-gray-100 ${ev.id === selectedEventId ? 'ring-2 ring-primary-500 z-10' : ''}`}
                      style={{ top, height, left: `calc(${lane * width}% + 2px)`, width: `calc(${width}% - 4px)`, backgroundColor: `${color}33`, borderLeft: `3px solid ${color}` }}
                      title={`${eventLabel(ev)} · ${timeRange(ev, timeZone)}`}
                      data-event-chip
                    >
                      <div className="font-medium truncate">{eventLabel(ev)}</div>
                      <div className="text-gray-600 dark:text-gray-300 truncate">{timeRange(ev, timeZone)}{ev.stage ? ` · ${stageLabel(ev.stage)}` : ''}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Event detail / edit panel (right side)                              */
/* ------------------------------------------------------------------ */

async function downloadWithAuth(url, filename) {
  const token = localStorage.getItem('authToken');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

function EventEditor({ event, timeZone, isDefault, onSaved, onRemoved }) {
  const startLocal = toLocalInputs(event.start, timeZone, event.allDay);
  const endLocal = toLocalInputs(event.end, timeZone, event.allDay);

  const [title, setTitle] = useState(event.title || '');
  const [companyName, setCompanyName] = useState(event.companyName || '');
  const [jobTitle, setJobTitle] = useState(event.jobTitle || '');
  const [stage, setStage] = useState(event.stage || '');
  const [allDay, setAllDay] = useState(Boolean(event.allDay));
  const [startDate, setStartDate] = useState(startLocal.date);
  const [startTime, setStartTime] = useState(startLocal.time);
  const [endDate, setEndDate] = useState(endLocal.date);
  const [endTime, setEndTime] = useState(endLocal.time);
  const [meetingLink, setMeetingLink] = useState(event.meetingLink || '');
  const [location, setLocation] = useState(event.location || '');
  const [attendees, setAttendees] = useState(event.attendees || []);
  const [description, setDescription] = useState(event.description || '');
  const [jdLink, setJdLink] = useState(event.jdLink || '');
  const [resumeLink, setResumeLink] = useState(event.resumeLink || '');
  const [application, setApplication] = useState(event.application || null);
  const [notes, setNotes] = useState(event.notes || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [showImport, setShowImport] = useState(false);

  const updateAttendee = (i, patch) => setAttendees((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const removeAttendee = (i) => setAttendees((prev) => prev.filter((_, idx) => idx !== i));
  const addAttendee = () => setAttendees((prev) => [...prev, { name: '', email: '', status: '' }]);

  const applyApplication = (app) => {
    setApplication({
      id: app.id,
      companyName: app.companyName,
      jobTitle: app.jobTitle,
      jdLink: app.jdLink,
      appliedAt: app.appliedAt,
      hasDoc: Boolean(app.cvDocUrl),
      hasPdf: Boolean(app.cvPdfUrl)
    });
    if (!companyName.trim()) setCompanyName(app.companyName || '');
    if (!jobTitle.trim()) setJobTitle(app.jobTitle || '');
    if (!jdLink.trim() && app.jdLink) setJdLink(app.jdLink);
    setShowImport(false);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      let start;
      let end;
      if (!startDate) throw new Error('Start date is required');
      if (allDay) {
        start = `${startDate}T00:00:00.000Z`;
        const endBase = endDate && endDate > startDate ? endDate : keyOf(addDays(fromKey(startDate), 1));
        end = `${endBase}T00:00:00.000Z`;
      } else {
        start = localInputsToIso(startDate, startTime, timeZone);
        end = localInputsToIso(endDate || startDate, endTime || startTime, timeZone);
        if (new Date(end) < new Date(start)) throw new Error('End must be after start');
      }
      // Send only what changed: every field sent is marked user-edited on the server, and
      // user-edited fields are no longer refreshed from Google on sync.
      const next = {
        title,
        companyName,
        jobTitle,
        stage: stage || null,
        allDay,
        start,
        end,
        meetingLink,
        location,
        attendees,
        description,
        jdLink,
        resumeLink,
        applicationId: application?.id || null,
        notes
      };
      const original = {
        title: event.title || '',
        companyName: event.companyName || '',
        jobTitle: event.jobTitle || '',
        stage: event.stage || null,
        allDay: Boolean(event.allDay),
        start: event.start,
        end: event.end,
        meetingLink: event.meetingLink || '',
        location: event.location || '',
        attendees: event.attendees || [],
        description: event.description || '',
        jdLink: event.jdLink || '',
        resumeLink: event.resumeLink || '',
        applicationId: event.applicationId || null,
        notes: event.notes || ''
      };
      const patch = {};
      for (const key of Object.keys(next)) {
        const same = key === 'attendees'
          ? JSON.stringify(next[key].map((x) => [x.name || '', x.email || ''])) === JSON.stringify(original[key].map((x) => [x.name || '', x.email || '']))
          : (key === 'start' || key === 'end')
            ? new Date(next[key]).getTime() === new Date(original[key]).getTime()
            : next[key] === original[key];
        if (!same) patch[key] = next[key];
      }
      if (Object.keys(patch).length === 0) {
        setSavedAt(Date.now());
        return;
      }
      const res = await calendarAPI.updateEvent(event.id, patch);
      onSaved(res.data.event);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remove this event from the board? It stays in Google Calendar.')) return;
    setSaving(true);
    try {
      await calendarAPI.removeEvent(event.id);
      onRemoved(event.id);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove');
      setSaving(false);
    }
  };

  const download = async (type) => {
    try {
      const url = type === 'pdf' ? cvAPI.downloadPdfUrl(application.id) : cvAPI.downloadDocUrl(application.id);
      await downloadWithAuth(url, `resume-${(application.companyName || 'resume').replace(/\s+/g, '-')}.${type}`);
    } catch (err) {
      setError(err.message || 'Download failed');
    }
  };

  const color = event.color || DEFAULT_COLOR;

  return (
      <form onSubmit={save} className="card p-0 flex flex-col max-h-[calc(100vh-2rem)]" data-event-modal style={{ borderTop: `4px solid ${color}` }}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {isDefault ? 'Next up' : 'Event detail'} · {event.calendarName || 'Google Calendar'}
            </p>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{eventLabel({ ...event, companyName, jobTitle, title })}</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {event.allDay
                ? `All day · ${fromKey(event.start.slice(0, 10)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
                : `${formatInTimeZone(event.start, timeZone, 'EEE, MMM d · HH:mm')}${event.end ? ` – ${formatInTimeZone(event.end, timeZone, 'HH:mm')}` : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {meetingLink && (
              <a href={meetingLink} target="_blank" rel="noreferrer" className="btn btn-primary py-1.5 px-3 text-xs">Join call</a>
            )}
            {event.htmlLink && (
              <a href={event.htmlLink} target="_blank" rel="noreferrer" className="btn btn-secondary py-1.5 px-3 text-xs">Open in Google</a>
            )}
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 dark:bg-red-900/30 dark:text-red-200">{error}</div>
          )}

          <section className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="label">Event title</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Company name</span>
              <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp" />
            </label>
            <label className="block">
              <span className="label">Role</span>
              <input className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Senior Engineer" />
            </label>
            <label className="block">
              <span className="label">Stage</span>
              <select className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">— Not an interview / unknown —</option>
                {Object.entries(STAGE_META).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Meeting link</span>
              <input className="input" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://meet.google.com/…" />
            </label>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Date & time</p>
              <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                All day
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Start date</span>
                <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </label>
              {!allDay && (
                <label className="block">
                  <span className="label">Start time</span>
                  <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
              )}
              <label className="block">
                <span className="label">End date</span>
                <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
              {!allDay && (
                <label className="block">
                  <span className="label">End time</span>
                  <input type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </label>
              )}
            </div>
            <p className="text-xs text-gray-400">Times are in {timeZone}.</p>
            <label className="block">
              <span className="label">Location</span>
              <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Invited people</p>
              <button type="button" className="text-xs text-primary-600 hover:underline" onClick={addAttendee}>+ Add person</button>
            </div>
            {attendees.length === 0 && <p className="text-sm text-gray-400">No attendees.</p>}
            <div className="space-y-2">
              {attendees.map((a, i) => (
                <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input className="input flex-1 min-w-[140px]" placeholder="Name" value={a.name || ''} onChange={(e) => updateAttendee(i, { name: e.target.value })} />
                  <input className="input flex-[1.4] min-w-[180px]" placeholder="email@company.com" value={a.email || ''} onChange={(e) => updateAttendee(i, { email: e.target.value })} />
                  <span className="text-[11px] text-gray-400 w-20 shrink-0">
                    {a.organizer ? 'organizer' : a.self ? 'you' : (a.status || '').replace('needsAction', 'pending')}
                  </span>
                  <button type="button" className="text-gray-400 hover:text-red-600 px-1" onClick={() => removeAttendee(i)} aria-label="Remove attendee">✕</button>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Description</p>
            <textarea className="input min-h-[110px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Meeting description" />
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Resume & job description</p>
              <button type="button" className="btn btn-secondary py-1 px-3 text-xs" onClick={() => setShowImport((v) => !v)}>
                {showImport ? 'Close' : 'Import from application history'}
              </button>
            </div>

            {showImport && <ApplicationPicker initialQuery={companyName} onPick={applyApplication} />}

            <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
              <p className="text-xs text-gray-500 mb-1">Resume</p>
              {application ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{application.companyName}</span>
                    {application.jobTitle && <span className="text-gray-500"> — {application.jobTitle}</span>}
                    {application.appliedAt && (
                      <span className="text-xs text-gray-400 ml-2">
                        applied {formatInTimeZone(application.appliedAt, timeZone, 'MMM d, yyyy')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn btn-secondary py-1 px-2 text-xs" onClick={() => download('pdf')}>PDF</button>
                    <button type="button" className="btn btn-secondary py-1 px-2 text-xs" onClick={() => download('docx')}>DOCX</button>
                    <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => setApplication(null)}>Unlink</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">No resume linked. Import one from your application history, or paste a link below.</p>
              )}
              <input className="input mt-2" value={resumeLink} onChange={(e) => setResumeLink(e.target.value)} placeholder="Resume link (optional, e.g. Google Drive)" />
            </div>

            <label className="block">
              <span className="label">Job description link</span>
              <input className="input" value={jdLink} onChange={(e) => setJdLink(e.target.value)} placeholder="https://…" />
            </label>
          </section>

          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Your notes</p>
            <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Prep notes, questions to ask, feedback…" />
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-t border-gray-100 dark:border-gray-800">
          <button type="button" className="btn btn-danger py-1.5 px-3 text-xs" disabled={saving} onClick={remove}>Remove from board</button>
          <div className="flex items-center gap-2">
            {savedAt && !saving && <span className="text-xs text-green-600" data-saved>Saved</span>}
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      </form>
  );
}

function ApplicationPicker({ initialQuery, onPick }) {
  const [q, setQ] = useState(initialQuery || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const id = setTimeout(async () => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const res = await applicationsAPI.getAll({ search: q.trim() || undefined, limit: 10, page: 1 });
        if (mine !== seq.current) return;
        setRows(res.data?.applications || []);
        setError('');
      } catch (err) {
        if (mine !== seq.current) return;
        setError(err.response?.data?.error || 'Failed to load applications');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="rounded-lg border border-primary-100 bg-primary-50/40 p-3 space-y-2 dark:border-primary-900/40 dark:bg-primary-900/10">
      <input autoFocus className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search applications by company…" />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
        {loading && rows.length === 0 ? (
          <p className="p-3 text-sm text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-sm text-gray-400">No applications match. Generate a CV for this company first.</p>
        ) : (
          rows.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => onPick(app)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{app.companyName}</p>
              <p className="text-xs text-gray-500">
                {app.jobTitle || 'Unknown role'}
                {app.appliedAt ? ` · ${new Date(app.appliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                {app.cvPdfUrl || app.cvDocUrl ? ' · resume ready' : ''}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" />
      <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 015.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 001 12c0 1.77.42 3.45 1.18 4.95l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 002.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Analysis tab                                                        */
/* ------------------------------------------------------------------ */

function AnalysisTab() {
  return (
    <div className="card p-10 text-center space-y-2">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Analysis</h2>
      <p className="text-sm text-gray-500 max-w-md mx-auto">
        Interview insights will appear here once your calendar is connected.
      </p>
    </div>
  );
}
