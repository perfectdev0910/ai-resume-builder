const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { prettyCompanyName } = require('../utils/companyName');
const { resolveTimeZone, sqlUtc, getPeriodRange, localDateKey, zonedLocalToUtc } = require('../utils/timezone');
const { clampLimit } = require('../config/env');
const storage = require('../services/storage');
const { buildXlsx } = require('../utils/xlsxWriter');
const { buildZip } = require('../utils/zipWriter');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

/**
 * DB helpers compatible with both SQLite and Postgres.
 */
async function getOneCompat(sqliteSql, postgresSql, params = []) {
  if (isPostgres) {
    if (typeof db.getOne === 'function') {
      return db.getOne(postgresSql, params);
    }
    if (typeof db.query === 'function') {
      const result = await db.query(postgresSql, params);
      return result.rows[0] || null;
    }
    if (db.pool && typeof db.pool.query === 'function') {
      const result = await db.pool.query(postgresSql, params);
      return result.rows[0] || null;
    }
    throw new Error('Postgres database adapter is missing getOne/query/pool.query');
  }

  if (typeof db.getOne !== 'function') {
    throw new Error('SQLite database adapter is missing getOne');
  }

  return db.getOne(sqliteSql, params);
}

async function getAllCompat(sqliteSql, postgresSql, params = []) {
  if (isPostgres) {
    if (typeof db.getAll === 'function') {
      return db.getAll(postgresSql, params);
    }
    if (typeof db.query === 'function') {
      const result = await db.query(postgresSql, params);
      return result.rows || [];
    }
    if (db.pool && typeof db.pool.query === 'function') {
      const result = await db.pool.query(postgresSql, params);
      return result.rows || [];
    }
    throw new Error('Postgres database adapter is missing getAll/query/pool.query');
  }

  if (typeof db.getAll !== 'function') {
    throw new Error('SQLite database adapter is missing getAll');
  }

  return db.getAll(sqliteSql, params);
}

async function runQueryCompat(sqliteSql, postgresSql, params = []) {
  if (isPostgres) {
    if (typeof db.runQuery === 'function') {
      return db.runQuery(postgresSql, params);
    }
    if (typeof db.query === 'function') {
      return db.query(postgresSql, params);
    }
    if (db.pool && typeof db.pool.query === 'function') {
      return db.pool.query(postgresSql, params);
    }
    throw new Error('Postgres database adapter is missing runQuery/query/pool.query');
  }

  if (typeof db.runQuery !== 'function') {
    throw new Error('SQLite database adapter is missing runQuery');
  }

  return db.runQuery(sqliteSql, params);
}

