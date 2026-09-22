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

    // Interview tracking was removed; drop the leftover table from older deployments.
    await client.query(`DROP TABLE IF EXISTS interviews`);

    // Google Calendar OAuth tokens (one connection per user)
    await client.query(`
      CREATE TABLE IF NOT EXISTS google_calendar_tokens (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        google_email VARCHAR(255),
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        scope TEXT,
        expires_at TIMESTAMPTZ,
        last_synced_at TIMESTAMPTZ,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`ALTER TABLE google_calendar_tokens ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ`);

    // Events synced from Google Calendar, enriched with interview details the user can edit
    await client.query(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        google_calendar_id TEXT NOT NULL,
        google_event_id TEXT NOT NULL,
        calendar_name TEXT,
        color TEXT,
        title TEXT,
        company_name TEXT,
        job_title TEXT,
        stage VARCHAR(50),
        meeting_link TEXT,
        start_at TIMESTAMPTZ,
        end_at TIMESTAMPTZ,
        all_day BOOLEAN DEFAULT FALSE,
        attendees TEXT,
        description TEXT,
        location TEXT,
        html_link TEXT,
        application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
        jd_link TEXT,
        resume_link TEXT,
        notes TEXT,
        outcome VARCHAR(20),
        recording_url TEXT,
        recording_duration_sec INTEGER,
        recorded_at TIMESTAMPTZ,
        transcript TEXT,
        summary TEXT,
        edited_fields TEXT,
        hidden BOOLEAN DEFAULT FALSE,
        synced_at TIMESTAMPTZ,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, google_calendar_id, google_event_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_calendar_events_user_start ON calendar_events(user_id, start_at)`);
    await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS outcome VARCHAR(20)`);
    await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recording_url TEXT`);
    await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recording_duration_sec INTEGER`);
    await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS transcript TEXT`);
    await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS summary TEXT`);
    // Stage set was simplified; fold old values into the new ones
    await client.query(`UPDATE calendar_events SET stage = 'technical_screen' WHERE stage IN ('technical', 'assessment')`);
    await client.query(`UPDATE calendar_events SET stage = 'final' WHERE stage IN ('onsite_final', 'background_check')`);
    await client.query(`UPDATE calendar_events SET stage = 'not_sure' WHERE stage IS NULL OR stage = ''`);

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
  cleanupOldApplications
};