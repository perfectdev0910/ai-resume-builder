/**
 * Shared CORS setup for both server entry points.
 *
 * A rejected origin must NOT become an Express error: the default error handler
 * would answer 500 without Access-Control-Allow-Origin, which the browser reports
 * as "CORS error" + "500 Internal Server Error" on login. Instead we answer a
 * clear 403 that names the origin so misconfigured FRONTEND_URL is easy to spot.
 */
const cors = require('cors');
const { isOriginAllowed, getFrontendOrigins } = require('./env');

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];

function getAllowedOrigins() {
  return [...new Set([...getFrontendOrigins(), ...LOCAL_ORIGINS])];
}

function applyCors(app) {
  const allowedOrigins = getAllowedOrigins();

  app.use(cors({
    origin: (origin, callback) => {
      // `false` = send no CORS headers; never pass an Error here (see header comment).
      callback(null, isOriginAllowed(origin, allowedOrigins));
    },
    credentials: true,
    optionsSuccessStatus: 204
  }));

  // Reject disallowed browser origins explicitly (preflight and actual requests).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (isOriginAllowed(origin, allowedOrigins)) return next();

    console.warn(`CORS rejected origin ${origin} (allowed: ${allowedOrigins.join(', ') || 'none'})`);
    const hint = String(origin || '').startsWith('chrome-extension://')
      ? `Add the extension ID (${origin.slice('chrome-extension://'.length)}) to CHROME_EXTENSION_IDS on the API server.`
      : 'Add it to FRONTEND_URL on the API server.';
    res.status(403).json({
      error: `Origin ${origin} is not allowed by CORS. ${hint}`
    });
  });

  return allowedOrigins;
}

module.exports = { applyCors, getAllowedOrigins };
