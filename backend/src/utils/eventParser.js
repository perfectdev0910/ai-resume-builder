/**
 * Heuristics that pull interview details out of a Google Calendar event.
 * Everything here is a best guess — the user can edit every field afterwards.
 */

const { prettyCompanyName } = require('./companyName');

const STAGES = ['not_sure', 'hr_screen', 'technical_screen', 'final', 'offer'];

// Older rows used a finer-grained set; fold them into the current one.
const LEGACY_STAGES = {
  assessment: 'technical_screen',
  technical: 'technical_screen',
  background_check: 'final',
  onsite_final: 'final'
};

function normalizeStage(value) {
  if (!value) return 'not_sure';
  if (STAGES.includes(value)) return value;
  return LEGACY_STAGES[value] || 'not_sure';
}

// Ordered: the first matching rule wins, so later-stage keywords come first.
const STAGE_RULES = [
  ['offer', /\boffer\b/i],
  ['final', /\b(on-?site|final|panel|loop|hiring manager|culture|values|team fit|leadership|bar raiser|executive|(background|reference)s?\s*check|reference call)\b/i],
  ['technical_screen', /\b(technical|tech|coding|system design|architecture|pair(ing)? programming|live coding|whiteboard|algorithm|case study|assessment|take-?home|coding challenge|assignment|homework|hackerrank|codility|codesignal)\b/i],
  ['hr_screen', /\b(hr|recruiter|recruiting|talent|phone screen|screen(ing)?|intro(duction|ductory)?|initial|first call|discovery|kick-?off|chat)\b/i]
];

const MEETING_HOSTS = /(meet\.google\.com|zoom\.us|zoom\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|goto\.com|bluejeans\.com|around\.co|hackerrank\.com|codesignal\.com|coderpad\.io|codeshare\.io)/i;

const JOB_BOARD_HOSTS = /(linkedin\.com\/jobs|greenhouse\.io|lever\.co|workday|myworkdayjobs|indeed\.com|glassdoor\.com|ashbyhq\.com|smartrecruiters\.com|jobvite\.com|bamboohr\.com|workable\.com|icims\.com|taleo\.net|breezy\.hr|recruitee\.com|rippling\.com|wellfound\.com|angel\.co|hired\.com|ziprecruiter\.com|monster\.com|dice\.com|jobs\.|careers\.|\/careers?\/|\/jobs?\/|\/positions?\/|\/openings?\/)/i;

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'gmx.com', 'yandex.com',
  'zoho.com', 'calendar.google.com', 'group.calendar.google.com', 'resource.calendar.google.com'
]);

const INTERVIEW_NOISE = /\b(interview|interviews|call|meeting|chat|conversation|round|session|sync|discussion|screen|screening|intro|introduction|catch-?up|follow-?up|1st|2nd|3rd|first|second|third|final|technical|onsite|on-site|phone|video|zoom|google meet|teams)\b/gi;

// Only separators surrounded by spaces (or a pipe) split a title, so "Take-home" stays intact.
const TITLE_SEPARATOR = /\s+[-–—|:]\s+|\s*\|\s*/;

const ROLE_WORDS = /\b(engineer|developer|programmer|architect|manager|designer|analyst|scientist|lead|consultant|specialist|intern|director|head of|vp|officer|administrator|devops|sre|qa|tester|product|marketing|sales|account executive|recruiter|writer|researcher|coordinator|associate|principal|staff|founder|cto|ceo)\b/i;

function stripHtml(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s<>"'()\]]+/gi) || [];
}

function cleanTitleFragment(text) {
  return String(text || '')
    // Stop at sentence punctuation: "Hooli. Best, Sam" → "Hooli"
    .replace(/[.!?;,].*$/s, '')
    .replace(INTERVIEW_NOISE, ' ')
    .replace(/[\[\]()]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:|,]+|[\s\-–—:|,]+$/g, '')
    .trim();
}

function titleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function domainToCompany(domain) {
  const root = String(domain || '').toLowerCase().split('.').filter(Boolean);
  if (root.length < 2) return '';
  // strip common second-level suffixes like co.uk / com.au
  let name = root[root.length - 2];
  if (['co', 'com', 'org', 'net', 'ac', 'gov'].includes(name) && root.length >= 3) name = root[root.length - 3];
  return titleCase(name.replace(/[-_]/g, ' '));
}

function detectStage(text) {
  for (const [stage, re] of STAGE_RULES) {
    if (re.test(text)) return stage;
  }
  return 'not_sure';
}

function detectMeetingLink(event, description) {
  if (event.hangoutLink) return event.hangoutLink;
  const video = event.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video');
  if (video?.uri) return video.uri;
  const candidates = [...extractUrls(event.location), ...extractUrls(description)];
  const meeting = candidates.find((u) => MEETING_HOSTS.test(u));
  if (meeting) return meeting;
  // A location that is just a URL is almost always the call link.
  if (/^https?:\/\/\S+$/i.test(String(event.location || '').trim())) return String(event.location).trim();
  return '';
}

function detectJdLink(description, meetingLink) {
  const urls = extractUrls(description).filter((u) => u !== meetingLink && !MEETING_HOSTS.test(u));
  const labelled = String(description || '').match(/(?:jd|job description|job posting|posting|role|position)\s*[:\-–]\s*(https?:\/\/[^\s<>"'()\]]+)/i);
  if (labelled) return labelled[1];
  return urls.find((u) => JOB_BOARD_HOSTS.test(u)) || '';
}

function normalizeAttendees(event) {
  return (event.attendees || [])
    .filter((a) => a.email)
    .map((a) => ({
      email: a.email,
      name: a.displayName || '',
      status: a.responseStatus || '',
      organizer: Boolean(a.organizer),
      self: Boolean(a.self)
    }));
}

// Try to find one of the user's applications mentioned in the event.
function matchApplication(applications, haystack, attendeeDomains) {
  const text = haystack.toLowerCase();
  let best = null;
  for (const app of applications) {
    const name = String(app.company_name || '').trim();
    if (name.length < 2) continue;
    const lower = name.toLowerCase();
    const inText = text.includes(lower);
    const inDomain = attendeeDomains.some((d) => {
      const root = domainToCompany(d).toLowerCase();
      return root && (lower.includes(root) || root.includes(lower.split(/\s+/)[0]));
    });
    if (inText || inDomain) {
      // Prefer the longest company name (more specific) and the most recent application.
      if (!best || name.length > best.company_name.length) best = app;
    }
  }
  return best;
}

function detectCompanyFromTitle(title) {
  const t = String(title || '').trim();
  if (!t) return '';

  let m;
  if ((m = t.match(/\binterview\s+(?:with|at|@|for)\s+(.+?)(?:\s*[\-–—|:(]|$)/i))) return cleanTitleFragment(m[1]);
  if ((m = t.match(/^\[([^\]]+)\]/))) return cleanTitleFragment(m[1]);
  if ((m = t.match(/^(.+?)\s+(?:x|×|<>|with)\s+(.+)$/i))) {
    // "Acme x Jane Doe" / "Jane <> Acme": pick the side that doesn't look like a person name.
    const [a, b] = [cleanTitleFragment(m[1]), cleanTitleFragment(m[2])];
    const looksLikePerson = (s) => /^[A-Z][a-z]+(\s[A-Z][a-z]+){1,2}$/.test(s);
    if (a && !looksLikePerson(a)) return a;
    if (b && !looksLikePerson(b)) return b;
  }
  if ((m = t.match(/\b(?:at|@)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/))) return cleanTitleFragment(m[1]);

  const parts = t.split(TITLE_SEPARATOR).map(cleanTitleFragment).filter(Boolean);
  if (parts.length >= 2) {
    // "Acme - Senior Engineer" → company is the part without role words.
    const nonRole = parts.find((p) => !ROLE_WORDS.test(p));
    if (nonRole) return nonRole;
  }
  if (parts.length === 1 && /\binterview\b/i.test(t)) return parts[0];
  return '';
}

function detectCompanyFromDescription(description) {
  const d = String(description || '').slice(0, 800);
  let m;
  if ((m = d.match(/\b(?:company|employer|organi[sz]ation)\s*[:\-–]\s*([^\n|,]{2,60})/i))) return cleanTitleFragment(m[1]);
  if ((m = d.match(/\b(?:interview|position|role|opportunity)\s+(?:at|with|@)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/))) return cleanTitleFragment(m[1]);
  if ((m = d.match(/\b(?:at|with|@)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})(?=[\s.,!)]|$)/))) return cleanTitleFragment(m[1]);
  return '';
}

