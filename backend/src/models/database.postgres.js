/**
 * PostgreSQL Database Module for Production (Supabase/Neon/Railway)
 * Uses pg library for PostgreSQL connections
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// Generic query helper
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// Helper functions
async function runQuery(sql, params = []) {
  const result = await query(sql, params);
  return result; // return full pg result object permanently
}

async function getOne(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

async function getAll(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
        position VARCHAR(255),
        company VARCHAR(255),
        location VARCHAR(255),
        start_date VARCHAR(50),
        end_date VARCHAR(50),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Backward-compatible columns if old code/data exists
    await client.query(`
      ALTER TABLE employment_history
      ADD COLUMN IF NOT EXISTS position VARCHAR(255)
    `);
    await client.query(`
      ALTER TABLE employment_history
      ADD COLUMN IF NOT EXISTS company VARCHAR(255)
    `);
    await client.query(`
      ALTER TABLE employment_history
      ADD COLUMN IF NOT EXISTS description TEXT
    `);

    // Education table
    await client.query(`
      CREATE TABLE IF NOT EXISTS education (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        institution VARCHAR(255),
        degree VARCHAR(255),
        location VARCHAR(255),
        field_of_study VARCHAR(255),
        graduation_date VARCHAR(50),
        gpa VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE education
      ADD COLUMN IF NOT EXISTS location VARCHAR(255)
    `);

    // Certifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS certifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255),
        issuer VARCHAR(255),
        date_obtained VARCHAR(50),
        issue_date VARCHAR(50),
        expiry_date VARCHAR(50),
        credential_id VARCHAR(255),
        credly_link VARCHAR(255),
        credential_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE certifications
      ADD COLUMN IF NOT EXISTS date_obtained VARCHAR(50)
    `);
    await client.query(`
      ALTER TABLE certifications
      ADD COLUMN IF NOT EXISTS credly_link VARCHAR(255)
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
        category VARCHAR(100),
        content TEXT,
        info_type VARCHAR(100),
        info_value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE additional_info
      ADD COLUMN IF NOT EXISTS category VARCHAR(100)
    `);
    await client.query(`
      ALTER TABLE additional_info
      ADD COLUMN IF NOT EXISTS content TEXT
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
        cv_doc_url VARCHAR(255),
        cv_pdf_url VARCHAR(255),
        cover_letter_doc_url VARCHAR(255),
        cover_letter_pdf_url VARCHAR(255),
        status VARCHAR(50) DEFAULT 'applied',
        notes TEXT,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_applications_applied_at ON applications(applied_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employment_user_id ON employment_history(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_education_user_id ON education(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_certifications_user_id ON certifications(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_additional_info_user_id ON additional_info(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_tags_user_id ON user_tags(user_id)`);

    // Data migrations for old column names -> new ones
    await client.query(`
      UPDATE employment_history
      SET company = company_name
      WHERE company IS NULL AND company_name IS NOT NULL
    `).catch(() => {});

    await client.query(`
      UPDATE employment_history
      SET position = job_title
      WHERE position IS NULL AND job_title IS NOT NULL
    `).catch(() => {});

    await client.query(`
      UPDATE employment_history
      SET description = responsibilities
      WHERE description IS NULL AND responsibilities IS NOT NULL
    `).catch(() => {});

    await client.query(`
      UPDATE certifications
      SET date_obtained = issue_date
      WHERE date_obtained IS NULL AND issue_date IS NOT NULL
    `).catch(() => {});

    await client.query(`
      UPDATE certifications
      SET credly_link = credential_url
      WHERE credly_link IS NULL AND credential_url IS NOT NULL
    `).catch(() => {});

    await client.query(`
      UPDATE additional_info
      SET category = info_type
      WHERE category IS NULL AND info_type IS NOT NULL
    `).catch(() => {});

    await client.query(`
      UPDATE additional_info
      SET content = info_value
      WHERE content IS NULL AND info_value IS NOT NULL
    `).catch(() => {});

    await client.query('COMMIT');
    console.log('✅ PostgreSQL database initialized');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ PostgreSQL init failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Initialize admin account
async function initAdminAccount() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = await getOne(
    'SELECT id FROM users WHERE email = $1',
    [adminEmail]
  );

  if (!existing) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    await runQuery(
      `INSERT INTO users (email, password, full_name, role, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminEmail, hashedPassword, 'Admin', 'admin', 'active']
    );

    console.log('✅ Admin account created');
  }
}

// Migrate existing users
async function migrateExistingUsers() {
  await runQuery(
    `UPDATE users
     SET status = 'active'
     WHERE status IS NULL`
  );
}

// Cleanup old applications and their files
async function cleanupOldApplications(days = 60) {
  const storage = require('../services/storage');

  const oldApps = await getAll(
    `SELECT *
     FROM applications
     WHERE applied_at < NOW() - ($1::text || ' days')::interval`,
    [String(days)]
  );

  for (const app of oldApps) {
    try {
      if (app.cv_doc_url) await storage.deleteFile(app.cv_doc_url);
      if (app.cv_pdf_url) await storage.deleteFile(app.cv_pdf_url);
      if (app.cover_letter_doc_url) await storage.deleteFile(app.cover_letter_doc_url);
      if (app.cover_letter_pdf_url) await storage.deleteFile(app.cover_letter_pdf_url);
    } catch (err) {
      console.error('File cleanup error:', err);
    }
  }

  const result = await runQuery(
    `DELETE FROM applications
     WHERE applied_at < NOW() - ($1::text || ' days')::interval`,
    [String(days)]
  );

  console.log(`🧹 Cleaned up ${result.rowCount || 0} old applications`);
  return { deleted: result.rowCount || 0 };
}

module.exports = {
  pool,
  query,
  runQuery,
  getOne,
  getAll,
  initDatabase,
  initAdminAccount,
  migrateExistingUsers,
  cleanupOldApplications
};