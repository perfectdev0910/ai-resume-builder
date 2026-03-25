const express = require('express');
const bcrypt = require('bcryptjs');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

/* ================= DB HELPERS ================= */

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

/* ================= USER PROFILE ================= */

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await getOneCompat(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, timezone, credly_profile_link, created_at
       FROM users WHERE id = ?`,
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, timezone, credly_profile_link, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    const employmentHistory = await getAllCompat(
      `SELECT *
       FROM employment_history
       WHERE user_id = ?
       ORDER BY
         CASE
           WHEN end_date IS NULL OR end_date = "" OR LOWER(end_date) = "present" THEN 0
           ELSE 1
         END,
         strftime('%Y-%m-%d',
           CASE
             WHEN LENGTH(start_date) = 7 THEN '01-' || start_date
             ELSE start_date
           END
         ) DESC`,
      `SELECT *
       FROM employment_history
       WHERE user_id = $1
       ORDER BY
         CASE
           WHEN end_date IS NULL OR end_date = '' OR LOWER(end_date) = 'present' THEN 0
           ELSE 1
         END,
         start_date DESC`,
      [req.user.id]
    );

    const education = await getAllCompat(
      'SELECT * FROM education WHERE user_id = ? ORDER BY graduation_date DESC',
      'SELECT * FROM education WHERE user_id = $1 ORDER BY graduation_date DESC',
      [req.user.id]
    );

    const certifications = await getAllCompat(
      'SELECT * FROM certifications WHERE user_id = ? ORDER BY created_at DESC',
      'SELECT * FROM certifications WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );

    const skills = await getAllCompat(
      'SELECT * FROM skills WHERE user_id = ?',
      'SELECT * FROM skills WHERE user_id = $1',
      [req.user.id]
    );

    const additionalInfo = await getAllCompat(
      'SELECT * FROM additional_info WHERE user_id = ?',
      'SELECT * FROM additional_info WHERE user_id = $1',
      [req.user.id]
    );

    const tags = await getAllCompat(
      'SELECT * FROM user_tags WHERE user_id = ? ORDER BY created_at DESC',
      'SELECT * FROM user_tags WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );

    res.json({
      user,
      employmentHistory,
      education,
      certifications,
      skills,
      additionalInfo,
      tags
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile', details: error.message });
  }
});

router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const {
      full_name,
      address,
      phone_number,
      linkedin_profile,
      github_link,
      experience_years,
      timezone,
      credly_profile_link
    } = req.body;

    await runQueryCompat(
      `UPDATE users SET
        full_name = COALESCE(?, full_name),
        address = COALESCE(?, address),
        phone_number = COALESCE(?, phone_number),
        linkedin_profile = COALESCE(?, linkedin_profile),
        github_link = COALESCE(?, github_link),
        experience_years = COALESCE(?, experience_years),
        timezone = COALESCE(?, timezone),
        credly_profile_link = COALESCE(?, credly_profile_link),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      `UPDATE users SET
        full_name = COALESCE($1, full_name),
        address = COALESCE($2, address),
        phone_number = COALESCE($3, phone_number),
        linkedin_profile = COALESCE($4, linkedin_profile),
        github_link = COALESCE($5, github_link),
        experience_years = COALESCE($6, experience_years),
        timezone = COALESCE($7, timezone),
        credly_profile_link = COALESCE($8, credly_profile_link),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [
        full_name ?? null,
        address ?? null,
        phone_number ?? null,
        linkedin_profile ?? null,
        github_link ?? null,
        experience_years ?? null,
        timezone ?? null,
        credly_profile_link ?? null,
        req.user.id
      ]
    );

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile', details: error.message });
  }
});

/* ================= EMPLOYMENT ================= */

router.post('/employment', authMiddleware, async (req, res) => {
  try {
    const { position, company, location, start_date, end_date, description } = req.body;

    if (!position || !company) {
      return res.status(400).json({ error: 'Position and company are required' });
    }

    let employment;

    if (isPostgres) {
      const result = await runQueryCompat(
        '',
        `INSERT INTO employment_history (user_id, position, company, location, start_date, end_date, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.user.id, position, company, location || '', start_date || '', end_date || '', description || '']
      );
      employment = result.rows?.[0];
    } else {
      const result = await runQueryCompat(
        `INSERT INTO employment_history (user_id, position, company, location, start_date, end_date, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        '',
        [req.user.id, position, company, location || '', start_date || '', end_date || '', description || '']
      );
      employment = await getOneCompat(
        'SELECT * FROM employment_history WHERE id = ?',
        'SELECT * FROM employment_history WHERE id = $1',
        [result.lastID]
      );
    }

    res.status(201).json({ employment });
  } catch (error) {
    console.error('Employment add error:', error);
    res.status(500).json({ error: 'Failed to add employment', details: error.message });
  }
});

router.put('/employment/:id', authMiddleware, async (req, res) => {
  try {
    const { position, company, location, start_date, end_date, description } = req.body;

    await runQueryCompat(
      `UPDATE employment_history SET
        position = COALESCE(?, position),
        company = COALESCE(?, company),
        location = COALESCE(?, location),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        description = COALESCE(?, description)
       WHERE id = ? AND user_id = ?`,
      `UPDATE employment_history SET
        position = COALESCE($1, position),
        company = COALESCE($2, company),
        location = COALESCE($3, location),
        start_date = COALESCE($4, start_date),
        end_date = COALESCE($5, end_date),
        description = COALESCE($6, description)
       WHERE id = $7 AND user_id = $8`,
      [
        position ?? null,
        company ?? null,
        location ?? null,
        start_date ?? null,
        end_date ?? null,
        description ?? null,
        req.params.id,
        req.user.id
      ]
    );

    res.json({ message: 'Employment updated successfully' });
  } catch (error) {
    console.error('Employment update error:', error);
    res.status(500).json({ error: 'Failed to update employment', details: error.message });
  }
});

router.delete('/employment/:id', authMiddleware, async (req, res) => {
  try {
    await runQueryCompat(
      'DELETE FROM employment_history WHERE id = ? AND user_id = ?',
      'DELETE FROM employment_history WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Employment deleted successfully' });
  } catch (error) {
    console.error('Employment delete error:', error);
    res.status(500).json({ error: 'Failed to delete employment', details: error.message });
  }
});

/* ================= EDUCATION ================= */

router.post('/education', authMiddleware, async (req, res) => {
  try {
    const { degree, institution, location, graduation_date, gpa } = req.body;

    if (!degree || !institution) {
      return res.status(400).json({ error: 'Degree and institution are required' });
    }

    let education;

    if (isPostgres) {
      const result = await runQueryCompat(
        '',
        `INSERT INTO education (user_id, degree, institution, location, graduation_date, gpa)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [req.user.id, degree, institution, location || '', graduation_date || '', gpa || '']
      );
      education = result.rows?.[0];
    } else {
      const result = await runQueryCompat(
        `INSERT INTO education (user_id, degree, institution, location, graduation_date, gpa)
         VALUES (?, ?, ?, ?, ?, ?)`,
        '',
        [req.user.id, degree, institution, location || '', graduation_date || '', gpa || '']
      );
      education = await getOneCompat(
        'SELECT * FROM education WHERE id = ?',
        'SELECT * FROM education WHERE id = $1',
        [result.lastID]
      );
    }

    res.status(201).json({ education });
  } catch (error) {
    console.error('Education add error:', error);
    res.status(500).json({ error: 'Failed to add education', details: error.message });
  }
});

