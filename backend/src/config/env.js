/**
 * Shared env / security helpers. Fail closed in production.
 */

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'your-secret-key' || secret.length < 16) {
    throw new Error(
      'JWT_SECRET must be set to a strong value (min 16 characters). Do not use the example placeholder.'
    );
  }
  return secret;
}

function getAllowedExtensionIds() {
  const raw = process.env.CHROME_EXTENSION_IDS || '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

// Vercel deployments of the dashboard: production, previews, and any re-created project
// (e.g. ai-resume-builder-one-sepia.vercel.app, ai-resume-builder-zb3b-git-main-....vercel.app).
const DASHBOARD_VERCEL_ORIGIN = /^https:\/\/ai-resume-builder[a-z0-9-]*\.vercel\.app$/i;

// FRONTEND_URL may hold one origin or a comma-separated list; trailing slashes are tolerated.
function getFrontendOrigins() {
  return String(process.env.FRONTEND_URL || '')
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) {
    // Allow non-browser clients (curl, server-to-server). Browser CSRF for cookie auth is N/A (Bearer tokens).
    return true;
  }

  const normalized = origin.replace(/\/+$/, '');
  if (allowedOrigins.includes(normalized)) return true;
  if (DASHBOARD_VERCEL_ORIGIN.test(normalized)) return true;

  if (origin.startsWith('chrome-extension://')) {
    const ids = getAllowedExtensionIds();
    if (ids.length === 0) {
      // Dev convenience only — production must set CHROME_EXTENSION_IDS
      return !isProduction();
    }
    const extensionId = origin.slice('chrome-extension://'.length);
    return ids.includes(extensionId);
  }

  return false;
}

function clampLimit(value, fallback = 20, max = 100) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

module.exports = {
  isProduction,
  getJwtSecret,
  getAllowedExtensionIds,
  getFrontendOrigins,
  isOriginAllowed,
  clampLimit
};
