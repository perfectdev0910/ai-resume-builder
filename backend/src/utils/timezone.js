function resolveTimeZone(value) {
  const tz = String(value || 'UTC').trim() || 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function sqlUtc(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function getOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(utcMs));

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour,
    +map.minute,
    +map.second
  );
  return asUtc - utcMs;
}

function zonedLocalToUtc(timeZone, year, month, day, hour = 0, minute = 0, second = 0) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = getOffsetMs(utcGuess, timeZone);
  let instant = utcGuess - offset;
  const offset2 = getOffsetMs(instant, timeZone);
  if (offset2 !== offset) instant = utcGuess - offset2;
  return new Date(instant);
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    weekday: map.weekday
  };
}

function addCalendarDays(year, month, day, delta) {
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate()
  };
}

function localDateKey(dateInput, timeZone) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  const parts = zonedParts(date, resolveTimeZone(timeZone));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function getPeriodRange(timeZone, period, now = new Date()) {
  const tz = resolveTimeZone(timeZone);
  const parts = zonedParts(now, tz);

  if (period === 'daily') {
    const next = addCalendarDays(parts.year, parts.month, parts.day, 1);
    return {
      start: zonedLocalToUtc(tz, parts.year, parts.month, parts.day),
      end: zonedLocalToUtc(tz, next.year, next.month, next.day)
    };
  }

  if (period === 'weekly') {
    const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const daysFromMonday = weekdayIndex === -1 ? 0 : (weekdayIndex + 6) % 7;
    const monday = addCalendarDays(parts.year, parts.month, parts.day, -daysFromMonday);
    const nextMonday = addCalendarDays(monday.year, monday.month, monday.day, 7);
    return {
      start: zonedLocalToUtc(tz, monday.year, monday.month, monday.day),
      end: zonedLocalToUtc(tz, nextMonday.year, nextMonday.month, nextMonday.day)
    };
  }

  if (period === 'monthly') {
    const nextMonth = parts.month === 12
      ? { year: parts.year + 1, month: 1 }
      : { year: parts.year, month: parts.month + 1 };
    return {
      start: zonedLocalToUtc(tz, parts.year, parts.month, 1),
      end: zonedLocalToUtc(tz, nextMonth.year, nextMonth.month, 1)
    };
  }

  return null;
}

module.exports = {
  resolveTimeZone,
  sqlUtc,
  localDateKey,
  getPeriodRange
};