// Helper to delete a stored file (local path or cloud URL/key)
async function deleteFileIfExists(stored) {
  if (!stored) return;
  try {
    if (/^https?:\/\//i.test(stored)) {
      let storagePath = stored;
      try {
        const u = new URL(stored);
        const marker = '/uploads/';
        const idx = u.pathname.indexOf(marker);
        storagePath = idx >= 0
          ? u.pathname.slice(idx + 1)
          : path.basename(u.pathname);
      } catch {
        storagePath = path.basename(stored);
      }
      if (storage && typeof storage.deleteFile === 'function') {
        await storage.deleteFile(storagePath);
      }
      return;
    }

    if (String(stored).includes('uploads/') && storage && typeof storage.deleteFile === 'function' && process.env.STORAGE_PROVIDER) {
      await storage.deleteFile(stored.startsWith('uploads/') ? stored : `uploads/${path.basename(stored)}`);
      return;
    }

    const filename = path.basename(String(stored));
    const filepath = path.join(UPLOAD_DIR, filename);
    await fs.unlink(filepath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Failed to delete file ${stored}:`, err.message);
    }
  }
}

// Check for duplicate application (same company in 30 days)
router.get('/check-duplicate', authMiddleware, async (req, res) => {
  try {
    const companyName = prettyCompanyName(req.query.companyName);

    if (!companyName) {
      return res.json({ isDuplicate: false });
    }

    const result = await getOneCompat(
      `SELECT COUNT(*) as count FROM applications
       WHERE user_id = ?
       AND LOWER(company_name) = LOWER(?)
       AND applied_at >= DATE('now', '-30 days')`,
      `SELECT COUNT(*)::int as count FROM applications
       WHERE user_id = $1
       AND LOWER(company_name) = LOWER($2)
       AND applied_at >= NOW() - INTERVAL '30 days'`,
      [req.user.id, companyName]
    );

    res.json({ isDuplicate: Number(result.count) > 0 });
  } catch (error) {
    console.error('Duplicate check error:', error);
    res.status(500).json({ error: 'Failed to check for duplicates', details: error.message });
  }
});

/**
 * Excel export of the history, for a date range the user picks.
 *
 * Deliberately not paginated — the point is to get the whole range in one file —
 * so the row count is capped to keep one request from building an unbounded sheet.
 */
const EXPORT_MAX_ROWS = 5000;
const LINKEDIN_LINK = '%linkedin.%';

/**
 * Builds the WHERE clause both exports share: a date range, an optional company
 * search, and the option to leave LinkedIn-hosted postings out.
 */
function buildHistoryFilter(userId, { startDate, endDate, search, excludeLinkedIn, timezone }) {
  const params = [userId];
  const nextParam = () => (isPostgres ? `$${params.length + 1}` : '?');
  let sqliteFilter = '';
  let postgresFilter = '';

  // Dates mean the caller's calendar days, not the stored UTC ones: "6 October" in
  // Los Angeles runs from 07:00Z to 07:00Z the next day. Comparing DATE(applied_at)
  // instead would misfile every application made after 5pm local time.
  const zone = resolveTimeZone(timezone);
  const dayStartUtc = (value, addDays = 0) => {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  const start = zonedLocalToUtc(zone, y, m, d, 0, 0, 0);
  return sqlUtc(addDays ? new Date(start.getTime() + addDays * 86400000) : start);
  };

  if (startDate) {
  sqliteFilter += ' AND datetime(applied_at) >= datetime(?)';
  postgresFilter += ` AND applied_at >= ${nextParam()}`;
  params.push(dayStartUtc(startDate));
  }
  if (endDate) {
  sqliteFilter += ' AND datetime(applied_at) < datetime(?)';
  postgresFilter += ` AND applied_at < ${nextParam()}`;
  params.push(dayStartUtc(endDate, 1));
  }
    if (search && search.trim()) {
    sqliteFilter += ' AND LOWER(company_name) LIKE LOWER(?)';
    postgresFilter += ` AND LOWER(company_name) LIKE LOWER(${nextParam()})`;
    params.push(`%${search.trim()}%`);
  }
  if (excludeLinkedIn === 'true' || excludeLinkedIn === '1') {
    // Match the link, not the company: a job hosted on LinkedIn is the thing to drop,
    // and an application to LinkedIn the company is a legitimate row.
    sqliteFilter += ' AND (jd_link IS NULL OR LOWER(jd_link) NOT LIKE ?)';
    postgresFilter += ` AND (jd_link IS NULL OR LOWER(jd_link) NOT LIKE ${nextParam()})`;
    params.push(LINKEDIN_LINK);
  }

  return { params, sqliteFilter, postgresFilter };
}

/** The rows of one export, oldest first so the numbering reads like a diary. */
async function loadHistoryRows(userId, query, columns, limit) {
  const { params, sqliteFilter, postgresFilter } = buildHistoryFilter(userId, query);
  return getAllCompat(
    `SELECT ${columns} FROM applications WHERE user_id = ? ${sqliteFilter} ORDER BY applied_at ASC, id ASC LIMIT ${limit}`,
    `SELECT ${columns} FROM applications WHERE user_id = $1 ${postgresFilter} ORDER BY applied_at ASC, id ASC LIMIT ${limit}`,
    params
  );
}

const HISTORY_COLUMNS = 'company_name, job_title, jd_link, applied_at';

function exportFilename(query, timezone, extension) {
  const stamp = (value, fallback) => (value ? String(value).slice(0, 10) : fallback);
  return `applications-${stamp(query.startDate, 'all')}-to-${stamp(query.endDate, localDateKey(new Date(), timezone))}.${extension}`;
}

/** The CSV every spreadsheet opens: BOM first, CRLF line endings, quotes doubled. */
function toCsv(rows) {
  const cell = (value) => {
    const text = String(value ?? '');
    return /["\r\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = ['No,Company Name,Job Title,JD link'];
  rows.forEach((row, index) => {
    lines.push([index + 1, row.company_name || '', row.job_title || '', row.jd_link || ''].map(cell).join(','));
  });
  // The BOM is what makes Excel read a UTF-8 CSV without mangling accents.
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

router.get('/export', authMiddleware, async (req, res) => {
  try {
    // An explicit ?timezone= wins (the browser sends its own), else the profile's.
    const timezone = resolveTimeZone(req.query.timezone || req.user.timezone);
    const rows = await loadHistoryRows(req.user.id, { ...req.query, timezone }, HISTORY_COLUMNS, EXPORT_MAX_ROWS);

    // Same data either way; the spreadsheet is the default, CSV on request.
    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const filename = exportFilename(req.query, timezone, 'csv');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Row-Count', String(rows.length));
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Row-Count');
      return res.send(toCsv(rows));
    }

    const workbook = buildXlsx({
      sheetName: 'Applications',
      columns: [
        { header: 'No', key: 'no', width: 6 },
        { header: 'Company Name', key: 'company', width: 34 },
        { header: 'Job Title', key: 'title', width: 52 },
        { header: 'JD link', key: 'link', width: 80 }
      ],
      rows: rows.map((row, index) => ({
        no: index + 1,
        company: row.company_name || '',
        title: row.job_title || '',
        link: row.jd_link ? { text: row.jd_link, link: row.jd_link } : ''
      }))
    });

    const filename = exportFilename(req.query, timezone, 'xlsx');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Row-Count', String(rows.length));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Row-Count');
    res.send(workbook);
  } catch (error) {
    console.error('Application export error:', error);
    res.status(500).json({ error: 'Failed to export applications', details: error.message });
  }
});

/**
 * The generated documents for a date range, as one zip.
 *
 * Laid out the way the application packs are read: a numbered folder per company
 * holding the resume and cover letter in both formats, named after the account
 * holder, with jobs.csv beside them so a row and a folder share the same number.
 *
 * Capped, because every row is four files fetched from storage.
 */
/**
 * A stored file is either a full URL (cloud storage) or a name under uploads/.
 * Mirrors the resolver the download routes use.
 */
function storedFileLocation(stored) {
  if (!stored) return null;
  if (/^https?:\/\//i.test(stored)) return stored;
  return path.basename(stored);
}
const DOCUMENT_EXPORT_MAX_ROWS = 200;

const safeName = (value, fallback) =>
  String(value || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;

/** Storage keeps files either behind a URL or in the uploads folder; read both. */
async function readStoredFile(fileUrl) {
  if (!fileUrl) return null;
  try {
    if (/^https?:\/\//i.test(fileUrl)) {
      const res = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return await fs.readFile(path.join(UPLOAD_DIR, path.basename(fileUrl)));
  } catch {
    return null;   // a missing file is reported in the manifest, never fatal
  }
}

router.get('/export-documents', authMiddleware, async (req, res) => {
  try {
    const timezone = resolveTimeZone(req.query.timezone || req.user.timezone);
    const rows = await loadHistoryRows(
      req.user.id,
      { ...req.query, timezone },
      'id, company_name, job_title, jd_link, applied_at, cv_pdf_url, cv_doc_url, cover_letter_pdf_url, cover_letter_doc_url',
      DOCUMENT_EXPORT_MAX_ROWS + 1
    );

    if (!rows.length) return res.status(404).json({ error: 'No applications in that range' });
    if (rows.length > DOCUMENT_EXPORT_MAX_ROWS) {
      return res.status(413).json({
        error: `That range holds more than ${DOCUMENT_EXPORT_MAX_ROWS} applications. Narrow the dates and download it in parts.`
      });
    }

    const user = await getOneCompat(
      'SELECT full_name, email FROM users WHERE id = ?',
      'SELECT full_name, email FROM users WHERE id = $1',
      [req.user.id]
    );
    const person = safeName(user?.full_name || String(user?.email || 'resume').split('@')[0], 'resume').replace(/\s+/g, '_');

    const entries = [];
    const manifest = [];
    let files = 0;

    for (const [index, row] of rows.entries()) {
      const no = index + 1;
      const folder = `${no}_${safeName(row.company_name, 'Unknown')}`;
      const wanted = [
        [row.cv_pdf_url, `${person}.pdf`],
        [row.cv_doc_url, `${person}.docx`],
        [row.cover_letter_pdf_url, `${person}_cover.pdf`],
        [row.cover_letter_doc_url, `${person}_cover.docx`]
      ];

      const got = [];
      for (const [fileUrl, name] of wanted) {
        const data = await readStoredFile(storedFileLocation(fileUrl));
        if (!data || !data.length) continue;
        entries.push({ name: `${folder}/${name}`, data });
        got.push(name);
        files++;
      }
      manifest.push({ ...row, no, folder, files: got.length });
    }

    // jobs.csv travels inside the zip, so the pack explains itself.
    entries.push({ name: 'jobs.csv', data: Buffer.from(toCsv(rows), 'utf8') });

    const zip = buildZip(entries);
    const filename = exportFilename(req.query, timezone, 'zip').replace('applications-', 'resumes-');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Row-Count', String(rows.length));
    res.setHeader('X-File-Count', String(files));
    res.setHeader('X-Incomplete-Count', String(manifest.filter((m) => m.files < 4).length));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Row-Count, X-File-Count, X-Incomplete-Count');
    res.send(zip);
  } catch (error) {
    console.error('Document export error:', error);
    res.status(500).json({ error: 'Failed to export documents', details: error.message });
  }
});

// Distinct companies from the user's application history
router.get('/companies', authMiddleware, async (req, res) => {
  try {
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const params = [req.user.id];
    let sqliteSearch = '';
    let postgresSearch = '';

    if (search) {
      params.push(`%${search}%`);
      sqliteSearch = 'AND LOWER(company_name) LIKE LOWER(?)';
      postgresSearch = 'AND LOWER(company_name) LIKE LOWER($2)';
    }

    const limit = search ? 200 : 500;

    // One query: per company (case-insensitive) pick the latest application row and carry
    // the group count / last applied date via window functions. The previous version ran
    // an extra query per company inside Promise.all, which exhausted the connection pool
    // (pool max 5, 10s wait cap) on hosted Postgres and made the whole request 500.
    const selectLatestPerCompany = (searchSql) => `
      SELECT company_name, id, job_title, jd_link, cv_doc_url, cv_pdf_url, applied_at,
             last_applied_at, count
      FROM (
        SELECT company_name, id, job_title, jd_link, cv_doc_url, cv_pdf_url, applied_at,
               MAX(applied_at) OVER (PARTITION BY LOWER(company_name)) AS last_applied_at,
               COUNT(*) OVER (PARTITION BY LOWER(company_name)) AS count,
               ROW_NUMBER() OVER (
                 PARTITION BY LOWER(company_name)
                 ORDER BY applied_at DESC, id DESC
               ) AS rn
        FROM applications
        WHERE user_id = ${isPostgres ? '$1' : '?'}
          AND company_name IS NOT NULL
          AND TRIM(company_name) != ''
          ${searchSql}
      ) latest
      WHERE rn = 1
      ORDER BY last_applied_at DESC
      LIMIT ${limit}`;

    const companies = await getAllCompat(
      selectLatestPerCompany(sqliteSearch),
      selectLatestPerCompany(postgresSearch),
      params
    );

    const now = Date.now();
    const windowMs = 30 * 24 * 60 * 60 * 1000;

    const detailed = companies.map((row) => {
      const lastAppliedAt = row.last_applied_at;
      const lastAppliedMs = lastAppliedAt ? new Date(lastAppliedAt).getTime() : 0;
      const base = {
        companyName: row.company_name,
        lastAppliedAt,
        applicationCount: Number(row.count) || 0,
        isDuplicate: Boolean(lastAppliedMs && now - lastAppliedMs <= windowMs)
      };
      return base;
    });

    res.json({ companies: detailed });
  } catch (error) {
    console.error('Companies fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch companies', details: error.message });
  }
});

// Get application history with filtering and search
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { period, startDate, endDate, page = 1, limit = 20, search } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = clampLimit(limit, 20, 100);
    const offset = (pageNum - 1) * limitNum;

    let sqliteDateFilter = '';
    let postgresDateFilter = '';
    let sqliteSearchFilter = '';
    let postgresSearchFilter = '';
    const params = [req.user.id];
    const userTimezone = resolveTimeZone(req.user.timezone);

    const nextParam = () => (isPostgres ? `$${params.length + 1}` : '?');

    if (period) {
      switch (period) {
        case 'daily': {
          const range = getPeriodRange(userTimezone, 'daily');
          sqliteDateFilter = 'AND datetime(applied_at) >= datetime(?) AND datetime(applied_at) < datetime(?)';
          const startPlaceholder = nextParam();
          params.push(sqlUtc(range.start));
          const endPlaceholder = nextParam();
          params.push(sqlUtc(range.end));
          postgresDateFilter = `AND applied_at >= ${startPlaceholder} AND applied_at < ${endPlaceholder}`;
          break;
        }
        case 'weekly':
          sqliteDateFilter = "AND applied_at >= DATE('now', '-7 days')";
          postgresDateFilter = "AND applied_at >= NOW() - INTERVAL '7 days'";
          break;
        case 'monthly':
          sqliteDateFilter = "AND applied_at >= DATE('now', '-30 days')";
          postgresDateFilter = "AND applied_at >= NOW() - INTERVAL '30 days'";
          break;
      }
    } else if (startDate && endDate) {
      sqliteDateFilter = `AND DATE(applied_at) BETWEEN ? AND ?`;
      const p1 = nextParam();
      params.push(startDate);
      const p2 = nextParam();
      params.push(endDate);
      postgresDateFilter = `AND DATE(applied_at) BETWEEN ${p1} AND ${p2}`;
    }

    if (search && search.trim()) {
      const searchValue = `%${search.trim()}%`;
      sqliteSearchFilter = 'AND LOWER(company_name) LIKE LOWER(?)';
      const p = nextParam();
      params.push(searchValue);
      postgresSearchFilter = `AND LOWER(company_name) LIKE LOWER(${p})`;
    }

    const countResult = await getOneCompat(
      `SELECT COUNT(*) as total FROM applications WHERE user_id = ? ${sqliteDateFilter} ${sqliteSearchFilter}`,
      `SELECT COUNT(*)::int as total FROM applications WHERE user_id = $1 ${postgresDateFilter} ${postgresSearchFilter}`,
      params
    );

    let applications;
    if (isPostgres) {
      const listParams = [...params];
      const limitPlaceholder = `$${listParams.length + 1}`;
      listParams.push(limitNum);
      const offsetPlaceholder = `$${listParams.length + 1}`;
      listParams.push(offset);

      applications = await getAllCompat(
        '',
        `SELECT * FROM applications
         WHERE user_id = $1 ${postgresDateFilter} ${postgresSearchFilter}
         ORDER BY applied_at DESC
         LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        listParams
      );
    } else {
      applications = await getAllCompat(
        `SELECT * FROM applications
         WHERE user_id = ? ${sqliteDateFilter} ${sqliteSearchFilter}
         ORDER BY applied_at DESC
         LIMIT ? OFFSET ?`,
        '',
        [...params, limitNum, offset]
      );
    }

    const formattedApps = applications.map(app => ({
      id: app.id,
      jobTitle: app.job_title,
      companyName: app.company_name,
      jdLink: app.jd_link,
      appliedAt: app.applied_at,
      appliedAtTimezone: userTimezone,
      status: app.status,
      cvDocUrl: app.cv_doc_url || null,
      cvPdfUrl: app.cv_pdf_url || null,
      coverLetterDocUrl: app.cover_letter_doc_url || null,
      coverLetterPdfUrl: app.cover_letter_pdf_url || null,
      notes: app.notes
    }));

    res.json({
      applications: formattedApps,
      pagination: {
        total: Number(countResult.total),
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(Number(countResult.total) / limitNum)
      },
      userTimezone
    });
  } catch (error) {
    console.error('Applications fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch applications', details: error.message });
  }
});

