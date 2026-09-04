const express = require('express');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const { authMiddleware } = require('../middleware/auth');
const { prettyCompanyName } = require('../utils/companyName');

const router = express.Router();

const STAGES = [
  'hr_screen',
  'assessment',
  'technical',
  'background_check',
  'onsite_final',
  'offer'
];

const STATUSES = new Set(['upcoming', 'waiting_feedback', 'completed', 'rejected']);
const PLATFORMS = new Set(['google_meet', 'zoom', 'teams', 'phone', 'other']);
const COMPLETED_STATUSES = new Set(['completed', 'waiting_feedback', 'rejected']);

async function getOneCompat(sqliteSql, postgresSql, params = []) {
  if (isPostgres) {
    if (typeof db.getOne === 'function') return db.getOne(postgresSql, params);
    throw new Error('Postgres database adapter is missing getOne');
  }
  return db.getOne(sqliteSql, params);
}

async function getAllCompat(sqliteSql, postgresSql, params = []) {
  if (isPostgres) {
    if (typeof db.getAll === 'function') return db.getAll(postgresSql, params);
    throw new Error('Postgres database adapter is missing getAll');
  }
  return db.getAll(sqliteSql, params);
}

async function runQueryCompat(sqliteSql, postgresSql, params = []) {
  if (isPostgres) {
    if (typeof db.runQuery === 'function') return db.runQuery(postgresSql, params);
    throw new Error('Postgres database adapter is missing runQuery');
  }
  return db.runQuery(sqliteSql, params);
}

