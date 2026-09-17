const express = require('express');
const jwt = require('jsonwebtoken');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const { authMiddleware } = require('../middleware/auth');
const { getJwtSecret, getFrontendOrigins } = require('../config/env');

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

function formatEvent(event, calendar) {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  return {
    id: event.id,
    calendarId: calendar.id,
    calendarName: calendar.summary || '',
    color: calendar.backgroundColor || null,
    title: event.summary || '(No title)',
    description: event.description || '',
    location: event.location || '',
    allDay,
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    hangoutLink: event.hangoutLink || event.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || '',
    htmlLink: event.htmlLink || '',
    attendees: (event.attendees || []).map((a) => ({ email: a.email, name: a.displayName || '', status: a.responseStatus || '' })),
    status: event.status || 'confirmed'
  };
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
      connectedAt: conn?.created_at || null
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

    back({ google: 'connected' });
  } catch (error) {
    console.error('Google Calendar callback error:', error);
    back({ google: 'error', reason: error.google || 'exchange_failed' });
  }
});

// Events from every calendar the user can see, in a date window.
router.get('/google/events', authMiddleware, async (req, res) => {
  try {
    const accessToken = await getAccessToken(req.user.id);
    if (!accessToken) {
      return res.status(401).json({ error: 'Google Calendar is not connected', reconnect: true });
    }

    const now = new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    const list = await googleGet(accessToken, `${GOOGLE_CALENDAR_API}/users/me/calendarList?minAccessRole=reader`);
    const calendars = (list.items || []).filter((c) => c.selected !== false);

    const perCalendar = await Promise.all(calendars.map(async (calendar) => {
      const params = new URLSearchParams({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250'
      });
      try {
        const data = await googleGet(
          accessToken,
          `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendar.id)}/events?${params}`
        );
        return (data.items || [])
          .filter((e) => e.status !== 'cancelled')
          .map((e) => formatEvent(e, calendar));
      } catch (err) {
        console.warn(`Skipping calendar ${calendar.id}:`, err.message);
        return [];
      }
    }));

    const events = perCalendar.flat().sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json({
      events,
      calendars: calendars.map((c) => ({ id: c.id, name: c.summary, color: c.backgroundColor || null, primary: Boolean(c.primary) })),
      range: { from: from.toISOString(), to: to.toISOString() }
    });
  } catch (error) {
    console.error('Google Calendar events error:', error);
    respondError(res, error, 'Failed to load Google Calendar events');
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
    res.json({ message: 'Google Calendar disconnected' });
  } catch (error) {
    console.error('Google Calendar disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Google Calendar', details: error.message });
  }
});

module.exports = router;
