import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE_URL, calendarAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatInTimeZone, resolveTimeZone } from '../utils/timezone';

const TABS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'analysis', label: 'Analysis' }
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The OAuth popup's final page is served by the backend, so its messages come from the API origin.
const API_ORIGIN = new URL(API_BASE_URL, window.location.origin).origin;

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

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Calendar-day key (yyyy-mm-dd) for an event start, in the profile timezone.
function dayKeyInZone(iso, timeZone, allDay) {
  if (!iso) return '';
  // All-day events come as plain dates (yyyy-mm-dd) — no zone conversion.
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(0, 10);
  try {
    return formatInTimeZone(iso, timeZone, 'yyyy-MM-dd');
  } catch {
    return iso.slice(0, 10);
  }
}

// First day of the month the calendar was connected — the earliest month we show.
function connectedMonthStart(status) {
  const raw = status?.connectedAt;
  // SQLite returns "yyyy-mm-dd HH:MM:SS" in UTC without a zone marker.
  const d = raw ? new Date(/^d{4}-d{2}-d{2} d{2}:d{2}:d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw) : new Date();
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  return new Date(base.getFullYear(), base.getMonth(), 1);
}

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({
      date: d,
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      inMonth: d.getMonth() === month
    });
  }
  // Drop a trailing all-out-of-month week so short months don't show 6 rows.
  if (cells.slice(35).every((c) => !c.inMonth)) cells.length = 35;
  return cells;
}

