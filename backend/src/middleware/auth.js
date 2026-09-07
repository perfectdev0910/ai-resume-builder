const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/env');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const JWT_SECRET = getJwtSecret();

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

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

function extractBearerOrQueryToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (typeof req.query.access_token === 'string' && req.query.access_token) {
    return req.query.access_token;
  }
  return null;
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractBearerOrQueryToken(req);

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = verifyToken(token);

    const user = await getOneCompat(
      'SELECT id, email, full_name, role, status, timezone FROM users WHERE id = ?',
      'SELECT id, email, full_name, role, status, timezone FROM users WHERE id = $1',
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({
        error: 'Your account is pending admin approval.',
        status: 'pending'
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({
        error: 'Your account has been rejected. Please contact administrator.',
        status: 'rejected'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { generateToken, verifyToken, authMiddleware, adminMiddleware };