// Get application statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const userTimezone = resolveTimeZone(req.user.timezone);
    const todayRange = getPeriodRange(userTimezone, 'daily');
    const weekRange = getPeriodRange(userTimezone, 'weekly');
    const monthRange = getPeriodRange(userTimezone, 'monthly');
    const statParams = [
      sqlUtc(todayRange.start),
      sqlUtc(todayRange.end),
      sqlUtc(weekRange.start),
      sqlUtc(weekRange.end),
      sqlUtc(monthRange.start),
      sqlUtc(monthRange.end),
      req.user.id
    ];

    const stats = await getAllCompat(
      `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (
          WHERE datetime(applied_at) >= datetime(?) AND datetime(applied_at) < datetime(?)
        ) as today,
        COUNT(*) FILTER (
          WHERE datetime(applied_at) >= datetime(?) AND datetime(applied_at) < datetime(?)
        ) as thisWeek,
        COUNT(*) FILTER (
          WHERE datetime(applied_at) >= datetime(?) AND datetime(applied_at) < datetime(?)
        ) as thisMonth
      FROM applications
      WHERE user_id = ?
      `,
      `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (
          WHERE applied_at >= $1 AND applied_at < $2
        )::int as today,
        COUNT(*) FILTER (
          WHERE applied_at >= $3 AND applied_at < $4
        )::int as thisWeek,
        COUNT(*) FILTER (
          WHERE applied_at >= $5 AND applied_at < $6
        )::int as thisMonth
      FROM applications
      WHERE user_id = $7
      `,
      statParams
    );

    const byCompany = await getAllCompat(
      `SELECT company_name, COUNT(*) as count
       FROM applications
       WHERE user_id = ? AND company_name IS NOT NULL
       GROUP BY company_name
       ORDER BY count DESC
       LIMIT 10`,
      `SELECT company_name, COUNT(*)::int as count
       FROM applications
       WHERE user_id = $1 AND company_name IS NOT NULL
       GROUP BY company_name
       ORDER BY count DESC
       LIMIT 10`,
      [req.user.id]
    );

    const timelineCutoff = sqlUtc(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const recentRows = await getAllCompat(
      `SELECT applied_at FROM applications WHERE user_id = ? AND datetime(applied_at) >= datetime(?)`,
      `SELECT applied_at FROM applications WHERE user_id = $1 AND applied_at >= $2`,
      [req.user.id, timelineCutoff]
    );

    const timelineBuckets = {};
    for (const row of recentRows) {
      const key = localDateKey(row.applied_at, userTimezone);
      if (!key) continue;
      timelineBuckets[key] = (timelineBuckets[key] || 0) + 1;
    }
    const timeline = Object.keys(timelineBuckets)
      .sort()
      .map((date) => ({ date, count: timelineBuckets[date] }));

    res.json({
      stats: stats[0] || { total: 0, today: 0, thisWeek: 0, thisMonth: 0 },
      byCompany,
      timeline,
      userTimezone
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics', details: error.message });
  }
});