function publicFileUrl(stored) {
  if (!stored) return null;
  if (/^https?:\/\//i.test(stored)) return stored;
  return `/uploads/${String(stored).split('/').pop()}`;
}

function formatInterview(row) {
  const stageIndex = Math.max(0, STAGES.indexOf(row.stage));
  return {
    id: row.id,
    applicationId: row.application_id || null,
    companyName: row.company_name || '',
    jobTitle: row.job_title || '',
    jdLink: row.jd_link || '',
    resumeLabel: row.resume_label || '',
    resumeDocUrl: publicFileUrl(row.cv_doc_url),
    resumePdfUrl: publicFileUrl(row.cv_pdf_url),
    stage: row.stage || 'hr_screen',
    stageIndex,
    stageCount: STAGES.length,
    status: row.status || 'upcoming',
    interviewAt: row.interview_at || null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : 30,
    platform: row.platform || 'google_meet',
    callLink: row.call_link || '',
    interviewer: row.interviewer || '',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function fetchInterview(id, userId) {
  return getOneCompat(
    `SELECT i.*, a.cv_doc_url, a.cv_pdf_url
     FROM interviews i
     LEFT JOIN applications a ON i.application_id = a.id
     WHERE i.id = ? AND i.user_id = ?`,
    `SELECT i.*, a.cv_doc_url, a.cv_pdf_url
     FROM interviews i
     LEFT JOIN applications a ON i.application_id = a.id
     WHERE i.id = $1 AND i.user_id = $2`,
    [id, userId]
  );
}

async function findLatestApplication(userId, { applicationId, companyName } = {}) {
  if (applicationId) {
    return getOneCompat(
      `SELECT * FROM applications WHERE id = ? AND user_id = ?`,
      `SELECT * FROM applications WHERE id = $1 AND user_id = $2`,
      [applicationId, userId]
    );
  }

  const name = prettyCompanyName(companyName);
  if (!name) return null;

  return getOneCompat(
    `SELECT * FROM applications
     WHERE user_id = ? AND LOWER(company_name) = LOWER(?)
     ORDER BY applied_at DESC LIMIT 1`,
    `SELECT * FROM applications
     WHERE user_id = $1 AND LOWER(company_name) = LOWER($2)
     ORDER BY applied_at DESC LIMIT 1`,
    [userId, name]
  );
}

function resumeLabelFromApp(app) {
  if (!app) return '';
  const base = [app.company_name, app.job_title].filter(Boolean).join(' — ');
  return base ? `${base} Resume` : 'Resume';
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const tab = String(req.query.tab || 'all');
    const stage = typeof req.query.stage === 'string' ? req.query.stage.trim() : '';
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const params = [req.user.id];
    let sqliteFilters = '';
    let postgresFilters = '';

    const nextParam = () => (isPostgres ? `$${params.length + 1}` : '?');

    if (tab === 'upcoming') {
      sqliteFilters += " AND i.status = 'upcoming'";
      postgresFilters += " AND i.status = 'upcoming'";
    } else if (tab === 'completed') {
      sqliteFilters += " AND i.status IN ('completed', 'waiting_feedback', 'rejected')";
      postgresFilters += " AND i.status IN ('completed', 'waiting_feedback', 'rejected')";
    }

    if (stage && STAGES.includes(stage)) {
      const p = nextParam();
      params.push(stage);
      sqliteFilters += ' AND i.stage = ?';
      postgresFilters += ` AND i.stage = ${p}`;
    }

    if (search) {
      const like = `%${search}%`;
      if (isPostgres) {
        const p = nextParam();
        params.push(like);
        postgresFilters += ` AND (
          LOWER(i.company_name) LIKE LOWER(${p})
          OR LOWER(COALESCE(i.job_title, '')) LIKE LOWER(${p})
          OR LOWER(COALESCE(i.interviewer, '')) LIKE LOWER(${p})
        )`;
      } else {
        params.push(like, like, like);
        sqliteFilters += ` AND (
          LOWER(i.company_name) LIKE LOWER(?)
          OR LOWER(COALESCE(i.job_title, '')) LIKE LOWER(?)
          OR LOWER(COALESCE(i.interviewer, '')) LIKE LOWER(?)
        )`;
      }
    }

    const rows = await getAllCompat(
      `SELECT i.*, a.cv_doc_url, a.cv_pdf_url
       FROM interviews i
       LEFT JOIN applications a ON i.application_id = a.id
       WHERE i.user_id = ? ${sqliteFilters}
       ORDER BY
         CASE WHEN i.interview_at IS NULL OR i.interview_at = '' THEN 1 ELSE 0 END,
         i.interview_at ASC,
         i.updated_at DESC`,
      `SELECT i.*, a.cv_doc_url, a.cv_pdf_url
       FROM interviews i
       LEFT JOIN applications a ON i.application_id = a.id
       WHERE i.user_id = $1 ${postgresFilters}
       ORDER BY
         CASE WHEN i.interview_at IS NULL THEN 1 ELSE 0 END,
         i.interview_at ASC NULLS LAST,
         i.updated_at DESC`,
      params
    );

    res.json({
      interviews: rows.map(formatInterview),
      stages: STAGES,
      platforms: [...PLATFORMS]
    });
  } catch (error) {
    console.error('Interviews fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch interviews', details: error.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { applicationId, companyName } = req.body;
    const app = await findLatestApplication(req.user.id, { applicationId, companyName });

    if (!app) {
      return res.status(404).json({ error: 'No application found for that company. Generate a CV first.' });
    }

    const name = prettyCompanyName(app.company_name);
    if (!name) {
      return res.status(400).json({ error: 'Application is missing a company name' });
    }

    const existing = await getOneCompat(
      `SELECT id FROM interviews WHERE user_id = ? AND LOWER(company_name) = LOWER(?)`,
      `SELECT id FROM interviews WHERE user_id = $1 AND LOWER(company_name) = LOWER($2)`,
      [req.user.id, name]
    );

    if (existing) {
      return res.status(409).json({
        error: 'An interview for this company already exists.',
        interviewId: existing.id
      });
    }

    const values = [
      req.user.id,
      app.id,
      name,
      app.job_title || '',
      app.jd_link || '',
      resumeLabelFromApp(app),
      'hr_screen',
      'upcoming',
      null,
      30,
      'google_meet',
      '',
      '',
      ''
    ];

    let id;
    if (isPostgres) {
      const result = await runQueryCompat(
        '',
        `INSERT INTO interviews
          (user_id, application_id, company_name, job_title, jd_link, resume_label, stage, status, interview_at, duration_minutes, platform, call_link, interviewer, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        values
      );
      id = result.rows?.[0]?.id;
    } else {
      const result = await runQueryCompat(
        `INSERT INTO interviews
          (user_id, application_id, company_name, job_title, jd_link, resume_label, stage, status, interview_at, duration_minutes, platform, call_link, interviewer, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        '',
        values
      );
      id = result.lastID;
    }

    const created = await fetchInterview(id, req.user.id);
    res.status(201).json({ interview: formatInterview(created) });
  } catch (error) {
    console.error('Interview create error:', error);
    if (String(error.message || '').toLowerCase().includes('unique')) {
      return res.status(409).json({ error: 'An interview for this company already exists.' });
    }
    res.status(500).json({ error: 'Failed to create interview', details: error.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await getOneCompat(
      'SELECT * FROM interviews WHERE id = ? AND user_id = ?',
      'SELECT * FROM interviews WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    const next = {
      job_title: req.body.jobTitle !== undefined ? req.body.jobTitle : existing.job_title,
      jd_link: req.body.jdLink !== undefined ? req.body.jdLink : existing.jd_link,
      resume_label: req.body.resumeLabel !== undefined ? req.body.resumeLabel : existing.resume_label,
      application_id: req.body.applicationId !== undefined ? (req.body.applicationId || null) : existing.application_id,
      stage: req.body.stage !== undefined ? req.body.stage : existing.stage,
      status: req.body.status !== undefined ? req.body.status : existing.status,
      interview_at: req.body.interviewAt !== undefined ? (req.body.interviewAt || null) : existing.interview_at,
      duration_minutes: req.body.durationMinutes !== undefined ? Number(req.body.durationMinutes) : existing.duration_minutes,
      platform: req.body.platform !== undefined ? req.body.platform : existing.platform,
      call_link: req.body.callLink !== undefined ? req.body.callLink : existing.call_link,
      interviewer: req.body.interviewer !== undefined ? req.body.interviewer : existing.interviewer,
      notes: req.body.notes !== undefined ? req.body.notes : existing.notes
    };

    if (next.stage && !STAGES.includes(next.stage)) {
      return res.status(400).json({ error: 'Invalid stage' });
    }
    if (next.status && !STATUSES.has(next.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (next.platform && !PLATFORMS.has(next.platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    await runQueryCompat(
      `UPDATE interviews SET
        job_title = ?, jd_link = ?, resume_label = ?, application_id = ?,
        stage = ?, status = ?, interview_at = ?, duration_minutes = ?,
        platform = ?, call_link = ?, interviewer = ?, notes = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      `UPDATE interviews SET
        job_title = $1, jd_link = $2, resume_label = $3, application_id = $4,
        stage = $5, status = $6, interview_at = $7, duration_minutes = $8,
        platform = $9, call_link = $10, interviewer = $11, notes = $12,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 AND user_id = $14`,
      [
        next.job_title || '',
        next.jd_link || '',
        next.resume_label || '',
        next.application_id,
        next.stage || 'hr_screen',
        next.status || 'upcoming',
        next.interview_at,
        Number.isFinite(next.duration_minutes) ? next.duration_minutes : 30,
        next.platform || 'google_meet',
        next.call_link || '',
        next.interviewer || '',
        next.notes || '',
        req.params.id,
        req.user.id
      ]
    );

    const updated = await fetchInterview(req.params.id, req.user.id);
    res.json({ interview: formatInterview(updated) });
  } catch (error) {
    console.error('Interview update error:', error);
    res.status(500).json({ error: 'Failed to update interview', details: error.message });
  }
});

router.post('/:id/progress', authMiddleware, async (req, res) => {
  try {
    const action = String(req.body.action || '');
    const existing = await getOneCompat(
      'SELECT * FROM interviews WHERE id = ? AND user_id = ?',
      'SELECT * FROM interviews WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    let stage = existing.stage || 'hr_screen';
    let status = existing.status || 'upcoming';

    if (action === 'complete') {
      status = 'waiting_feedback';
    } else if (action === 'reject') {
      status = 'rejected';
    } else if (action === 'next') {
      const idx = STAGES.indexOf(stage);
      if (idx < 0) {
        stage = STAGES[0];
        status = 'upcoming';
      } else if (idx >= STAGES.length - 1) {
        status = 'completed';
      } else {
        stage = STAGES[idx + 1];
        status = 'upcoming';
      }
    } else {
      return res.status(400).json({ error: 'Invalid action. Use complete, next, or reject.' });
    }

    await runQueryCompat(
      `UPDATE interviews SET stage = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
      `UPDATE interviews SET stage = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4`,
      [stage, status, req.params.id, req.user.id]
    );

    const updated = await fetchInterview(req.params.id, req.user.id);
    res.json({ interview: formatInterview(updated) });
  } catch (error) {
    console.error('Interview progress error:', error);
    res.status(500).json({ error: 'Failed to update progress', details: error.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await getOneCompat(
      'SELECT id FROM interviews WHERE id = ? AND user_id = ?',
      'SELECT id FROM interviews WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    await runQueryCompat(
      'DELETE FROM interviews WHERE id = ? AND user_id = ?',
      'DELETE FROM interviews WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    res.json({ message: 'Interview deleted successfully' });
  } catch (error) {
    console.error('Interview delete error:', error);
    res.status(500).json({ error: 'Failed to delete interview', details: error.message });
  }
});

module.exports = router;
