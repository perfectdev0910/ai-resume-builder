const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const { authMiddleware, adminMiddleware } = require('../middleware/auth');

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

// Helper to delete a file if it exists
async function deleteFileIfExists(filename) {
  if (!filename) return;
  try {
    const filepath = path.join(UPLOAD_DIR, filename);
    await fs.unlink(filepath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Failed to delete file ${filename}:`, err);
    }
  }
}

// Check for duplicate application (same company in last 2 weeks)
router.get('/check-duplicate', authMiddleware, async (req, res) => {
  try {
    const { companyName } = req.query;

    if (!companyName) {
      return res.json({ isDuplicate: false });
    }

    const result = await getOneCompat(
      `SELECT COUNT(*) as count FROM applications
       WHERE user_id = ?
       AND LOWER(company_name) = LOWER(?)
       AND applied_at >= DATE('now', '-14 days')`,
      `SELECT COUNT(*)::int as count FROM applications
       WHERE user_id = $1
       AND LOWER(company_name) = LOWER($2)
       AND applied_at >= NOW() - INTERVAL '14 days'`,
      [req.user.id, companyName]
    );

    res.json({ isDuplicate: Number(result.count) > 0 });
  } catch (error) {
    console.error('Duplicate check error:', error);
    res.status(500).json({ error: 'Failed to check for duplicates', details: error.message });
  }
});

// Get application history with filtering and search
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { period, startDate, endDate, page = 1, limit = 20, search } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let sqliteDateFilter = '';
    let postgresDateFilter = '';
    let sqliteSearchFilter = '';
    let postgresSearchFilter = '';
    const params = [req.user.id];

    const nextParam = () => (isPostgres ? `$${params.length + 1}` : '?');

    if (period) {
      switch (period) {
        case 'daily':
          sqliteDateFilter = "AND DATE(applied_at) = DATE('now')";
          postgresDateFilter = "AND DATE(applied_at) = CURRENT_DATE";
          break;
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

    const user = await getOneCompat(
      'SELECT timezone FROM users WHERE id = ?',
      'SELECT timezone FROM users WHERE id = $1',
      [req.user.id]
    );

    const userTimezone = user?.timezone || 'UTC';

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
    const stats = await getAllCompat(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN DATE(applied_at) = DATE('now') THEN 1 END) as today,
        COUNT(CASE WHEN applied_at >= DATE('now', '-7 days') THEN 1 END) as thisWeek,
        COUNT(CASE WHEN applied_at >= DATE('now', '-30 days') THEN 1 END) as thisMonth
       FROM applications WHERE user_id = ?`,
      `SELECT
        COUNT(*)::int as total,
        COUNT(CASE WHEN DATE(applied_at) = CURRENT_DATE THEN 1 END)::int as today,
        COUNT(CASE WHEN applied_at >= NOW() - INTERVAL '7 days' THEN 1 END)::int as thisWeek,
        COUNT(CASE WHEN applied_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int as thisMonth
       FROM applications WHERE user_id = $1`,
      [req.user.id]
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

    const timeline = await getAllCompat(
      `SELECT DATE(applied_at) as date, COUNT(*) as count
       FROM applications
       WHERE user_id = ? AND applied_at >= DATE('now', '-30 days')
       GROUP BY DATE(applied_at)
       ORDER BY date`,
      `SELECT DATE(applied_at) as date, COUNT(*)::int as count
       FROM applications
       WHERE user_id = $1 AND applied_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(applied_at)
       ORDER BY date`,
      [req.user.id]
    );

    res.json({
      stats: stats[0] || { total: 0, today: 0, thisWeek: 0, thisMonth: 0 },
      byCompany,
      timeline
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
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
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