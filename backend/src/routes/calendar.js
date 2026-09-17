const express = require('express');
const jwt = require('jsonwebtoken');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const { authMiddleware } = require('../middleware/auth');
const { getJwtSecret, getFrontendOrigins } = require('../config/env');
const { parseEvent, STAGES } = require('../utils/eventParser');

const router = express.Router();

// Overridable so the flow can be exercised against a local stub in tests.
const ACCOUNTS_BASE = process.env.GOOGLE_ACCOUNTS_BASE_URL || 'https://accounts.google.com';
const OAUTH_BASE = process.env.GOOGLE_OAUTH_BASE_URL || 'https://oauth2.googleapis.com';
const APIS_BASE = process.env.GOOGLE_APIS_BASE_URL || 'https://www.googleapis.com';
const GOOGLE_AUTH_URL = `${ACCOUNTS_BASE}/o/oauth2/v2/auth`;
const GOOGLE_TOKEN_URL = `${OAUTH_BASE}/token`;
const GOOGLE_REVOKE_URL = `${OAUTH_BASE}/revoke`;
const GOOGLE_USERINFO_URL = `${APIS_BASE}/oauth2/v2/userinfo`;
const GOOGLE_CALENDAR_API = `${APIS_BASE}/calendar/v3`;

// Read-only calendar access plus the email so the UI can show which account is connected.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

// The callback lands on the backend, so the redirect URI is the API's own origin.
function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return `${req.protocol}://${req.get('host')}/api/calendar/google/callback`;
}

function getDashboardUrl() {
  return getFrontendOrigins()[0] || 'http://localhost:5173';
}

async function getOneCompat(sqliteSql, postgresSql, params = []) {
  return db.getOne(isPostgres ? postgresSql : sqliteSql, params);
}

async function getAllCompat(sqliteSql, postgresSql, params = []) {
  return db.getAll(isPostgres ? postgresSql : sqliteSql, params);
}

async function runQueryCompat(sqliteSql, postgresSql, params = []) {
  return db.runQuery(isPostgres ? postgresSql : sqliteSql, params);
}

async function loadConnection(userId) {
  return getOneCompat(
    'SELECT * FROM google_calendar_tokens WHERE user_id = ?',
    'SELECT * FROM google_calendar_tokens WHERE user_id = $1',
    [userId]
  );
}

