/**
 * PostgreSQL Database Module for Production (Supabase/Neon/Railway)
 * Uses pg library for PostgreSQL connections
 */

const { Pool } = require('pg');


// Database connection (never log DATABASE_URL — it contains credentials)
// Hosted Postgres often needs rejectUnauthorized:false unless you supply a CA.
// Set DATABASE_SSL_REJECT_UNAUTHORIZED=true when you have a proper CA chain.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'disable'
    ? false
    : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' },
  max: 5,
  connectionTimeoutMillis: 10000,
  // Client-side cap so a blocked statement errors out instead of holding a request open forever.
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS) || 30000,
});

// Generic query helper
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } catch (error) {
    // Include the statement so a timeout in the logs points at the exact query.
    console.error(`Query failed: ${error.message} | SQL: ${sql.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
    throw error;
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
   let client;

  try {
    client = await pool.connect();

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS interviews (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
        company_name VARCHAR(255) NOT NULL,
        job_title VARCHAR(255),
        jd_link TEXT,
        resume_label VARCHAR(255),
        stage VARCHAR(50) DEFAULT 'hr_screen',
        status VARCHAR(50) DEFAULT 'upcoming',
        interview_at TIMESTAMPTZ,
        duration_minutes INTEGER DEFAULT 30,
        platform VARCHAR(50) DEFAULT 'google_meet',
        call_link TEXT,
        interviewer TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, company_name)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_interviews_user_id ON interviews(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status)`);

    // Data migrations for old column names -> new ones (outside any txn; ignore missing columns)
    const optionalMigrations = [
      `UPDATE employment_history SET company = company_name WHERE company IS NULL AND company_name IS NOT NULL`,
      `UPDATE employment_history SET position = job_title WHERE position IS NULL AND job_title IS NOT NULL`,
      `UPDATE employment_history SET description = responsibilities WHERE description IS NULL AND responsibilities IS NOT NULL`,
      `UPDATE certifications SET date_obtained = issue_date WHERE date_obtained IS NULL AND issue_date IS NOT NULL`,
      `UPDATE certifications SET credly_link = credential_url WHERE credly_link IS NULL AND credential_url IS NOT NULL`,
      `UPDATE additional_info SET category = info_type WHERE category IS NULL AND info_type IS NOT NULL`,
      `UPDATE additional_info SET content = info_value WHERE content IS NULL AND info_value IS NOT NULL`
    ];
    for (const sql of optionalMigrations) {
      try {
        await client.query(sql);
      } catch {
        // Column may not exist on fresh schemas
      }
    }

    console.log('✅ PostgreSQL database initialized');
  } catch (error) {
    console.error('❌ PostgreSQL init failed:', error);
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function ensureInterviewsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS interviews (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
        company_name VARCHAR(255) NOT NULL,
        job_title VARCHAR(255),
        jd_link TEXT,
        resume_label VARCHAR(255),
        stage VARCHAR(50) DEFAULT 'hr_screen',
        status VARCHAR(50) DEFAULT 'upcoming',
        interview_at TIMESTAMPTZ,
        duration_minutes INTEGER DEFAULT 30,
        platform VARCHAR(50) DEFAULT 'google_meet',
        call_link TEXT,
        interviewer TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, company_name)
      )
    `);
  } catch (error) {
    await query(`
      CREATE TABLE IF NOT EXISTS interviews (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        application_id INTEGER,
        company_name VARCHAR(255) NOT NULL,
        job_title VARCHAR(255),
        jd_link TEXT,
        resume_label VARCHAR(255),
        stage VARCHAR(50) DEFAULT 'hr_screen',
        status VARCHAR(50) DEFAULT 'upcoming',
        interview_at TIMESTAMPTZ,
        duration_minutes INTEGER DEFAULT 30,
        platform VARCHAR(50) DEFAULT 'google_meet',
        call_link TEXT,
        interviewer TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.warn('Interviews table ensured without FK constraints:', error.message);
  }

  // Read existing columns, then add anything missing (works even if IF NOT EXISTS is unavailable)
  let existing = new Set();
  const columnTypes = new Map();
  try {
    const result = await query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'interviews'`
    );
    for (const row of result.rows || []) {
      const name = String(row.column_name).toLowerCase();
      existing.add(name);
      columnTypes.set(name, String(row.data_type || '').toLowerCase());
    }
  } catch (err) {
    console.warn('Could not read interviews columns:', err.message);
  }

  const requiredColumns = [
    ['application_id', 'INTEGER'],
    ['job_title', 'VARCHAR(255)'],
    ['jd_link', 'TEXT'],
    ['resume_label', 'VARCHAR(255)'],
    ['stage', "VARCHAR(50) DEFAULT 'hr_screen'"],
    ['status', "VARCHAR(50) DEFAULT 'upcoming'"],
    ['interview_at', 'TIMESTAMPTZ'],
    ['duration_minutes', 'INTEGER DEFAULT 30'],
    ['platform', "VARCHAR(50) DEFAULT 'google_meet'"],
    ['call_link', 'TEXT'],
    ['interviewer', 'TEXT'],
    ['notes', 'TEXT'],
    ['created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
    ['updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP']
  ];

  for (const [name, definition] of requiredColumns) {
    if (existing.has(name)) continue;
    try {
      await query(`ALTER TABLE interviews ADD COLUMN ${name} ${definition}`);
      console.log(`✅ Added interviews.${name}`);
      existing.add(name);
    } catch (err) {
      // Concurrent migrate / already added
      if (!/already exists/i.test(err.message || '')) {
        console.error(`Failed to add interviews.${name}:`, err.message);
        throw err;
      }
      existing.add(name);
    }
  }

  if (!existing.has('stage')) {
    throw new Error('interviews.stage column is still missing after migration');
  }

  // Older deployments created interview_at as TIMESTAMP (no zone): Postgres drops the 'Z'
  // from ISO input and pg reads it back in the process's local zone. Existing values were
  // written by a UTC process, so reinterpret them as UTC while converting.
  if (columnTypes.get('interview_at') === 'timestamp without time zone') {
    try {
      await query(
        `ALTER TABLE interviews
         ALTER COLUMN interview_at TYPE TIMESTAMPTZ
         USING interview_at AT TIME ZONE 'UTC'`
      );
      console.log('✅ Migrated interviews.interview_at to TIMESTAMPTZ');
    } catch (err) {
      console.error('Failed to migrate interviews.interview_at to TIMESTAMPTZ:', err.message);
      throw err;
    }
  }

  await query(`UPDATE interviews SET stage = 'hr_screen' WHERE stage IS NULL`).catch(() => {});
  await query(`UPDATE interviews SET status = 'upcoming' WHERE status IS NULL`).catch(() => {});
  await query(`UPDATE interviews SET duration_minutes = 30 WHERE duration_minutes IS NULL`).catch(() => {});
  await query(`UPDATE interviews SET platform = 'google_meet' WHERE platform IS NULL`).catch(() => {});

  await query(`CREATE INDEX IF NOT EXISTS idx_interviews_user_id ON interviews(user_id)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status)`).catch(() => {});
}

// Admin bootstrap via env removed — promote a user to admin in the DB or app when needed
async function initAdminAccount() {
  return;
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
  cleanupOldApplications,
  ensureInterviewsTable
};