router.put('/education/:id', authMiddleware, async (req, res) => {
  try {
    const { degree, institution, location, graduation_date, gpa } = req.body;

    await runQueryCompat(
      `UPDATE education SET
        degree = COALESCE(?, degree),
        institution = COALESCE(?, institution),
        location = COALESCE(?, location),
        graduation_date = COALESCE(?, graduation_date),
        gpa = COALESCE(?, gpa)
       WHERE id = ? AND user_id = ?`,
      `UPDATE education SET
        degree = COALESCE($1, degree),
        institution = COALESCE($2, institution),
        location = COALESCE($3, location),
        graduation_date = COALESCE($4, graduation_date),
        gpa = COALESCE($5, gpa)
       WHERE id = $6 AND user_id = $7`,
      [
        degree ?? null,
        institution ?? null,
        location ?? null,
        graduation_date ?? null,
        gpa ?? null,
        req.params.id,
        req.user.id
      ]
    );

    res.json({ message: 'Education updated successfully' });
  } catch (error) {
    console.error('Education update error:', error);
    res.status(500).json({ error: 'Failed to update education', details: error.message });
  }
});

router.delete('/education/:id', authMiddleware, async (req, res) => {
  try {
    await runQueryCompat(
      'DELETE FROM education WHERE id = ? AND user_id = ?',
      'DELETE FROM education WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Education deleted successfully' });
  } catch (error) {
    console.error('Education delete error:', error);
    res.status(500).json({ error: 'Failed to delete education', details: error.message });
  }
});

