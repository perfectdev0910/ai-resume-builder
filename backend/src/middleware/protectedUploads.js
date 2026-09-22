const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

async function getOneCompat(sqliteSql, postgresSql, params = []) {
  if (isPostgres) {
    if (typeof db.getOne === 'function') return db.getOne(postgresSql, params);
    if (typeof db.query === 'function') {
      const result = await db.query(postgresSql, params);
      return result.rows[0] || null;
    }
    if (db.pool && typeof db.pool.query === 'function') {
      const result = await db.pool.query(postgresSql, params);
      return result.rows[0] || null;
    }
    throw new Error('Postgres database adapter is missing getOne/query');
  }
  return db.getOne(sqliteSql, params);
}

function getCleanDownloadFilename(filename) {
  const uuidPattern = /_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
  return filename.replace(uuidPattern, '');
}

/**
 * Serve a local upload only if the authenticated user owns an application that references it
 * (or is admin). Accepts Bearer header or ?access_token= for <a href> downloads.
 */
async function serveProtectedUpload(req, res) {
  try {
    const filename = path.basename(req.params.filename || '');
    if (!filename || filename !== req.params.filename || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (req.user.role !== 'admin') {
      const owned = await getOneCompat(
        `SELECT id FROM applications
         WHERE user_id = ?
           AND (
             cv_doc_url LIKE ? OR cv_pdf_url LIKE ?
             OR cover_letter_doc_url LIKE ? OR cover_letter_pdf_url LIKE ?
           )
         LIMIT 1`,
        `SELECT id FROM applications
         WHERE user_id = $1
           AND (
             cv_doc_url LIKE $2 OR cv_pdf_url LIKE $3
             OR cover_letter_doc_url LIKE $4 OR cover_letter_pdf_url LIKE $5
           )
         LIMIT 1`,
        [req.user.id, `%${filename}`, `%${filename}`, `%${filename}`, `%${filename}`]
      );

      const ownedRecording = owned ? null : await getOneCompat(
        'SELECT id FROM calendar_events WHERE user_id = ? AND recording_url LIKE ? LIMIT 1',
        'SELECT id FROM calendar_events WHERE user_id = $1 AND recording_url LIKE $2 LIMIT 1',
        [req.user.id, `%${filename}`]
      );
      if (!owned && !ownedRecording) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const cleanFilename = getCleanDownloadFilename(filename);
    // Recordings play inline (audio element); documents download.
    const inline = /.(webm|ogg|mp3|wav|m4a)$/i.test(filename);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${cleanFilename}"`);
    return res.sendFile(filepath);
  } catch (error) {
    console.error('Protected upload error:', error);
    return res.status(500).json({ error: 'Failed to download file' });
  }
}

function mountProtectedUploads(app) {
  app.get('/uploads/:filename', authMiddleware, serveProtectedUpload);
}

module.exports = { mountProtectedUploads, serveProtectedUpload, UPLOAD_DIR };
