/**
 * PostgreSQL Database Module for Production (Supabase/Neon/Railway)
 * Uses pg library for PostgreSQL connections
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper functions
async function runQuery(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return {
      lastID: result.rows[0]?.id,
      changes: result.rowCount
    };
  } finally {
    client.release();
  }
}

async function getOne(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function getAll(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        address TEXT,
        phone_number VARCHAR(50),
        linkedin_profile VARCHAR(255),
        github_link VARCHAR(255),
        experience_years INTEGER,
        credly_profile_link VARCHAR(255),
        timezone VARCHAR(100) DEFAULT 'UTC',
        role VARCHAR(20) DEFAULT 'user',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Employment history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employment_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_name VARCHAR(255),
        job_title VARCHAR(255),
        location VARCHAR(255),
        start_date VARCHAR(50),
        end_date VARCHAR(50),
        responsibilities TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Education table
    await client.query(`
      CREATE TABLE IF NOT EXISTS education (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        institution VARCHAR(255),
        degree VARCHAR(255),
        field_of_study VARCHAR(255),
        graduation_date VARCHAR(50),
        gpa VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Certifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS certifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255),
        issuer VARCHAR(255),
        issue_date VARCHAR(50),
        expiry_date VARCHAR(50),
        credential_id VARCHAR(255),
        credential_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Skills table
    await client.query(`
      CREATE TABLE IF NOT EXISTS skills (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        skill_name VARCHAR(255),
        proficiency_level VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Additional info table
    await client.query(`
      CREATE TABLE IF NOT EXISTS additional_info (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        info_type VARCHAR(100),
        info_value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User tags table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_tags (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        tag VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Applications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_title VARCHAR(255),
        company_name VARCHAR(255),
        jd_link TEXT,
        jd_content TEXT,
        cv_doc_path VARCHAR(255),
        cv_pdf_path VARCHAR(255),
        cover_letter_doc_path VARCHAR(255),
        cover_letter_pdf_path VARCHAR(255),
        status VARCHAR(50) DEFAULT 'applied',
        notes TEXT,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_applications_applied_at ON applications(applied_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employment_user_id ON employment_history(user_id)`);

    console.log('✅ PostgreSQL database initialized');
  } finally {
    client.release();
  }
}

// Initialize admin account
async function initAdminAccount() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = await getOne('SELECT id FROM users WHERE email = $1', [adminEmail]);
  
  if (!existing) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await runQuery(
      `INSERT INTO users (email, password, full_name, role, status) VALUES ($1, $2, $3, $4, $5)`,
      [adminEmail, hashedPassword, 'Admin', 'admin', 'active']
    );
    console.log('✅ Admin account created');
  }
}

// Migrate existing users (set status to active if null)
async function migrateExistingUsers() {
  await runQuery(`UPDATE users SET status = 'active' WHERE status IS NULL`);
}

// Cleanup old applications and their files
async function cleanupOldApplications(days = 60) {
  const storage = require('../services/storage');
  
  // Get old applications
  const oldApps = await getAll(
    `SELECT * FROM applications WHERE applied_at < NOW() - INTERVAL '${days} days'`
  );

  // Delete files from storage
  for (const app of oldApps) {
    await storage.deleteFile(app.cv_doc_path);
    await storage.deleteFile(app.cv_pdf_path);
    await storage.deleteFile(app.cover_letter_doc_path);
    await storage.deleteFile(app.cover_letter_pdf_path);
  }

  // Delete database records
  const result = await runQuery(
    `DELETE FROM applications WHERE applied_at < NOW() - INTERVAL '${days} days'`
  );

  console.log(`🧹 Cleaned up ${result.changes} old applications`);
  return { deleted: result.changes };
}

module.exports = {
  pool,
  runQuery,
  getOne,
  getAll,
  initDatabase,
  initAdminAccount,
  migrateExistingUsers,
  cleanupOldApplications
};