/* ================= CERTIFICATIONS ================= */

router.post('/certifications', authMiddleware, async (req, res) => {
  try {
    const { name, issuer, created_at, expiry_date, credential_id, credly_link } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Certification name is required' });
    }

    // 🔥 helper to fix Postgres issues
    const clean = (v) => (v === '' || v === undefined ? null : v);

    let certification;

    if (isPostgres) {
      const result = await runQueryCompat(
        '',
        `INSERT INTO certifications 
          (user_id, name, issuer, created_at, expiry_date, credential_id, credly_link)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          req.user.id,
          name,
          clean(issuer),
          clean(created_at),
          clean(expiry_date),
          clean(credential_id),
          clean(credly_link)
        ]
      );

      certification = result.rows?.[0];
    } else {
      const result = await runQueryCompat(
        `INSERT INTO certifications 
          (user_id, name, issuer, created_at, expiry_date, credential_id, credly_link)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        '',
        [
          req.user.id,
          name,
          clean(issuer),
          clean(created_at),
          clean(expiry_date),
          clean(credential_id),
          clean(credly_link)
        ]
      );

      certification = await getOneCompat(
        'SELECT * FROM certifications WHERE id = ?',
        'SELECT * FROM certifications WHERE id = $1',
        [result.lastID]
      );
    }

    res.status(201).json({ certification });

  } catch (error) {
    console.error('Certification add error:', error);
    res.status(500).json({
      error: 'Failed to add certification',
      details: error.message
    });
  }
});

/* ================= SKILLS ================= */

