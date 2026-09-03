import { format, parseISO } from 'date-fns';
import { toZonedTime, format as formatTz } from 'date-fns-tz';

export const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland'
];

export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function resolveTimeZone(value) {
  const tz = String(value || 'UTC').trim() || 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function timezoneSelectOptions(current) {
  const detected = detectTimeZone();
  const list = [...TIMEZONES];
  if (detected && !list.includes(detected)) {
    list.unshift(detected);
  }
  if (current && !list.includes(current)) {
    list.unshift(current);
  }
  return list;
}

function toUtcDate(dateStr) {
  const raw = String(dateStr);
  if (raw.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(raw)) {
    return parseISO(raw);
  }
  if (raw.includes('T')) {
    return parseISO(`${raw}Z`);
  }
  return parseISO(`${raw.replace(' ', 'T')}Z`);
}

export function formatInTimeZone(dateStr, timeZone, formatStr = 'MMM d, yyyy') {
  if (!dateStr) return '';
  const tz = resolveTimeZone(timeZone);
  try {
    const utcDate = toUtcDate(dateStr);
    const zonedDate = toZonedTime(utcDate, tz);
    return formatTz(zonedDate, formatStr, { timeZone: tz });
  } catch {
    return format(new Date(dateStr), formatStr);
  }
}

export function formatDateKey(dateKey, formatStr = 'MMM d') {
  const [year, month, day] = String(dateKey).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  return format(new Date(year, month - 1, day), formatStr);
}

export function formatLiveClock(date, timeZone) {
  const tz = resolveTimeZone(timeZone);
  const now = date instanceof Date ? date : new Date();

  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(now);

  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(now);

  const abbreviation = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'short'
  }).formatToParts(now).find((part) => part.type === 'timeZoneName')?.value || tz;

  return { time, day, abbreviation, timeZone: tz };
}
