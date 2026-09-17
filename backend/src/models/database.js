const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'resume_builder.db');
let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(dbPath);
    db.run('PRAGMA foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  return new Promise((resolve, reject) => {
    const database = getDb();
    
    database.serialize(() => {
      // Users table with status column
      database.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          full_name TEXT NOT NULL,
          address TEXT,
          phone_number TEXT,
          linkedin_profile TEXT,
          github_link TEXT,
          experience_years INTEGER DEFAULT 0,
          timezone TEXT DEFAULT 'UTC',
          role TEXT DEFAULT 'user',
          status TEXT DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add timezone column if it doesn't exist (for existing databases)
      database.run(`ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC'`, (err) => {
        // Ignore error if column already exists
      });

      // Add credly_profile_link column if it doesn't exist (for existing databases)
      database.run(`ALTER TABLE users ADD COLUMN credly_profile_link TEXT`, (err) => {
        // Ignore error if column already exists
      });

      // Add status column if it doesn't exist (for existing databases)
      database.run(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'pending'`, (err) => {
        // Ignore error if column already exists
      });

      // Employment history table
      database.run(`
        CREATE TABLE IF NOT EXISTS employment_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          position TEXT NOT NULL,
          company TEXT NOT NULL,
          location TEXT,
          start_date TEXT,
          end_date TEXT,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Education table
      database.run(`
        CREATE TABLE IF NOT EXISTS education (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          degree TEXT NOT NULL,
          institution TEXT NOT NULL,
          location TEXT,
          graduation_date TEXT,
          gpa TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Certifications table
      database.run(`
        CREATE TABLE IF NOT EXISTS certifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          issuer TEXT,
          date_obtained TEXT,
          expiry_date TEXT,
          credential_id TEXT,
          credly_link TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Add credly_link column if it doesn't exist (for existing databases)
      database.run(`ALTER TABLE certifications ADD COLUMN credly_link TEXT`, (err) => {
        // Ignore error if column already exists
      });

      // Skills table
      database.run(`
        CREATE TABLE IF NOT EXISTS skills (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          skill_name TEXT NOT NULL,
          proficiency_level TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Other/Additional info table
      database.run(`
        CREATE TABLE IF NOT EXISTS additional_info (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // User tags table (plain text tags for "Other" section in resume)
      database.run(`
        CREATE TABLE IF NOT EXISTS user_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          tag TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Applications/Job apply history table
      database.run(`
        CREATE TABLE IF NOT EXISTS applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          job_title TEXT,
          company_name TEXT,
          jd_link TEXT,
          jd_content TEXT,
          cv_doc_url TEXT,
          cv_pdf_url TEXT,
          cover_letter_doc_url TEXT,
          cover_letter_pdf_url TEXT,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'generated',
          notes TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Add cover letter columns if they don't exist (for existing databases)
      database.run(`ALTER TABLE applications ADD COLUMN cover_letter_doc_url TEXT`, (err) => {});
      database.run(`ALTER TABLE applications ADD COLUMN cover_letter_pdf_url TEXT`, (err) => {});

      // Interview tracking was removed; drop the leftover table from older installs.
      database.run(`DROP TABLE IF EXISTS interviews`);

      // Google Calendar OAuth tokens (one connection per user)
      database.run(`
        CREATE TABLE IF NOT EXISTS google_calendar_tokens (
          user_id INTEGER PRIMARY KEY,
          google_email TEXT,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          scope TEXT,
          expires_at DATETIME,
          last_synced_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      database.run(`ALTER TABLE google_calendar_tokens ADD COLUMN last_synced_at DATETIME`, () => {});

      // Events synced from Google Calendar, enriched with interview details the user can edit
      database.run(`
        CREATE TABLE IF NOT EXISTS calendar_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          google_calendar_id TEXT NOT NULL,
          google_event_id TEXT NOT NULL,
          calendar_name TEXT,
          color TEXT,
          title TEXT,
          company_name TEXT,
          job_title TEXT,
          stage TEXT,
          meeting_link TEXT,
          start_at TEXT,
          end_at TEXT,
          all_day INTEGER DEFAULT 0,
          attendees TEXT,
          description TEXT,
          location TEXT,
          html_link TEXT,
          application_id INTEGER,
          jd_link TEXT,
          resume_link TEXT,
          notes TEXT,
          edited_fields TEXT,
          hidden INTEGER DEFAULT 0,
          synced_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
          UNIQUE(user_id, google_calendar_id, google_event_id)
        )
      `);
      // Stage set was simplified; fold old values into the new ones
      database.run(`UPDATE calendar_events SET stage = 'technical_screen' WHERE stage IN ('technical', 'assessment')`, () => {});
      database.run(`UPDATE calendar_events SET stage = 'final' WHERE stage IN ('onsite_final', 'background_check')`, () => {});
      database.run(`UPDATE calendar_events SET stage = 'not_sure' WHERE stage IS NULL OR stage = ''`, () => {});
      database.run(`CREATE INDEX IF NOT EXISTS idx_calendar_events_user_start ON calendar_events(user_id, start_at)`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Admin bootstrap via env removed — promote a user to admin in the DB or app when needed
async function initAdminAccount() {
  return;
}

// Update existing users to have 'active' status if they don't have a status
async function migrateExistingUsers() {
  try {
    await runQuery(
      "UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''"
    );
    console.log('Existing users migrated to active status');
  } catch (error) {
    console.error('Error migrating existing users:', error);
  }
}

module.exports = { getDb, initDatabase, runQuery, getOne, getAll, initAdminAccount, migrateExistingUsers };
