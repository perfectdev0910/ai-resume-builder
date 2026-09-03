const express = require('express');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const STEPS = new Set(['phone_call', 'hr_call', 'hiring_manager', 'technical', 'onsite', 'offer']);
const STATUSES = new Set(['todo', 'waiting_feedback', 'passed', 'rejected']);

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

function parseTechStack(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function serializeTechStack(value) {
  return JSON.stringify(parseTechStack(value));
}

function formatInterview(row) {
  return {
    id: row.id,
    parentId: row.parent_id || null,
    companyName: row.company_name || '',
    jobTitle: row.job_title || '',
    jdLink: row.jd_link || '',
    techStack: parseTechStack(row.tech_stack),
    applicationId: row.application_id || null,
    resumeLabel: row.resume_label || row.application_resume_label || '',
    resumeDocUrl: row.cv_doc_url || null,
    resumePdfUrl: row.cv_pdf_url || null,
    step: row.step || '',
    interviewDate: row.interview_date || '',
    meetingLink: row.meeting_link || '',
    contact: row.contact || '',
    status: row.status || 'todo',
    notes: row.notes || '',
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    children: []
  };
}

async function fetchInterview(id, userId) {
  return getOneCompat(
    `SELECT i.*, a.cv_doc_url, a.cv_pdf_url,
            CASE WHEN a.id IS NOT NULL THEN COALESCE(a.company_name, '') || ' Resume' ELSE NULL END as application_resume_label
     FROM interviews i
     LEFT JOIN applications a ON i.application_id = a.id
     WHERE i.id = ? AND i.user_id = ?`,
    `SELECT i.*, a.cv_doc_url, a.cv_pdf_url,
            CASE WHEN a.id IS NOT NULL THEN COALESCE(a.company_name, '') || ' Resume' ELSE NULL END as application_resume_label
     FROM interviews i
     LEFT JOIN applications a ON i.application_id = a.id
     WHERE i.id = $1 AND i.user_id = $2`,
    [id, userId]
  );
}

async function insertInterview(userId, fields) {
  const values = [
    userId,
    fields.parentId || null,
    fields.companyName,
    fields.jobTitle || '',
    fields.jdLink || '',
    serializeTechStack(fields.techStack),
    fields.applicationId || null,
    fields.resumeLabel || '',
    fields.step || '',
    fields.interviewDate || '',
    fields.meetingLink || '',
    fields.contact || '',
    fields.status || 'todo',
    fields.notes || '',
    fields.sortOrder || 0
  ];

  if (isPostgres) {
    const result = await runQueryCompat(
      '',
      `INSERT INTO interviews
        (user_id, parent_id, company_name, job_title, jd_link, tech_stack, application_id, resume_label, step, interview_date, meeting_link, contact, status, notes, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      values
    );
    return result.rows?.[0]?.id;
  }

  const result = await runQueryCompat(
    `INSERT INTO interviews
      (user_id, parent_id, company_name, job_title, jd_link, tech_stack, application_id, resume_label, step, interview_date, meeting_link, contact, status, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    '',
    values
  );
  return result.lastID;
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const params = [req.user.id];
    let sqliteSearch = '';
    let postgresSearch = '';

    if (search) {
      const like = `%${search}%`;
      sqliteSearch = `AND (
        LOWER(i.company_name) LIKE LOWER(?)
        OR LOWER(COALESCE(i.job_title, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(i.contact, '')) LIKE LOWER(?)
      )`;
      postgresSearch = `AND (
        LOWER(i.company_name) LIKE LOWER($2)
        OR LOWER(COALESCE(i.job_title, '')) LIKE LOWER($2)
        OR LOWER(COALESCE(i.contact, '')) LIKE LOWER($2)
      )`;
      if (isPostgres) params.push(like);
      else params.push(like, like, like);
    }

    const rows = await getAllCompat(
      `SELECT i.*, a.cv_doc_url, a.cv_pdf_url,
              CASE WHEN a.id IS NOT NULL THEN COALESCE(a.company_name, '') || ' Resume' ELSE NULL END as application_resume_label
       FROM interviews i
       LEFT JOIN applications a ON i.application_id = a.id
       WHERE i.user_id = ? ${sqliteSearch}
       ORDER BY COALESCE(i.parent_id, i.id), CASE WHEN i.parent_id IS NULL THEN 0 ELSE 1 END, i.sort_order, i.id`,
      `SELECT i.*, a.cv_doc_url, a.cv_pdf_url,
              CASE WHEN a.id IS NOT NULL THEN COALESCE(a.company_name, '') || ' Resume' ELSE NULL END as application_resume_label
       FROM interviews i
       LEFT JOIN applications a ON i.application_id = a.id
       WHERE i.user_id = $1 ${postgresSearch}
       ORDER BY COALESCE(i.parent_id, i.id), CASE WHEN i.parent_id IS NULL THEN 0 ELSE 1 END, i.sort_order, i.id`,
      params
    );

    const byId = new Map();
    for (const row of rows) {
      byId.set(row.id, formatInterview(row));
    }

    const tree = [];
    for (const item of byId.values()) {
      if (item.parentId && byId.has(item.parentId)) {
        byId.get(item.parentId).children.push(item);
      } else if (!item.parentId) {
        tree.push(item);
      } else {
        tree.push(item);
      }
    }

    res.json({ interviews: tree });
  } catch (error) {
    console.error('Interviews fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch interviews', details: error.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      parentId,
      companyName,
      jobTitle,
      jdLink,
      techStack,
      applicationId,
      resumeLabel,
      step,
      interviewDate,
      meetingLink,
      contact,
      status,
      notes
    } = req.body;

    let parent = null;
    if (parentId) {
      parent = await getOneCompat(
        'SELECT id, company_name, jd_link, tech_stack, parent_id FROM interviews WHERE id = ? AND user_id = ?',
        'SELECT id, company_name, jd_link, tech_stack, parent_id FROM interviews WHERE id = $1 AND user_id = $2',
        [parentId, req.user.id]
      );
      if (!parent || parent.parent_id) {
        return res.status(400).json({ error: 'Sub-items can only be added under a top-level company' });
      }
    }

    const name = String(companyName || parent?.company_name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    if (step && !STEPS.has(step)) {
      return res.status(400).json({ error: 'Invalid step' });
    }
    if (status && !STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const id = await insertInterview(req.user.id, {
      parentId: parent ? parent.id : null,
      companyName: name,
      jobTitle,
      jdLink: jdLink || parent?.jd_link || '',
      techStack: techStack || parseTechStack(parent?.tech_stack),
      applicationId,
      resumeLabel,
      step,
      interviewDate,
      meetingLink,
      contact,
      status: status || 'todo',
      notes
    });

    const created = await fetchInterview(id, req.user.id);
    res.status(201).json({ interview: formatInterview(created) });
  } catch (error) {
    console.error('Interview create error:', error);
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
      company_name: req.body.companyName ?? existing.company_name,
      job_title: req.body.jobTitle ?? existing.job_title,
      jd_link: req.body.jdLink ?? existing.jd_link,
      tech_stack: req.body.techStack !== undefined ? serializeTechStack(req.body.techStack) : existing.tech_stack,
      application_id: req.body.applicationId !== undefined ? (req.body.applicationId || null) : existing.application_id,
      resume_label: req.body.resumeLabel ?? existing.resume_label,
      step: req.body.step !== undefined ? req.body.step : existing.step,
      interview_date: req.body.interviewDate ?? existing.interview_date,
      meeting_link: req.body.meetingLink ?? existing.meetingLink ?? existing.meeting_link,
      contact: req.body.contact ?? existing.contact,
      status: req.body.status ?? existing.status,
      notes: req.body.notes ?? existing.notes
    };

    if (next.step && !STEPS.has(next.step)) {
      return res.status(400).json({ error: 'Invalid step' });
    }
    if (next.status && !STATUSES.has(next.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (!String(next.company_name || '').trim()) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    await runQueryCompat(
      `UPDATE interviews SET
        company_name = ?, job_title = ?, jd_link = ?, tech_stack = ?, application_id = ?,
        resume_label = ?, step = ?, interview_date = ?, meeting_link = ?, contact = ?,
        status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      `UPDATE interviews SET
        company_name = $1, job_title = $2, jd_link = $3, tech_stack = $4, application_id = $5,
        resume_label = $6, step = $7, interview_date = $8, meeting_link = $9, contact = $10,
        status = $11, notes = $12, updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 AND user_id = $14`,
      [
        next.company_name,
        next.job_title || '',
        next.jd_link || '',
        next.tech_stack,
        next.application_id,
        next.resume_label || '',
        next.step || '',
        next.interview_date || '',
        next.meeting_link || '',
        next.contact || '',
        next.status || 'todo',
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
      'DELETE FROM interviews WHERE parent_id = ? AND user_id = ?',
      'DELETE FROM interviews WHERE parent_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
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