router.post('/skills', authMiddleware, async (req, res) => {
  try {
    const { skill_name, proficiency_level } = req.body;

    if (!skill_name) {
      return res.status(400).json({ error: 'Skill name is required' });
    }

    let skill;

    if (isPostgres) {
      const result = await runQueryCompat(
        '',
        `INSERT INTO skills (user_id, skill_name, proficiency_level)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.user.id, skill_name, proficiency_level || 'intermediate']
      );
      skill = result.rows?.[0];
    } else {
      const result = await runQueryCompat(
        `INSERT INTO skills (user_id, skill_name, proficiency_level)
         VALUES (?, ?, ?)`,
        '',
        [req.user.id, skill_name, proficiency_level || 'intermediate']
      );
      skill = await getOneCompat(
        'SELECT * FROM skills WHERE id = ?',
        'SELECT * FROM skills WHERE id = $1',
        [result.lastID]
      );
    }

    res.status(201).json({ skill });
  } catch (error) {
    console.error('Skill add error:', error);
    res.status(500).json({ error: 'Failed to add skill', details: error.message });
  }
});

router.delete('/skills/:id', authMiddleware, async (req, res) => {
  try {
    await runQueryCompat(
      'DELETE FROM skills WHERE id = ? AND user_id = ?',
      'DELETE FROM skills WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Skill deleted successfully' });
  } catch (error) {
    console.error('Skill delete error:', error);
    res.status(500).json({ error: 'Failed to delete skill', details: error.message });
  }
});

/* ================= ADDITIONAL INFO ================= */

router.post('/additional', authMiddleware, async (req, res) => {
  try {
    const { category, content } = req.body;

    if (!category || !content) {
      return res.status(400).json({ error: 'Category and content are required' });
    }

    let additionalInfo;

    if (isPostgres) {
      const result = await runQueryCompat(
        '',
        `INSERT INTO additional_info (user_id, category, content)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.user.id, category, content]
      );
      additionalInfo = result.rows?.[0];
    } else {
      const result = await runQueryCompat(
        `INSERT INTO additional_info (user_id, category, content)
         VALUES (?, ?, ?)`,
        '',
        [req.user.id, category, content]
      );
      additionalInfo = await getOneCompat(
        'SELECT * FROM additional_info WHERE id = ?',
        'SELECT * FROM additional_info WHERE id = $1',
        [result.lastID]
      );
    }

    res.status(201).json({ additionalInfo });
  } catch (error) {
    console.error('Additional info add error:', error);
    res.status(500).json({ error: 'Failed to add additional info', details: error.message });
  }
});

router.delete('/additional/:id', authMiddleware, async (req, res) => {
  try {
    await runQueryCompat(
      'DELETE FROM additional_info WHERE id = ? AND user_id = ?',
      'DELETE FROM additional_info WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Additional info deleted successfully' });
  } catch (error) {
    console.error('Additional info delete error:', error);
    res.status(500).json({ error: 'Failed to delete additional info', details: error.message });
  }
});

/* ================= TAGS ================= */

router.post('/tags', authMiddleware, async (req, res) => {
  try {
    const { tag } = req.body;

    if (!tag || !tag.trim()) {
      return res.status(400).json({ error: 'Tag is required' });
    }

    let newTag;

    if (isPostgres) {
      const result = await runQueryCompat(
        '',
        `INSERT INTO user_tags (user_id, tag)
         VALUES ($1, $2)
         RETURNING *`,
        [req.user.id, tag.trim()]
      );
      newTag = result.rows?.[0];
    } else {
      const result = await runQueryCompat(
        `INSERT INTO user_tags (user_id, tag)
         VALUES (?, ?)`,
        '',
        [req.user.id, tag.trim()]
      );
      newTag = await getOneCompat(
        'SELECT * FROM user_tags WHERE id = ?',
        'SELECT * FROM user_tags WHERE id = $1',
        [result.lastID]
      );
    }

    res.status(201).json({ tag: newTag });
  } catch (error) {
    console.error('Tag add error:', error);
    res.status(500).json({ error: 'Failed to add tag', details: error.message });
  }
});

router.delete('/tags/:id', authMiddleware, async (req, res) => {
  try {
    await runQueryCompat(
      'DELETE FROM user_tags WHERE id = ? AND user_id = ?',
      'DELETE FROM user_tags WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('Tag delete error:', error);
    res.status(500).json({ error: 'Failed to delete tag', details: error.message });
  }
});

/* ================= ADMIN USERS ================= */

router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await getAllCompat(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, status, created_at
       FROM users ORDER BY created_at DESC`,
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, status, created_at
       FROM users ORDER BY created_at DESC`,
      []
    );
    res.json({ users });
  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
});

