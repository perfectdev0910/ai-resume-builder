const express = require('express');
const bcrypt = require('bcryptjs');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * DB helpers that work with both SQLite and Postgres.
 * Assumptions:
 * - SQLite module exports: runQuery, getOne
 * - Postgres module exports one of:
 *   - query(...)
 *   - pool.query(...)
 *   - runQuery/getOne
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

// Register new user (status: pending - requires admin approval)
router.post('/register', async (req, res) => {
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
      timezone
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
      const insertResult = await runQueryCompat(
        '',
        `INSERT INTO users
          (email, password, full_name, address, phone_number, linkedin_profile, github_link, experience_years, timezone, status)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, email, full_name, role, timezone, status`,
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
          'pending'
        ]
      );

      user = insertResult.rows?.[0] || null;
    } else {
      const insertResult = await runQueryCompat(
        `INSERT INTO users
          (email, password, full_name, address, phone_number, linkedin_profile, github_link, experience_years, timezone, status)
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
          'pending'
        ]
      );

      user = await getOneCompat(
        'SELECT id, email, full_name, role, timezone, status FROM users WHERE id = ?',
        'SELECT id, email, full_name, role, timezone, status FROM users WHERE id = $1',
        [insertResult.lastID]
      );
    }

    if (!user) {
      throw new Error('User was inserted but could not be fetched');
    }

    res.status(201).json({
      message: 'Registration successful. Your account is pending admin approval.',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        status: user.status
      },
      requiresApproval: true
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      details: error.message
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('LOGIN BODY:', { email, password });

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await getOneCompat(
      'SELECT * FROM users WHERE email = ?',
      'SELECT * FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check user status
    if (user.status === 'pending') {
      return res.status(403).json({
        error: 'Your account is pending admin approval. Please wait for approval before signing in.',
        status: 'pending'
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({
        error: 'Your account has been rejected. Please contact administrator.',
        status: 'rejected'
      });
    }

    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        timezone: user.timezone || 'UTC'
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      details: error.message
    });
  }
});

// Get current user profile
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await getOneCompat(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, timezone, created_at
       FROM users WHERE id = ?`,
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, timezone, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    res.json({ user });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({
      error: 'Failed to fetch profile',
      details: error.message
    });
  }
});

// Update password
router.put('/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    const user = await getOneCompat(
      'SELECT password FROM users WHERE id = ?',
      'SELECT password FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await runQueryCompat(
      'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, req.user.id]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({
      error: 'Failed to update password',
      details: error.message
    });
  }
});

module.exports = router;