function CalendarTab() {
  const { user } = useAuth();
  const timeZone = resolveTimeZone(user?.timezone);
  const [searchParams, setSearchParams] = useSearchParams();

  const [status, setStatus] = useState(null); // { configured, connected, email }
  const [statusError, setStatusError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const popupRef = useRef(null);

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);

  const loadStatus = async () => {
    try {
      const res = await calendarAPI.getGoogleStatus();
      setStatus(res.data);
      setStatusError('');
      // The calendar starts at (and never goes before) the month the account was connected.
      if (res.data?.connected) {
        setSelectedDay(null);
        setCursor(connectedMonthStart(res.data));
      }
    } catch (err) {
      setStatusError(err.response?.data?.error || 'Failed to check Google Calendar status');
    }
  };

  // Google sends the browser back to /interviews?google=connected|error after consent.
  useEffect(() => {
    const result = searchParams.get('google');
    if (result) {
      if (result === 'connected') {
        setNotice('Google Calendar connected.');
      } else {
        const reason = searchParams.get('reason') || 'unknown';
        setNotice(`Google Calendar connection failed (${reason.replace(/_/g, ' ')}).`);
      }
      const next = new URLSearchParams(searchParams);
      next.delete('google');
      next.delete('reason');
      setSearchParams(next, { replace: true });
    }
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadEvents = async () => {
    setLoadingEvents(true);
    setEventsError('');
    try {
      // Fetch the whole visible grid (leading/trailing days included).
      const grid = buildMonthGrid(cursor.getFullYear(), cursor.getMonth());
      const from = grid[0].date;
      const last = grid[grid.length - 1].date;
      const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      const res = await calendarAPI.getGoogleEvents(from.toISOString(), to.toISOString());
      setEvents(res.data?.events || []);
      setCalendars(res.data?.calendars || []);
    } catch (err) {
      if (err.response?.data?.reconnect) {
        setStatus((prev) => (prev ? { ...prev, connected: false } : prev));
      }
      setEventsError(err.response?.data?.error || 'Failed to load events');
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (status?.connected) loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, monthKey(cursor)]);

  // Import: open Google's consent screen in a popup; the callback page posts the result back
  // (see backend /calendar/google/callback) and closes itself, so the app never navigates away.
  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    setNotice('');

    // Open synchronously inside the click so popup blockers allow it; fill the URL in after.
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
        // Popup was blocked: fall back to a full-page redirect.
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
      if (data.google === 'connected') {
        setNotice('Google Calendar connected.');
      } else {
        setNotice(`Google Calendar connection failed (${String(data.reason || 'unknown').replace(/_/g, ' ')}).`);
      }
      loadStatus();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the user just closes the popup, stop showing the "waiting" state.
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

  const disconnect = async () => {
    if (!confirm('Disconnect Google Calendar? Your events will no longer be shown here.')) return;
    try {
      await calendarAPI.disconnectGoogle();
      setEvents([]);
      setCalendars([]);
      setSelectedDay(null);
      setNotice('Google Calendar disconnected.');
      await loadStatus();
    } catch (err) {
      setNotice(err.response?.data?.error || 'Failed to disconnect');
    }
  };

  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      const key = dayKeyInZone(ev.start, timeZone, ev.allDay);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return map;
  }, [events, timeZone]);

  const grid = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const todayKey = formatInTimeZone(new Date().toISOString(), timeZone, 'yyyy-MM-dd');
  const monthLabel = cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const selectedEvents = selectedDay ? eventsByDay.get(selectedDay) || [] : [];

  const minMonth = useMemo(() => connectedMonthStart(status), [status?.connectedAt]);
  const atMinMonth = cursor.getFullYear() === minMonth.getFullYear() && cursor.getMonth() === minMonth.getMonth();

  const shiftMonth = (delta) => {
    setSelectedDay(null);
    setCursor((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
      return next < minMonth ? minMonth : next;
    });
  };

  const goToday = () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    setCursor(thisMonth < minMonth ? minMonth : thisMonth);
    setSelectedDay(thisMonth < minMonth ? null : todayKey);
  };

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
        <div className="rounded-lg bg-red-50 text-red-700 text-sm px-4 py-2 dark:bg-red-900/30 dark:text-red-200">
          {statusError}
        </div>
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
              Click Import to connect your Google Calendar and see interviews and meetings here. We only request read-only access.
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary px-3 py-1.5 disabled:opacity-40"
                onClick={() => shiftMonth(-1)}
                disabled={atMinMonth}
                title={atMinMonth ? 'Calendar starts from the month you connected' : 'Previous month'}
                aria-label="Previous month"
              >
                ‹
              </button>
              <button type="button" className="btn btn-secondary px-3 py-1.5" onClick={goToday}>Today</button>
              <button type="button" className="btn btn-secondary px-3 py-1.5" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 ml-2">{monthLabel}</h2>
              {loadingEvents && <span className="text-xs text-gray-400">Loading…</span>}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <GoogleIcon />
                {status.email || 'Google Calendar'}
              </span>
              <button type="button" className="btn btn-secondary py-1.5 px-3 text-xs" onClick={loadEvents} disabled={loadingEvents}>
                Refresh
              </button>
              <button type="button" className="btn btn-secondary py-1.5 px-3 text-xs" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          </div>

          {eventsError && (
            <div className="rounded-lg bg-red-50 text-red-700 text-sm px-4 py-2 flex flex-wrap items-center justify-between gap-2 dark:bg-red-900/30 dark:text-red-200">
              <span>{eventsError}</span>
              {!status.connected && (
                <button type="button" className="btn btn-primary py-1 px-3 text-xs" onClick={connect}>Reconnect</button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)] gap-4 items-start">
            <div className="card overflow-hidden">
              <div className="grid grid-cols-7 bg-gray-50 text-center text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/60">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="py-2 font-medium">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 border-t border-gray-100 dark:border-gray-800">
                {grid.map((cell) => {
                  const dayEvents = eventsByDay.get(cell.key) || [];
                  const isToday = cell.key === todayKey;
                  const isSelected = cell.key === selectedDay;
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      onClick={() => setSelectedDay(cell.key)}
                      className={`min-h-[96px] p-1.5 text-left border-b border-r border-gray-100 align-top transition-colors dark:border-gray-800 ${
                        cell.inMonth ? '' : 'bg-gray-50/60 text-gray-400 dark:bg-gray-900/40'
                      } ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}
                    >
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                        isToday ? 'bg-primary-600 text-white' : cell.inMonth ? 'text-gray-800 dark:text-gray-200' : ''
                      }`}>
                        {cell.date.getDate()}
                      </span>
                      <div className="mt-1 space-y-0.5">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <div
                            key={ev.id}
                            className="truncate rounded px-1 py-0.5 text-[11px] leading-tight text-gray-800 dark:text-gray-100"
                            style={{ backgroundColor: ev.color ? `${ev.color}33` : undefined, borderLeft: `3px solid ${ev.color || '#6366f1'}` }}
                            title={ev.title}
                          >
                            {!ev.allDay && (
                              <span className="text-gray-500 dark:text-gray-300 mr-1">{formatInTimeZone(ev.start, timeZone, 'HH:mm')}</span>
                            )}
                            {ev.title}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-[11px] text-gray-500 px-1">+{dayEvents.length - 3} more</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="card p-5 space-y-4 sticky top-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  {selectedDay ? 'Events on' : 'Upcoming this month'}
                </p>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">
                  {selectedDay
                    ? new Date(`${selectedDay}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                    : monthLabel}
                </h3>
              </div>

              <EventList
                events={selectedDay ? selectedEvents : events.filter((ev) => dayKeyInZone(ev.start, timeZone, ev.allDay) >= todayKey).slice(0, 12)}
                timeZone={timeZone}
                emptyText={selectedDay ? 'Nothing scheduled this day.' : 'No upcoming events this month.'}
              />

              {calendars.length > 0 && (
                <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Calendars</p>
                  <ul className="space-y-1">
                    {calendars.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color || '#6366f1' }} />
                        <span className="truncate">{c.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function EventList({ events, timeZone, emptyText }) {
  if (!events.length) {
    return <p className="text-sm text-gray-400">{emptyText}</p>;
  }
  return (
    <ul className="space-y-3">
      {events.map((ev) => (
        <li key={`${ev.calendarId}-${ev.id}`} className="flex gap-3">
          <span className="w-1 rounded-full shrink-0" style={{ backgroundColor: ev.color || '#6366f1' }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ev.title}</p>
            <p className="text-xs text-gray-500">
              {ev.allDay
                ? `All day · ${new Date(`${ev.start.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : `${formatInTimeZone(ev.start, timeZone, 'MMM d, HH:mm')}${ev.end ? ` – ${formatInTimeZone(ev.end, timeZone, 'HH:mm')}` : ''}`}
            </p>
            {ev.location && <p className="text-xs text-gray-500 truncate">{ev.location}</p>}
            <div className="flex gap-3 mt-1">
              {ev.hangoutLink && (
                <a href={ev.hangoutLink} target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline">Join call</a>
              )}
              {ev.htmlLink && (
                <a href={ev.htmlLink} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:underline">Open in Google</a>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
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