router.get('/all/profiles', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await getAllCompat(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, status, timezone, credly_profile_link, created_at
       FROM users ORDER BY created_at DESC`,
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, status, timezone, credly_profile_link, created_at
       FROM users ORDER BY created_at DESC`,
      []
    );

    const profiles = await Promise.all(users.map(async (user) => {
      const employmentHistory = await getAllCompat(
        `SELECT *
         FROM employment_history
         WHERE user_id = ?
         ORDER BY
           CASE
             WHEN end_date IS NULL OR end_date = "" OR LOWER(end_date) = "present" THEN 0
             ELSE 1
           END,
           strftime('%Y-%m-%d',
             CASE
               WHEN LENGTH(start_date) = 7 THEN '01-' || start_date
               ELSE start_date
             END
           ) DESC`,
        `SELECT *
         FROM employment_history
         WHERE user_id = $1
         ORDER BY
           CASE
             WHEN end_date IS NULL OR end_date = '' OR LOWER(end_date) = 'present' THEN 0
             ELSE 1
           END,
           start_date DESC`,
        [user.id]
      );

      const education = await getAllCompat(
        'SELECT * FROM education WHERE user_id = ? ORDER BY graduation_date DESC',
        'SELECT * FROM education WHERE user_id = $1 ORDER BY graduation_date DESC',
        [user.id]
      );

      const certifications = await getAllCompat(
        'SELECT * FROM certifications WHERE user_id = ? ORDER BY created_at DESC',
        'SELECT * FROM certifications WHERE user_id = $1 ORDER BY created_at DESC',
        [user.id]
      );

      const skills = await getAllCompat(
        'SELECT * FROM skills WHERE user_id = ?',
        'SELECT * FROM skills WHERE user_id = $1',
        [user.id]
      );

      const additionalInfo = await getAllCompat(
        'SELECT * FROM additional_info WHERE user_id = ?',
        'SELECT * FROM additional_info WHERE user_id = $1',
        [user.id]
      );

      const tags = await getAllCompat(
        'SELECT * FROM user_tags WHERE user_id = ? ORDER BY created_at DESC',
        'SELECT * FROM user_tags WHERE user_id = $1 ORDER BY created_at DESC',
        [user.id]
      );

      let appCount = 0;

      try {
        const result = await getOneCompat(
          'SELECT COUNT(*) as count FROM applications WHERE user_id = ?',
          'SELECT COUNT(*) as count FROM applications WHERE user_id = $1',
          [user.id]
        );

        appCount = Number(result?.count || 0);
      } catch (err) {
        console.error('App count error:', err);
      }

      return {
        user,
        employmentHistory,
        education,
        certifications,
        skills,
        additionalInfo,
        tags,
        applicationCount: Number(appCount?.count || 0)
      };
    }));

    res.json({ profiles });
  } catch (error) {
    console.error('Profiles fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profiles', details: error.message });
  }
});

