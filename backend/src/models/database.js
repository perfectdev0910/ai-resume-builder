const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'resume_builder.db');
let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(dbPath);
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
          cv_doc_path TEXT,
          cv_pdf_path TEXT,
          cover_letter_doc_path TEXT,
          cover_letter_pdf_path TEXT,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'generated',
          notes TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Add cover letter columns if they don't exist (for existing databases)
      database.run(`ALTER TABLE applications ADD COLUMN cover_letter_doc_path TEXT`, (err) => {});
      database.run(`ALTER TABLE applications ADD COLUMN cover_letter_pdf_path TEXT`, (err) => {
        if (err && !err.message.includes('duplicate')) reject(err);
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

// Initialize admin account
async function initAdminAccount() {
  try {
    const adminEmail = 'Perfectdev0910@gmail.com';
    const adminPassword = 'Betop2002)(!)';
    
    // Check if admin already exists
    const existingAdmin = await getOne('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (existingAdmin) {
      // Update existing admin to ensure they have admin role and active status
      await runQuery(
        'UPDATE users SET role = ?, status = ? WHERE email = ?',
        ['admin', 'active', adminEmail]
      );
      console.log('Admin account updated');
      return;
    }
    
    // Create admin account
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await runQuery(
      `INSERT INTO users (email, password, full_name, role, status, timezone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [adminEmail, hashedPassword, 'Admin User', 'admin', 'active', 'UTC']
    );
    console.log('Admin account created successfully');
  } catch (error) {
    console.error('Error initializing admin account:', error);
  }
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
