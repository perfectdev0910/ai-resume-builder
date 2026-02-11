/**
 * Cleanup Job - Deletes files and applications older than 2 months
 * Can be run via cron job or as a serverless function
 */

const RETENTION_DAYS = parseInt(process.env.FILE_RETENTION_DAYS) || 60; // 2 months default

async function cleanupOldFiles() {
  // Dynamically require to support both SQLite and PostgreSQL
  const db = process.env.DATABASE_URL 
    ? require('../models/database.postgres') 
    : require('../models/database');
  const storage = require('../services/storage');

  console.log(`🧹 Starting cleanup of files older than ${RETENTION_DAYS} days...`);
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  
  try {
    // Get old applications from database
    const query = process.env.DATABASE_URL
      ? `SELECT * FROM applications WHERE applied_at < $1`
      : `SELECT * FROM applications WHERE applied_at < ?`;
    
    const oldApplications = await db.getAll(query, [cutoffDate.toISOString()]);

    console.log(`Found ${oldApplications.length} old applications to clean up`);

    let filesDeleted = 0;

    // Delete files from cloud storage
    for (const app of oldApplications) {
      const filesToDelete = [
        app.cv_doc_path,
        app.cv_pdf_path,
        app.cover_letter_doc_path,
        app.cover_letter_pdf_path
      ].filter(Boolean);

      for (const filePath of filesToDelete) {
        try {
          await storage.deleteFile(filePath);
          filesDeleted++;
        } catch (err) {
          console.error(`Failed to delete ${filePath}:`, err.message);
        }
      }
    }

    // Delete old application records from database
    const deleteQuery = process.env.DATABASE_URL
      ? `DELETE FROM applications WHERE applied_at < $1`
      : `DELETE FROM applications WHERE applied_at < ?`;
    
    const result = await db.runQuery(deleteQuery, [cutoffDate.toISOString()]);

    console.log(`✅ Cleanup complete: ${result.changes} applications and ${filesDeleted} files deleted`);

    return {
      applicationsDeleted: result.changes,
      filesDeleted,
      cutoffDate: cutoffDate.toISOString()
    };
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  }
}

// Run as standalone script
if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
  
  cleanupOldFiles()
    .then(result => {
      console.log('Cleanup result:', result);
      process.exit(0);
    })
    .catch(err => {
      console.error('Cleanup error:', err);
      process.exit(1);
    });
}

module.exports = { cleanupOldFiles, RETENTION_DAYS };