// Get single application
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const application = await getOneCompat(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      'SELECT * FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({
      application: {
        id: application.id,
        jobTitle: application.job_title,
        companyName: application.company_name,
        jdLink: application.jd_link,
        jdContent: application.jd_content,
        appliedAt: application.applied_at,
        status: application.status,
        cvDocUrl: application.cv_doc_url || null,
        cvPdfUrl: application.cv_pdf_url || null,
        notes: application.notes
      }
    });
  } catch (error) {
    console.error('Application fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch application', details: error.message });
  }
});

// Update application status/notes
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { status, notes } = req.body;

    await runQueryCompat(
      `UPDATE applications SET
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
       WHERE id = ? AND user_id = ?`,
      `UPDATE applications SET
        status = COALESCE($1, status),
        notes = COALESCE($2, notes)
       WHERE id = $3 AND user_id = $4`,
      [status ?? null, notes ?? null, req.params.id, req.user.id]
    );

    res.json({ message: 'Application updated successfully' });
  } catch (error) {
    console.error('Application update error:', error);
    res.status(500).json({ error: 'Failed to update application', details: error.message });
  }
});

// Delete application
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const application = await getOneCompat(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      'SELECT * FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    await Promise.all([
      deleteFileIfExists(application.cv_doc_url),
      deleteFileIfExists(application.cv_pdf_url),
      deleteFileIfExists(application.cover_letter_doc_url),
      deleteFileIfExists(application.cover_letter_pdf_url)
    ]);

    await runQueryCompat(
      'DELETE FROM applications WHERE id = ? AND user_id = ?',
      'DELETE FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    res.json({ message: 'Application deleted successfully' });
  } catch (error) {
    console.error('Application delete error:', error);
    res.status(500).json({ error: 'Failed to delete application', details: error.message });
  }
});

