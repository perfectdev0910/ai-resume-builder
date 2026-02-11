const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { runQuery, getOne, getAll } = require('../models/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

// Helper to delete a file if it exists
async function deleteFileIfExists(filename) {
  if (!filename) return;
  try {
    const filepath = path.join(UPLOAD_DIR, filename);
    await fs.unlink(filepath);
  } catch (err) {
    // File might not exist, ignore error
    if (err.code !== 'ENOENT') {
      console.error(`Failed to delete file ${filename}:`, err);
    }
  }
}

// Check for duplicate application (same company in last 2 weeks)
router.get('/check-duplicate', authMiddleware, async (req, res) => {
  try {
    const { companyName } = req.query;
    
    if (!companyName) {
      return res.json({ isDuplicate: false });
    }

    const result = await getOne(
      `SELECT COUNT(*) as count FROM applications 
       WHERE user_id = ? 
       AND LOWER(company_name) = LOWER(?)
       AND applied_at >= DATE('now', '-14 days')`,
      [req.user.id, companyName]
    );

    res.json({ isDuplicate: result.count > 0 });
  } catch (error) {
    console.error('Duplicate check error:', error);
    res.status(500).json({ error: 'Failed to check for duplicates' });
  }
});

// Get application history with filtering and search
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { period, startDate, endDate, page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;
    
    let dateFilter = '';
    let searchFilter = '';
    const params = [req.user.id];

    if (period) {
      switch (period) {
        case 'daily':
          dateFilter = "AND DATE(applied_at) = DATE('now')";
          break;
        case 'weekly':
          dateFilter = "AND applied_at >= DATE('now', '-7 days')";
          break;
        case 'monthly':
          dateFilter = "AND applied_at >= DATE('now', '-30 days')";
          break;
      }
    } else if (startDate && endDate) {
      dateFilter = 'AND DATE(applied_at) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    // Add search filter for company name
    if (search && search.trim()) {
      searchFilter = 'AND LOWER(company_name) LIKE LOWER(?)';
      params.push(`%${search.trim()}%`);
    }

    // Get total count
    const countResult = await getOne(
      `SELECT COUNT(*) as total FROM applications WHERE user_id = ? ${dateFilter} ${searchFilter}`,
      params
    );

    // Get applications
    const applications = await getAll(
      `SELECT * FROM applications 
       WHERE user_id = ? ${dateFilter} ${searchFilter}
       ORDER BY applied_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    // Get user timezone for formatting
    const user = await getOne('SELECT timezone FROM users WHERE id = ?', [req.user.id]);
    const userTimezone = user?.timezone || 'UTC';

    // Format response
    const formattedApps = applications.map(app => ({
      id: app.id,
      jobTitle: app.job_title,
      companyName: app.company_name,
      jdLink: app.jd_link,
      appliedAt: app.applied_at,
      appliedAtTimezone: userTimezone,
      status: app.status,
      cvDocUrl: app.cv_doc_path ? `/uploads/${app.cv_doc_path}` : null,
      cvPdfUrl: app.cv_pdf_path ? `/uploads/${app.cv_pdf_path}` : null,
      coverLetterDocUrl: app.cover_letter_doc_path ? `/uploads/${app.cover_letter_doc_path}` : null,
      coverLetterPdfUrl: app.cover_letter_pdf_path ? `/uploads/${app.cover_letter_pdf_path}` : null,
      notes: app.notes
    }));

    res.json({
      applications: formattedApps,
      pagination: {
        total: countResult.total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.total / limit)
      },
      userTimezone
    });
  } catch (error) {
    console.error('Applications fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Get application statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await getAll(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN DATE(applied_at) = DATE('now') THEN 1 END) as today,
        COUNT(CASE WHEN applied_at >= DATE('now', '-7 days') THEN 1 END) as thisWeek,
        COUNT(CASE WHEN applied_at >= DATE('now', '-30 days') THEN 1 END) as thisMonth
       FROM applications WHERE user_id = ?`,
      [req.user.id]
    );

    // Get applications by company (top 10)
    const byCompany = await getAll(
      `SELECT company_name, COUNT(*) as count 
       FROM applications 
       WHERE user_id = ? AND company_name IS NOT NULL
       GROUP BY company_name 
       ORDER BY count DESC 
       LIMIT 10`,
      [req.user.id]
    );

    // Get applications over time (last 30 days)
    const timeline = await getAll(
      `SELECT DATE(applied_at) as date, COUNT(*) as count 
       FROM applications 
       WHERE user_id = ? AND applied_at >= DATE('now', '-30 days')
       GROUP BY DATE(applied_at) 
       ORDER BY date`,
      [req.user.id]
    );

    res.json({
      stats: stats[0],
      byCompany,
      timeline
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get single application
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const application = await getOne(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({
      application: {
        id: application.id,
        jobTitle: application.job_title,
        companyName: application.company_name,
        jdLink: application.jd_link,
        jdContent: application.jd_content,
        appliedAt: application.applied_at,
        status: application.status,
        cvDocUrl: application.cv_doc_path ? `/uploads/${application.cv_doc_path}` : null,
        cvPdfUrl: application.cv_pdf_path ? `/uploads/${application.cv_pdf_path}` : null,
        notes: application.notes
      }
    });
  } catch (error) {
    console.error('Application fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

// Update application status/notes
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { status, notes } = req.body;

    await runQuery(
      `UPDATE applications SET 
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
       WHERE id = ? AND user_id = ?`,
      [status, notes, req.params.id, req.user.id]
    );

    res.json({ message: 'Application updated successfully' });
  } catch (error) {
    console.error('Application update error:', error);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// Delete application
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // First, fetch the application to get file paths
    const application = await getOne(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Delete associated files from storage
    await Promise.all([
      deleteFileIfExists(application.cv_doc_path),
      deleteFileIfExists(application.cv_pdf_path),
      deleteFileIfExists(application.cover_letter_doc_path),
      deleteFileIfExists(application.cover_letter_pdf_path)
    ]);

    // Delete the database record
    await runQuery(
      'DELETE FROM applications WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    res.json({ message: 'Application deleted successfully' });
  } catch (error) {
    console.error('Application delete error:', error);
    res.status(500).json({ error: 'Failed to delete application' });
  }
});

// Admin: Get all applications (all users)
router.get('/admin/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const applications = await getAll(
      `SELECT a.*, u.email, u.full_name 
       FROM applications a
       JOIN users u ON a.user_id = u.id
       ORDER BY a.applied_at DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    );

    const countResult = await getOne('SELECT COUNT(*) as total FROM applications');

    res.json({
      applications: applications.map(app => ({
        id: app.id,
        userId: app.user_id,
        userEmail: app.email,
        userName: app.full_name,
        jobTitle: app.job_title,
        companyName: app.company_name,
        jdLink: app.jd_link,
        appliedAt: app.applied_at,
        status: app.status
      })),
      pagination: {
        total: countResult.total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.total / limit)
      }
    });
  } catch (error) {
    console.error('Admin applications fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

module.exports = router;