router.post('/admin/register', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      email,
      password,
      full_name,
      address,
      phone_number,
      linkedin_profile,
      github_link,
      experience_years,
      timezone,
      role
    } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await getOneCompat(
      'SELECT id FROM users WHERE email = ?',
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let user;

    if (isPostgres) {
      const result = await runQueryCompat(
        '',
        `INSERT INTO users (email, password, full_name, address, phone_number, linkedin_profile, github_link, experience_years, timezone, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, email, full_name, role, timezone, created_at`,
        [
          normalizedEmail,
          hashedPassword,
          full_name,
          address || '',
          phone_number || '',
          linkedin_profile || '',
          github_link || '',
          experience_years || 0,
          timezone || 'UTC',
          role || 'user'
        ]
      );
      user = result.rows?.[0];
    } else {
      const result = await runQueryCompat(
        `INSERT INTO users (email, password, full_name, address, phone_number, linkedin_profile, github_link, experience_years, timezone, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        '',
        [
          normalizedEmail,
          hashedPassword,
          full_name,
          address || '',
          phone_number || '',
          linkedin_profile || '',
          github_link || '',
          experience_years || 0,
          timezone || 'UTC',
          role || 'user'
        ]
      );

      user = await getOneCompat(
        'SELECT id, email, full_name, role, timezone, created_at FROM users WHERE id = ?',
        'SELECT id, email, full_name, role, timezone, created_at FROM users WHERE id = $1',
        [result.lastID]
      );
    }

    res.status(201).json({
      message: 'User registered successfully',
      user
    });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

router.put('/:id/role', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    await runQueryCompat(
      'UPDATE users SET role = ? WHERE id = ?',
      'UPDATE users SET role = $1 WHERE id = $2',
      [role, req.params.id]
    );

    res.json({ message: 'User role updated successfully' });
  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({ error: 'Failed to update role', details: error.message });
  }
});

router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await runQueryCompat(
      'DELETE FROM users WHERE id = ?',
      'DELETE FROM users WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('User delete error:', error);
    res.status(500).json({ error: 'Failed to delete user', details: error.message });
  }
});

router.put('/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await runQueryCompat(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['active', req.params.id]
    );
    res.json({ message: 'User approved successfully' });
  } catch (error) {
    console.error('User approval error:', error);
    res.status(500).json({ error: 'Failed to approve user', details: error.message });
  }
});

router.put('/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await runQueryCompat(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['rejected', req.params.id]
    );
    res.json({ message: 'User rejected' });
  } catch (error) {
    console.error('User rejection error:', error);
    res.status(500).json({ error: 'Failed to reject user', details: error.message });
  }
});

router.put('/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    if (!['pending', 'active', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await runQueryCompat(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, req.params.id]
    );
    res.json({ message: 'User status updated successfully' });
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ error: 'Failed to update status', details: error.message });
  }
});

/* ================= ADMIN STATS ================= */

router.get('/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { period = 'all', userId } = req.query;

    const params = [];
    let sqliteDateFilter = '';
    let postgresDateFilter = '';
    let sqliteUserFilter = '';
    let postgresUserFilter = '';

    const nextParam = () => (isPostgres ? `$${params.length + 1}` : '?');

    if (period === 'daily') {
      sqliteDateFilter = "AND DATE(a.applied_at) = DATE('now')";
      postgresDateFilter = "AND DATE(a.applied_at) = CURRENT_DATE";
    } else if (period === 'weekly') {
      sqliteDateFilter = "AND a.applied_at >= DATE('now', '-7 days')";
      postgresDateFilter = "AND a.applied_at >= NOW() - INTERVAL '7 days'";
    } else if (period === 'monthly') {
      sqliteDateFilter = "AND a.applied_at >= DATE('now', '-30 days')";
      postgresDateFilter = "AND a.applied_at >= NOW() - INTERVAL '30 days'";
    }

    if (userId) {
      sqliteUserFilter = 'AND a.user_id = ?';
      const p = nextParam();
      params.push(userId);
      postgresUserFilter = `AND a.user_id = ${p}`;
    }

    const totalApps = await getOneCompat(
      `SELECT COUNT(*) as count FROM applications a WHERE 1=1 ${sqliteDateFilter} ${sqliteUserFilter}`,
      `SELECT COUNT(*)::int as count FROM applications a WHERE 1=1 ${postgresDateFilter} ${postgresUserFilter}`,
      params
    );

    const dailyStats = await getAllCompat(
      `SELECT DATE(a.applied_at) as date, COUNT(*) as count
       FROM applications a
       WHERE 1=1 ${sqliteDateFilter} ${sqliteUserFilter}
       GROUP BY DATE(a.applied_at)
       ORDER BY date DESC
       LIMIT 30`,
      `SELECT DATE(a.applied_at) as date, COUNT(*)::int as count
       FROM applications a
       WHERE 1=1 ${postgresDateFilter} ${postgresUserFilter}
       GROUP BY DATE(a.applied_at)
       ORDER BY date DESC
       LIMIT 30`,
      params
    );

    const sqliteUserStatsJoinDate = sqliteDateFilter ? `AND ${sqliteDateFilter.substring(4)}` : '';
    const postgresUserStatsJoinDate = postgresDateFilter ? `AND ${postgresDateFilter.substring(4)}` : '';

    const userStats = await getAllCompat(
      `SELECT u.id, u.full_name, u.email, COUNT(a.id) as application_count
       FROM users u
       LEFT JOIN applications a ON u.id = a.user_id ${sqliteUserStatsJoinDate}
       WHERE u.role != 'admin'
       GROUP BY u.id
       ORDER BY application_count DESC`,
      `SELECT u.id, u.full_name, u.email, COUNT(a.id)::int as application_count
       FROM users u
       LEFT JOIN applications a ON u.id = a.user_id ${postgresUserStatsJoinDate}
       WHERE u.role != 'admin'
       GROUP BY u.id, u.full_name, u.email
       ORDER BY application_count DESC`,
      []
    );

    const companyStats = await getAllCompat(
      `SELECT company_name, COUNT(*) as count
       FROM applications a
       WHERE company_name IS NOT NULL AND company_name != '' ${sqliteDateFilter} ${sqliteUserFilter}
       GROUP BY company_name
       ORDER BY count DESC
       LIMIT 10`,
      `SELECT company_name, COUNT(*)::int as count
       FROM applications a
       WHERE company_name IS NOT NULL AND company_name != '' ${postgresDateFilter} ${postgresUserFilter}
       GROUP BY company_name
       ORDER BY count DESC
       LIMIT 10`,
      params
    );

    const hourlyParams = userId ? [userId] : [];
    const hourlyUserFilterSqlite = userId ? 'AND a.user_id = ?' : '';
    const hourlyUserFilterPostgres = userId ? 'AND a.user_id = $1' : '';

    const hourlyStats = await getAllCompat(
      `SELECT strftime('%H', a.applied_at) as hour, COUNT(*) as count
       FROM applications a
       WHERE DATE(a.applied_at) = DATE('now') ${hourlyUserFilterSqlite}
       GROUP BY hour
       ORDER BY hour`,
      `SELECT TO_CHAR(a.applied_at, 'HH24') as hour, COUNT(*)::int as count
       FROM applications a
       WHERE DATE(a.applied_at) = CURRENT_DATE ${hourlyUserFilterPostgres}
       GROUP BY hour
       ORDER BY hour`,
      hourlyParams
    );

    const weeklyParams = userId ? [userId] : [];
    const weeklyUserFilterSqlite = userId ? 'AND a.user_id = ?' : '';
    const weeklyUserFilterPostgres = userId ? 'AND a.user_id = $1' : '';

    const weeklyTrend = await getAllCompat(
      `SELECT strftime('%w', a.applied_at) as day_num,
              CASE strftime('%w', a.applied_at)
                WHEN '0' THEN 'Sun'
                WHEN '1' THEN 'Mon'
                WHEN '2' THEN 'Tue'
                WHEN '3' THEN 'Wed'
                WHEN '4' THEN 'Thu'
                WHEN '5' THEN 'Fri'
                WHEN '6' THEN 'Sat'
              END as day_name,
              COUNT(*) as count
       FROM applications a
       WHERE a.applied_at >= DATE('now', '-7 days') ${weeklyUserFilterSqlite}
       GROUP BY day_num
       ORDER BY day_num`,
      `SELECT EXTRACT(DOW FROM a.applied_at)::int as day_num,
              CASE EXTRACT(DOW FROM a.applied_at)::int
                WHEN 0 THEN 'Sun'
                WHEN 1 THEN 'Mon'
                WHEN 2 THEN 'Tue'
                WHEN 3 THEN 'Wed'
                WHEN 4 THEN 'Thu'
                WHEN 5 THEN 'Fri'
                WHEN 6 THEN 'Sat'
              END as day_name,
              COUNT(*)::int as count
       FROM applications a
       WHERE a.applied_at >= NOW() - INTERVAL '7 days' ${weeklyUserFilterPostgres}
       GROUP BY day_num
       ORDER BY day_num`,
      weeklyParams
    );

    const pendingUsers = await getOneCompat(
      "SELECT COUNT(*) as count FROM users WHERE status = 'pending'",
      "SELECT COUNT(*)::int as count FROM users WHERE status = 'pending'",
      []
    );

    res.json({
      totalApplications: Number(totalApps?.count || 0),
      pendingUsers: Number(pendingUsers?.count || 0),
      dailyStats,
      userStats,
      companyStats,
      hourlyStats,
      weeklyTrend
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics', details: error.message });
  }
});

/* ================= ADMIN APPLICATIONS ================= */

router.get('/admin/applications', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { period = 'all', userId, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const params = [];
    let sqliteDateFilter = '';
    let postgresDateFilter = '';
    let sqliteUserFilter = '';
    let postgresUserFilter = '';

    const nextParam = () => (isPostgres ? `$${params.length + 1}` : '?');

    if (period === 'daily') {
      sqliteDateFilter = "AND DATE(a.applied_at) = DATE('now')";
      postgresDateFilter = "AND DATE(a.applied_at) = CURRENT_DATE";
    } else if (period === 'weekly') {
      sqliteDateFilter = "AND a.applied_at >= DATE('now', '-7 days')";
      postgresDateFilter = "AND a.applied_at >= NOW() - INTERVAL '7 days'";
    } else if (period === 'monthly') {
      sqliteDateFilter = "AND a.applied_at >= DATE('now', '-30 days')";
      postgresDateFilter = "AND a.applied_at >= NOW() - INTERVAL '30 days'";
    }

    if (userId) {
      sqliteUserFilter = 'AND a.user_id = ?';
      const p = nextParam();
      params.push(userId);
      postgresUserFilter = `AND a.user_id = ${p}`;
    }

    let applications;

    if (isPostgres) {
      const listParams = [...params];
      const limitPlaceholder = `$${listParams.length + 1}`;
      listParams.push(limitNum);
      const offsetPlaceholder = `$${listParams.length + 1}`;
      listParams.push(offset);

      applications = await getAllCompat(
        '',
        `SELECT a.*, u.full_name, u.email
         FROM applications a
         JOIN users u ON a.user_id = u.id
         WHERE 1=1 ${postgresDateFilter} ${postgresUserFilter}
         ORDER BY a.applied_at DESC
         LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        listParams
      );
    } else {
      applications = await getAllCompat(
        `SELECT a.*, u.full_name, u.email
         FROM applications a
         JOIN users u ON a.user_id = u.id
         WHERE 1=1 ${sqliteDateFilter} ${sqliteUserFilter}
         ORDER BY a.applied_at DESC
         LIMIT ? OFFSET ?`,
        '',
        [...params, limitNum, offset]
      );
    }

    const totalCount = await getOneCompat(
      `SELECT COUNT(*) as count FROM applications a WHERE 1=1 ${sqliteDateFilter} ${sqliteUserFilter}`,
      `SELECT COUNT(*)::int as count FROM applications a WHERE 1=1 ${postgresDateFilter} ${postgresUserFilter}`,
      params
    );

    res.json({
      applications: applications.map(app => ({
        id: app.id,
        userId: app.user_id,
        userName: app.full_name,
        userEmail: app.email,
        jobTitle: app.job_title,
        companyName: app.company_name,
        appliedAt: app.applied_at,
        status: app.status,
        cvDocUrl: app.cv_doc_url || null,
        cvPdfUrl: app.cv_pdf_url || null
      })),
      total: Number(totalCount?.count || 0),
      page: pageNum,
      totalPages: Math.ceil(Number(totalCount?.count || 0) / limitNum)
    });
  } catch (error) {
    console.error('Applications fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch applications', details: error.message });
  }
});

module.exports = router;