// Admin: Get all applications (all users)
router.get('/admin/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = clampLimit(limit, 50, 100);
    const offset = (pageNum - 1) * limitNum;

    let applications;
    if (isPostgres) {
      applications = await getAllCompat(
        '',
        `SELECT a.*, u.email, u.full_name
         FROM applications a
         JOIN users u ON a.user_id = u.id
         ORDER BY a.applied_at DESC
         LIMIT $1 OFFSET $2`,
        [limitNum, offset]
      );
    } else {
      applications = await getAllCompat(
        `SELECT a.*, u.email, u.full_name
         FROM applications a
         JOIN users u ON a.user_id = u.id
         ORDER BY a.applied_at DESC
         LIMIT ? OFFSET ?`,
        '',
        [limitNum, offset]
      );
    }

    const countResult = await getOneCompat(
      'SELECT COUNT(*) as total FROM applications',
      'SELECT COUNT(*)::int as total FROM applications',
      []
    );

    res.json({
      applications: applications.map(app => ({
        id: app.id,
        userId: app.user_id,
        userEmail: app.email,
        userName: app.full_name,
        jobTitle: app.job_title,
        companyName: app.company_name,
        jdLink: app.jd_link,
        appliedAt: app.applied_at,
        status: app.status
      })),
      pagination: {
        total: Number(countResult.total),
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(Number(countResult.total) / limitNum)
      }
    });
  } catch (error) {
    console.error('Admin applications fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch applications', details: error.message });
  }
});

module.exports = router;