function detectRole(title, description, company) {
  const sources = [String(title || ''), String(description || '').slice(0, 600)];
  let m;
  for (const s of sources) {
    if ((m = s.match(/\b(?:role|position|title|for the|for a|for an)\s*[:\-–]?\s*([A-Za-z][\w\s/&.+-]{2,60}?)(?:\s+(?:at|@|with|position|role)\b|[\n|\-–—(,.]|$)/i))) {
      const r = cleanTitleFragment(m[1]);
      if (ROLE_WORDS.test(r)) return r;
    }
  }
  const parts = String(title || '').split(TITLE_SEPARATOR).map(cleanTitleFragment).filter(Boolean);
  const rolePart = parts.find((p) => ROLE_WORDS.test(p) && p.toLowerCase() !== String(company || '').toLowerCase());
  if (rolePart) return rolePart;
  if ((m = String(title || '').match(/((?:senior|junior|staff|principal|lead|associate)?\s*[A-Za-z]+(?:\s[A-Za-z]+)?\s(?:engineer|developer|designer|manager|analyst|scientist|architect|consultant|specialist))/i))) {
    return cleanTitleFragment(m[1]);
  }
  return '';
}

/**
 * @param {object} event  raw Google Calendar event
 * @param {object} calendar  the calendar it came from ({ id, summary, backgroundColor })
 * @param {Array} applications  user's applications: { id, company_name, job_title, jd_link }
 * @param {string} ownerEmail  the connected Google account, to skip its own domain
 */
function parseEvent(event, calendar, applications = [], ownerEmail = '') {
  const title = String(event.summary || '').trim();
  const description = stripHtml(event.description);
  const attendees = normalizeAttendees(event);
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);

  const ownerDomain = String(ownerEmail || '').split('@')[1]?.toLowerCase() || '';
  const attendeeDomains = [...new Set(
    attendees
      .map((a) => a.email.split('@')[1]?.toLowerCase())
      .filter((d) => d && !FREE_MAIL.has(d) && d !== ownerDomain)
  )];

  const haystack = `${title}\n${description}\n${event.location || ''}`;
  const app = matchApplication(applications, haystack, attendeeDomains);

  const companyName = app?.company_name
    || detectCompanyFromTitle(title)
    || detectCompanyFromDescription(description)
    || (attendeeDomains.length ? domainToCompany(attendeeDomains[0]) : '');

  const jobTitle = (app?.job_title || '').trim() || detectRole(title, description, companyName);
  const meetingLink = detectMeetingLink(event, description);
  const jdLink = detectJdLink(description, meetingLink) || (app?.jd_link || '');

  const startRaw = event.start?.dateTime || event.start?.date || null;
  const endRaw = event.end?.dateTime || event.end?.date || null;
  const toIso = (v) => {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  return {
    google_calendar_id: calendar.id,
    google_event_id: event.id,
    calendar_name: calendar.summary || '',
    color: calendar.backgroundColor || null,
    title: title || '(No title)',
    company_name: companyName ? prettyCompanyName(companyName) : '',
    job_title: jobTitle,
    stage: detectStage(`${title}\n${description}`),
    meeting_link: meetingLink,
    start_at: toIso(startRaw),
    end_at: toIso(endRaw),
    all_day: allDay,
    attendees,
    description,
    location: String(event.location || ''),
    html_link: event.htmlLink || '',
    application_id: app?.id || null,
    jd_link: jdLink
  };
}

module.exports = { parseEvent, stripHtml, detectStage, normalizeStage, STAGES };