async function saveConnection(userId, { accessToken, refreshToken, scope, expiresAt, email }) {
  const existing = await loadConnection(userId);
  // Google only returns a refresh token on the first consent; keep the stored one otherwise.
  const refresh = refreshToken || existing?.refresh_token || null;
  const expires = expiresAt ? new Date(expiresAt).toISOString() : null;

  if (existing) {
    await runQueryCompat(
      `UPDATE google_calendar_tokens
       SET access_token = ?, refresh_token = ?, scope = ?, expires_at = ?,
           google_email = COALESCE(?, google_email), updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      `UPDATE google_calendar_tokens
       SET access_token = $1, refresh_token = $2, scope = $3, expires_at = $4,
           google_email = COALESCE($5, google_email), updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $6`,
      [accessToken, refresh, scope || null, expires, email || null, userId]
    );
  } else {
    await runQueryCompat(
      `INSERT INTO google_calendar_tokens (user_id, google_email, access_token, refresh_token, scope, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      `INSERT INTO google_calendar_tokens (user_id, google_email, access_token, refresh_token, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email || null, accessToken, refresh, scope || null, expires]
    );
  }
}

async function deleteConnection(userId) {
  await runQueryCompat(
    'DELETE FROM google_calendar_tokens WHERE user_id = ?',
    'DELETE FROM google_calendar_tokens WHERE user_id = $1',
    [userId]
  );
}

async function exchangeToken(body) {
  const { clientId, clientSecret } = getGoogleConfig();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || 'Google token request failed');
    err.google = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Returns a valid access token, refreshing (and persisting) it when it is about to expire.
async function getAccessToken(userId) {
  const conn = await loadConnection(userId);
  if (!conn) return null;

  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  const stillValid = expiresAt && expiresAt - Date.now() > 60 * 1000;
  if (stillValid) return conn.access_token;

  if (!conn.refresh_token) {
    const err = new Error('Google session expired. Please reconnect your calendar.');
    err.status = 401;
    err.reconnect = true;
    throw err;
  }

  try {
    const data = await exchangeToken({ grant_type: 'refresh_token', refresh_token: conn.refresh_token });
    await saveConnection(userId, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      scope: data.scope,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
    });
    return data.access_token;
  } catch (error) {
    // invalid_grant = user revoked access in their Google account; drop the dead connection.
    if (error.google === 'invalid_grant') {
      await deleteConnection(userId);
      const err = new Error('Google access was revoked. Please reconnect your calendar.');
      err.status = 401;
      err.reconnect = true;
      throw err;
    }
    throw error;
  }
}

async function googleGet(accessToken, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `Google API request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function formatEvent(row) {
  if (!row) return null;
  let attendees = [];
  let editedFields = [];
  try { attendees = row.attendees ? JSON.parse(row.attendees) : []; } catch { attendees = []; }
  try { editedFields = row.edited_fields ? JSON.parse(row.edited_fields) : []; } catch { editedFields = []; }
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return {
    id: row.id,
    googleEventId: row.google_event_id,
    calendarId: row.google_calendar_id,
    calendarName: row.calendar_name || '',
    color: row.color || null,
    title: row.title || '(No title)',
    companyName: row.company_name || '',
    jobTitle: row.job_title || '',
    stage: row.stage || null,
    meetingLink: row.meeting_link || '',
    start: iso(row.start_at),
    end: iso(row.end_at),
    allDay: Boolean(row.all_day),
    attendees,
    description: row.description || '',
    location: row.location || '',
    htmlLink: row.html_link || '',
    applicationId: row.application_id || null,
    application: row.application_id
      ? {
          id: row.application_id,
          companyName: row.app_company_name || '',
          jobTitle: row.app_job_title || '',
          jdLink: row.app_jd_link || '',
          appliedAt: row.app_applied_at || null,
          hasDoc: Boolean(row.app_cv_doc_url),
          hasPdf: Boolean(row.app_cv_pdf_url)
        }
      : null,
    jdLink: row.jd_link || '',
    resumeLink: row.resume_link || '',
    notes: row.notes || '',
    editedFields,
    syncedAt: iso(row.synced_at),
    updatedAt: iso(row.updated_at)
  };
}

const EVENT_SELECT = `
  SELECT e.*, a.company_name AS app_company_name, a.job_title AS app_job_title, a.jd_link AS app_jd_link,
         a.applied_at AS app_applied_at, a.cv_doc_url AS app_cv_doc_url, a.cv_pdf_url AS app_cv_pdf_url
  FROM calendar_events e
  LEFT JOIN applications a ON a.id = e.application_id AND a.user_id = e.user_id`;

async function fetchEvent(userId, id) {
  return getOneCompat(
    `${EVENT_SELECT} WHERE e.id = ? AND e.user_id = ?`,
    `${EVENT_SELECT} WHERE e.id = $1 AND e.user_id = $2`,
    [id, userId]
  );
}

// Fields sync is allowed to overwrite unless the user edited them (see edited_fields).
const SYNCED_FIELDS = [
  'calendar_name', 'color', 'title', 'company_name', 'job_title', 'stage', 'meeting_link',
  'start_at', 'end_at', 'all_day', 'attendees', 'description', 'location', 'html_link',
  'application_id', 'jd_link'
];

async function listGoogleEvents(accessToken, calendarId, from, to) {
  const items = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      ...(pageToken ? { pageToken } : {})
    });
    const data = await googleGet(
      accessToken,
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    );
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return items;
}

// Pull every event from the connected month onward into calendar_events, parsing interview
// details. Rows the user edited keep their edits; cancelled events are removed.
async function syncEvents(userId) {
  const accessToken = await getAccessToken(userId);
  if (!accessToken) {
    const err = new Error('Google Calendar is not connected');
    err.status = 401;
    err.reconnect = true;
    throw err;
  }
  const conn = await loadConnection(userId);
  const connectedAt = conn?.created_at ? new Date(conn.created_at) : new Date();
  const from = new Date(Date.UTC(connectedAt.getUTCFullYear(), connectedAt.getUTCMonth(), 1));
  const to = new Date(Date.UTC(from.getUTCFullYear() + 1, from.getUTCMonth() + 1, 1));

  const applications = await getAllCompat(
    'SELECT id, company_name, job_title, jd_link FROM applications WHERE user_id = ? ORDER BY applied_at DESC',
    'SELECT id, company_name, job_title, jd_link FROM applications WHERE user_id = $1 ORDER BY applied_at DESC',
    [userId]
  );

  const list = await googleGet(accessToken, `${GOOGLE_CALENDAR_API}/users/me/calendarList?minAccessRole=reader`);
  const calendars = (list.items || []).filter((c) => c.selected !== false);

  const existingRows = await getAllCompat(
    'SELECT id, google_calendar_id, google_event_id, edited_fields, hidden FROM calendar_events WHERE user_id = ?',
    'SELECT id, google_calendar_id, google_event_id, edited_fields, hidden FROM calendar_events WHERE user_id = $1',
    [userId]
  );
  const existing = new Map(existingRows.map((r) => [`${r.google_calendar_id}\n${r.google_event_id}`, r]));

  let imported = 0;
  let updated = 0;
  let removed = 0;
  const syncedAt = new Date().toISOString();
  const seen = new Set();
  const fetchedCalendars = new Set();

  for (const calendar of calendars) {
    let items;
    try {
      items = await listGoogleEvents(accessToken, calendar.id, from, to);
      fetchedCalendars.add(calendar.id);
    } catch (err) {
      console.warn(`Skipping calendar ${calendar.id}:`, err.message);
      continue;
    }

    for (const raw of items) {
      const key = `${calendar.id}\n${raw.id}`;
      const row = existing.get(key);

      if (raw.status === 'cancelled') {
        // deliberately not added to `seen`, so the sweep below also catches it
        if (row) {
          await runQueryCompat('DELETE FROM calendar_events WHERE id = ?', 'DELETE FROM calendar_events WHERE id = $1', [row.id]);
          removed++;
        }
        continue;
      }

      const parsed = parseEvent(raw, calendar, applications, conn?.google_email || '');
      if (!parsed.start_at) continue;
      seen.add(key);
      const values = { ...parsed, attendees: JSON.stringify(parsed.attendees), all_day: parsed.all_day ? 1 : 0 };

      if (!row) {
        const cols = ['user_id', 'google_calendar_id', 'google_event_id', ...SYNCED_FIELDS, 'synced_at'];
        const vals = [userId, calendar.id, raw.id, ...SYNCED_FIELDS.map((f) => values[f]), syncedAt];
        await runQueryCompat(
          `INSERT INTO calendar_events (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          `INSERT INTO calendar_events (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`,
          vals
        );
        imported++;
      } else {
        let edited = [];
        try { edited = row.edited_fields ? JSON.parse(row.edited_fields) : []; } catch { edited = []; }
        const fields = SYNCED_FIELDS.filter((f) => !edited.includes(f));
        const vals = fields.map((f) => values[f]);
        await runQueryCompat(
          `UPDATE calendar_events SET ${fields.map((f) => f + ' = ?').join(', ')}, synced_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          `UPDATE calendar_events SET ${fields.map((f, i) => f + ' = $' + (i + 1)).join(', ')}, synced_at = $${fields.length + 1}, updated_at = CURRENT_TIMESTAMP WHERE id = $${fields.length + 2}`,
          [...vals, syncedAt, row.id]
        );
        updated++;
      }
    }
  }

  // Events deleted in Google simply stop being returned: drop rows inside the synced
  // window that we didn't see, and rows from calendars that no longer exist. Calendars
  // that failed to fetch are left alone so a transient error can't wipe their events.
  const listedIds = new Set(calendars.map((c) => c.id));
  const windowRows = await getAllCompat(
    'SELECT id, google_calendar_id, google_event_id FROM calendar_events WHERE user_id = ? AND start_at >= ? AND start_at < ?',
    'SELECT id, google_calendar_id, google_event_id FROM calendar_events WHERE user_id = $1 AND start_at >= $2 AND start_at < $3',
    [userId, from.toISOString(), to.toISOString()]
  );
  for (const row of windowRows) {
    const key = `${row.google_calendar_id}\n${row.google_event_id}`;
    const calendarGone = !listedIds.has(row.google_calendar_id);
    const eventGone = fetchedCalendars.has(row.google_calendar_id) && !seen.has(key);
    if (calendarGone || eventGone) {
      await runQueryCompat('DELETE FROM calendar_events WHERE id = ?', 'DELETE FROM calendar_events WHERE id = $1', [row.id]);
      removed++;
    }
  }

  await runQueryCompat(
    'UPDATE google_calendar_tokens SET last_synced_at = ? WHERE user_id = ?',
    'UPDATE google_calendar_tokens SET last_synced_at = $1 WHERE user_id = $2',
    [syncedAt, userId]
  ).catch((err) => console.warn('Could not record last_synced_at:', err.message));

  return { imported, updated, removed, calendars: calendars.length, from: from.toISOString(), to: to.toISOString() };
}

// Background job: re-sync every connected user. Runs users one at a time so a big
// account can't starve the pool; a failure for one user never stops the others.
let syncAllRunning = false;
async function syncAllConnected() {
  if (syncAllRunning) return { skipped: true };
  syncAllRunning = true;
  const summary = { users: 0, ok: 0, failed: 0, imported: 0, updated: 0, removed: 0 };
  try {
    const rows = await getAllCompat(
      'SELECT user_id FROM google_calendar_tokens',
      'SELECT user_id FROM google_calendar_tokens',
      []
    );
    summary.users = rows.length;
    for (const row of rows) {
      try {
        const r = await syncEvents(row.user_id);
        summary.ok++;
        summary.imported += r.imported;
        summary.updated += r.updated;
        summary.removed += r.removed;
      } catch (err) {
        summary.failed++;
        console.warn(`Calendar auto-sync failed for user ${row.user_id}:`, err.message);
      }
    }
  } finally {
    syncAllRunning = false;
  }
  return summary;
}

// Schedule the auto-sync (default every 5 minutes; CALENDAR_SYNC_INTERVAL_MINUTES=0 disables).
function startAutoSync() {
  const minutes = Number(process.env.CALENDAR_SYNC_INTERVAL_MINUTES ?? 5);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log('📅 Calendar auto-sync disabled');
    return null;
  }
  const cron = require('node-cron');
  const expr = minutes >= 60 ? `0 */${Math.round(minutes / 60)} * * *` : `*/${Math.round(minutes)} * * * *`;
  const task = cron.schedule(expr, async () => {
    try {
      const s = await syncAllConnected();
      if (!s.skipped && s.users) {
        console.log(`📅 Calendar auto-sync: ${s.ok}/${s.users} users ok, +${s.imported} new, ${s.updated} updated, ${s.removed} removed`);
      }
    } catch (err) {
      console.error('Calendar auto-sync error:', err.message);
    }
  });
  console.log(`📅 Calendar auto-sync every ${minutes} min`);
  return task;
}


function respondError(res, error, fallback) {
  const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
  res.status(status).json({
    error: error.reconnect ? error.message : fallback,
    details: error.message,
    reconnect: Boolean(error.reconnect)
  });
}

// Is this user connected? Also tells the UI whether the server is configured at all.
router.get('/google/status', authMiddleware, async (req, res) => {
  try {
    const { configured } = getGoogleConfig();
    const conn = await loadConnection(req.user.id);
    res.json({
      configured,
      connected: Boolean(conn),
      email: conn?.google_email || null,
      connectedAt: conn?.created_at || null,
      lastSyncedAt: conn?.last_synced_at || null
    });
  } catch (error) {
    console.error('Calendar status error:', error);
    res.status(500).json({ error: 'Failed to read calendar status', details: error.message });
  }
});

// Step 1: the dashboard asks for the consent URL and redirects the browser to it.
router.get('/google/auth-url', authMiddleware, (req, res) => {
  const { clientId, configured } = getGoogleConfig();
  if (!configured) {
    return res.status(503).json({ error: 'Google Calendar is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).' });
  }

  // The callback arrives without our Authorization header, so carry the user in a signed state.
  const state = jwt.sign({ uid: req.user.id, purpose: 'google_calendar' }, getJwtSecret(), { expiresIn: '10m' });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(req),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  });

  res.json({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
});

// Step 2: Google redirects here; exchange the code, store tokens, send the user back to the dashboard.
router.get('/google/callback', async (req, res) => {
  // The consent screen opens in a popup from the dashboard. Hand the result back to the
  // opener via postMessage and close; if there is no opener (direct navigation), redirect.
  const back = (query) => {
    const result = { source: 'google-calendar', ...query };
    const targets = getFrontendOrigins();
    const fallback = `${getDashboardUrl()}/interviews?${new URLSearchParams(query).toString()}`;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Google Calendar</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#374151;background:#f9fafb}</style></head>
<body><p>${query.google === 'connected' ? 'Google Calendar connected. You can close this window.' : 'Google Calendar connection failed. You can close this window.'}</p>
<script>
  (function () {
    var result = ${JSON.stringify(result)};
    var targets = ${JSON.stringify(targets)};
    var fallback = ${JSON.stringify(fallback)};
    if (window.opener && !window.opener.closed) {
      // Post to every configured dashboard origin; only the matching one receives it.
      for (var i = 0; i < targets.length; i++) { try { window.opener.postMessage(result, targets[i]); } catch (e) {} }
      if (!targets.length) { try { window.opener.postMessage(result, '*'); } catch (e) {} }
      window.close();
    } else {
      window.location.replace(fallback);
    }
  })();
</script></body></html>`);
  };

  try {
    if (req.query.error) {
      return back({ google: 'error', reason: String(req.query.error) });
    }

    let payload;
    try {
      payload = jwt.verify(String(req.query.state || ''), getJwtSecret());
    } catch {
      return back({ google: 'error', reason: 'invalid_state' });
    }
    if (payload.purpose !== 'google_calendar' || !payload.uid) {
      return back({ google: 'error', reason: 'invalid_state' });
    }

    const code = String(req.query.code || '');
    if (!code) return back({ google: 'error', reason: 'missing_code' });

    const token = await exchangeToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(req)
    });

    let email = null;
    try {
      const info = await googleGet(token.access_token, GOOGLE_USERINFO_URL);
      email = info.email || null;
    } catch (err) {
      console.warn('Could not read Google account email:', err.message);
    }

    await saveConnection(payload.uid, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scope: token.scope,
      expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000,
      email
    });

    try {
      await syncEvents(payload.uid);
    } catch (err) {
      console.error('Initial calendar sync failed (connection kept):', err.message);
    }

    back({ google: 'connected' });
  } catch (error) {
    console.error('Google Calendar callback error:', error);
    back({ google: 'error', reason: error.google || 'exchange_failed' });
  }
});

// Re-scrape Google and refresh calendar_events.
router.post('/google/sync', authMiddleware, async (req, res) => {
  try {
    const result = await syncEvents(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Google Calendar sync error:', error);
    respondError(res, error, 'Failed to sync Google Calendar');
  }
});

// Synced events in a date window (from the local database, not Google).
router.get('/events', authMiddleware, async (req, res) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    const params = [req.user.id];
    let sqliteWhere = 'e.user_id = ? AND e.hidden = 0';
    let pgWhere = 'e.user_id = $1 AND e.hidden = FALSE';
    if (from) {
      params.push(from.toISOString());
      sqliteWhere += ' AND e.end_at > ?';
      pgWhere += ' AND e.end_at > $' + params.length;
    }
    if (to) {
      params.push(to.toISOString());
      sqliteWhere += ' AND e.start_at < ?';
      pgWhere += ' AND e.start_at < $' + params.length;
    }

    const rows = await getAllCompat(
      `${EVENT_SELECT} WHERE ${sqliteWhere} ORDER BY e.start_at ASC`,
      `${EVENT_SELECT} WHERE ${pgWhere} ORDER BY e.start_at ASC`,
      params
    );
    res.json({ events: rows.map(formatEvent) });
  } catch (error) {
    console.error('Calendar events error:', error);
    res.status(500).json({ error: 'Failed to load events', details: error.message });
  }
});

router.get('/events/:id', authMiddleware, async (req, res) => {
  try {
    const row = await fetchEvent(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: formatEvent(row) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load event', details: error.message });
  }
});

// Map of request body keys -> columns the user may edit.
const EDITABLE = {
  title: 'title',
  companyName: 'company_name',
  jobTitle: 'job_title',
  stage: 'stage',
  meetingLink: 'meeting_link',
  start: 'start_at',
  end: 'end_at',
  allDay: 'all_day',
  attendees: 'attendees',
  description: 'description',
  location: 'location',
  applicationId: 'application_id',
  jdLink: 'jd_link',
  resumeLink: 'resume_link',
  notes: 'notes'
};

router.put('/events/:id', authMiddleware, async (req, res) => {
  try {
    const row = await fetchEvent(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Event not found' });

    const sets = [];
    const vals = [];
    let edited = [];
    try { edited = row.edited_fields ? JSON.parse(row.edited_fields) : []; } catch { edited = []; }

    for (const [key, column] of Object.entries(EDITABLE)) {
      if (req.body[key] === undefined) continue;
      let value = req.body[key];

      if (column === 'stage') {
        if (value && !STAGES.includes(value)) return res.status(400).json({ error: 'Invalid stage' });
        value = value || null;
      } else if (column === 'start_at' || column === 'end_at') {
        if (value) {
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid ' + key + ' date' });
          value = d.toISOString();
        } else {
          value = null;
        }
      } else if (column === 'all_day') {
        value = value ? 1 : 0;
      } else if (column === 'attendees') {
        if (!Array.isArray(value)) return res.status(400).json({ error: 'attendees must be an array' });
        value = JSON.stringify(value.map((a) => ({
          email: String(a.email || '').trim(),
          name: String(a.name || '').trim(),
          status: a.status || '',
          organizer: Boolean(a.organizer),
          self: Boolean(a.self)
        })).filter((a) => a.email || a.name));
      } else if (column === 'application_id') {
        if (value) {
          const app = await getOneCompat(
            'SELECT id FROM applications WHERE id = ? AND user_id = ?',
            'SELECT id FROM applications WHERE id = $1 AND user_id = $2',
            [value, req.user.id]
          );
          if (!app) return res.status(403).json({ error: 'Application not found or access denied' });
          value = app.id;
        } else {
          value = null;
        }
      } else {
        value = value == null ? '' : String(value);
      }

      sets.push(column);
      vals.push(value);
      if (!edited.includes(column)) edited.push(column);
    }

    if (!sets.length) return res.json({ event: formatEvent(row) });

    const startVal = sets.includes('start_at') ? vals[sets.indexOf('start_at')] : row.start_at;
    const endVal = sets.includes('end_at') ? vals[sets.indexOf('end_at')] : row.end_at;
    if (startVal && endVal && new Date(endVal) < new Date(startVal)) {
      return res.status(400).json({ error: 'End must be after start' });
    }

    sets.push('edited_fields');
    vals.push(JSON.stringify(edited));

    await runQueryCompat(
      `UPDATE calendar_events SET ${sets.map((c) => c + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
      `UPDATE calendar_events SET ${sets.map((c, i) => c + ' = $' + (i + 1)).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${sets.length + 1} AND user_id = $${sets.length + 2}`,
      [...vals, req.params.id, req.user.id]
    );

    const updatedRow = await fetchEvent(req.user.id, req.params.id);
    res.json({ event: formatEvent(updatedRow) });
  } catch (error) {
    console.error('Calendar event update error:', error);
    res.status(500).json({ error: 'Failed to update event', details: error.message });
  }
});

// Hide an event from the board (it stays hidden across re-syncs).
router.delete('/events/:id', authMiddleware, async (req, res) => {
  try {
    const row = await fetchEvent(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Event not found' });
    await runQueryCompat(
      'UPDATE calendar_events SET hidden = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      'UPDATE calendar_events SET hidden = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Event removed from the board' });
  } catch (error) {
    console.error('Calendar event delete error:', error);
    res.status(500).json({ error: 'Failed to remove event', details: error.message });
  }
});


// Disconnect: revoke at Google (best effort) and forget the tokens.
router.delete('/google', authMiddleware, async (req, res) => {
  try {
    const conn = await loadConnection(req.user.id);
    if (conn) {
      const token = conn.refresh_token || conn.access_token;
      try {
        await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' });
      } catch (err) {
        console.warn('Google revoke failed (tokens still deleted locally):', err.message);
      }
      await deleteConnection(req.user.id);
    }
    // The events were derived from that calendar; clear them so a reconnect starts clean.
    await runQueryCompat('DELETE FROM calendar_events WHERE user_id = ?', 'DELETE FROM calendar_events WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'Google Calendar disconnected' });
  } catch (error) {
    console.error('Google Calendar disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Google Calendar', details: error.message });
  }
});

module.exports = router;
module.exports.syncEvents = syncEvents;
module.exports.syncAllConnected = syncAllConnected;
module.exports.startAutoSync = startAutoSync;
