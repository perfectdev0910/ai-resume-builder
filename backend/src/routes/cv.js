const express = require('express');

const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const { authMiddleware } = require('../middleware/auth');
const { generateCVContent, generateCoverLetter, extractJobDetails } = require('../services/openai');
const { generateDocx, generatePdf, generateCoverLetterDocx, generateCoverLetterPdf } = require('../services/cvGenerator');

const router = express.Router();

/**
 * DB helpers compatible with both SQLite and Postgres.
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

async function getAllCompat(sqliteSql, postgresSql, params = []) {
  if (isPostgres) {
    if (typeof db.getAll === 'function') {
      return db.getAll(postgresSql, params);
    }
    if (typeof db.query === 'function') {
      const result = await db.query(postgresSql, params);
      return result.rows || [];
    }
    if (db.pool && typeof db.pool.query === 'function') {
      const result = await db.pool.query(postgresSql, params);
      return result.rows || [];
    }
    throw new Error('Postgres database adapter is missing getAll/query/pool.query');
  }

  if (typeof db.getAll !== 'function') {
    throw new Error('SQLite database adapter is missing getAll');
  }

  return db.getAll(sqliteSql, params);
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

// Generate CV and Cover Letter from job description
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const {
      jobDescription,
      jdLink,
      jobTitle: providedJobTitle,
      companyName: providedCompanyName
    } = req.body;

    if (!jobDescription) {
      return res.status(400).json({ error: 'Job description is required' });
    }

    // Get user profile
    const user = await getOneCompat(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, credly_profile_link
       FROM users WHERE id = ?`,
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, credly_profile_link
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    const employmentHistory = await getAllCompat(
      `SELECT *
       FROM employment_history
       WHERE user_id = ?
       ORDER BY
         CASE
           WHEN end_date IS NULL OR end_date = "" OR LOWER(end_date) = "present" THEN 0
           ELSE 1
         END,
         strftime('%Y-%m-%d',
           CASE
             WHEN LENGTH(start_date) = 7 THEN '01-' || start_date
             ELSE start_date
           END
         ) DESC`,
      `SELECT *
       FROM employment_history
       WHERE user_id = $1
       ORDER BY
         CASE
           WHEN end_date IS NULL OR end_date = '' OR LOWER(end_date) = 'present' THEN 0
           ELSE 1
         END,
         start_date DESC`,
      [req.user.id]
    );

    const education = await getAllCompat(
      'SELECT * FROM education WHERE user_id = ? ORDER BY graduation_date DESC',
      'SELECT * FROM education WHERE user_id = $1 ORDER BY graduation_date DESC',
      [req.user.id]
    );

    const certifications = await getAllCompat(
      'SELECT * FROM certifications WHERE user_id = ?',
      'SELECT * FROM certifications WHERE user_id = $1',
      [req.user.id]
    );

    const additionalInfo = await getAllCompat(
      'SELECT * FROM additional_info WHERE user_id = ?',
      'SELECT * FROM additional_info WHERE user_id = $1',
      [req.user.id]
    );

    const tags = await getAllCompat(
      'SELECT * FROM user_tags WHERE user_id = ?',
      'SELECT * FROM user_tags WHERE user_id = $1',
      [req.user.id]
    );

    const userProfile = {
      user,
      employmentHistory,
      education,
      certifications,
      additionalInfo,
      tags
    };

    // Extract job details if not provided
    let jobTitle = providedJobTitle;
    let companyName = providedCompanyName;

    if (!jobTitle || !companyName || jobTitle === 'Unknown Position' || companyName === 'Unknown Company') {
      const extractedDetails = await extractJobDetails(jobDescription);
      jobTitle =
        providedJobTitle && providedJobTitle !== 'Unknown Position'
          ? providedJobTitle
          : extractedDetails.jobTitle;
      companyName =
        providedCompanyName && providedCompanyName !== 'Unknown Company'
          ? providedCompanyName
          : extractedDetails.companyName;
    }

    // Generate CV content and cover letter using OpenAI
    const [cvContent, coverLetterContent] = await Promise.all([
      generateCVContent(userProfile, jobDescription),
      generateCoverLetter(userProfile, jobDescription, jobTitle, companyName)
    ]);

    // Generate file names based on user name
    const resumeFilename = `${user.full_name}_Resume`;
    const coverLetterFilename = `${user.full_name}_Cover Letter`;

    const docOptions = {
      credlyProfileLink: user.credly_profile_link || null,
      tags: tags.map(t => t.tag)
    };

    const [docxResult, pdfResult, coverLetterDocxResult, coverLetterPdfResult] = await Promise.all([
      generateDocx(cvContent, user, resumeFilename, docOptions),
      generatePdf(cvContent, user, resumeFilename, docOptions),
      generateCoverLetterDocx(coverLetterContent, user, coverLetterFilename),
      generateCoverLetterPdf(coverLetterContent, user, coverLetterFilename)
    ]);

    let application;
    if (isPostgres) {
      const insertResult = await runQueryCompat(
        '',
        `INSERT INTO applications
          (user_id, job_title, company_name, jd_link, jd_content, cv_doc_path, cv_pdf_path, cover_letter_doc_path, cover_letter_pdf_path)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          req.user.id,
          jobTitle,
          companyName,
          jdLink || '',
          jobDescription,
          docxResult.filename,
          pdfResult.filename,
          coverLetterDocxResult.filename,
          coverLetterPdfResult.filename
        ]
      );

      application = insertResult.rows?.[0];
    } else {
      const insertResult = await runQueryCompat(
        `INSERT INTO applications
          (user_id, job_title, company_name, jd_link, jd_content, cv_doc_path, cv_pdf_path, cover_letter_doc_path, cover_letter_pdf_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        '',
        [
          req.user.id,
          jobTitle,
          companyName,
          jdLink || '',
          jobDescription,
          docxResult.filename,
          pdfResult.filename,
          coverLetterDocxResult.filename,
          coverLetterPdfResult.filename
        ]
      );

      application = await getOneCompat(
        'SELECT * FROM applications WHERE id = ?',
        'SELECT * FROM applications WHERE id = $1',
        [insertResult.lastID]
      );
    }

    res.json({
      message: 'Resume and Cover Letter generated successfully',
      application: {
        id: application.id,
        jobTitle: application.job_title,
        companyName: application.company_name,
        appliedAt: application.applied_at,
        cvDocUrl: `/uploads/${docxResult.filename}`,
        cvPdfUrl: `/uploads/${pdfResult.filename}`,
        coverLetterDocUrl: `/uploads/${coverLetterDocxResult.filename}`,
        coverLetterPdfUrl: `/uploads/${coverLetterPdfResult.filename}`
      },
      cvContent,
      coverLetterContent
    });
  } catch (error) {
    console.error('CV generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate documents' });
  }
});

// Preview CV content (without saving)
router.post('/preview', authMiddleware, async (req, res) => {
  try {
    const { jobDescription } = req.body;

    if (!jobDescription) {
      return res.status(400).json({ error: 'Job description is required' });
    }

    const user = await getOneCompat(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, credly_profile_link
       FROM users WHERE id = ?`,
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, credly_profile_link
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    const employmentHistory = await getAllCompat(
      `SELECT *
       FROM employment_history
       WHERE user_id = ?
       ORDER BY
         CASE
           WHEN end_date IS NULL OR end_date = "" OR LOWER(end_date) = "present" THEN 0
           ELSE 1
         END,
         strftime('%Y-%m-%d',
           CASE
             WHEN LENGTH(start_date) = 7 THEN '01-' || start_date
             ELSE start_date
           END
         ) DESC`,
      `SELECT *
       FROM employment_history
       WHERE user_id = $1
       ORDER BY
         CASE
           WHEN end_date IS NULL OR end_date = '' OR LOWER(end_date) = 'present' THEN 0
           ELSE 1
         END,
         start_date DESC`,
      [req.user.id]
    );

    const education = await getAllCompat(
      'SELECT * FROM education WHERE user_id = ? ORDER BY graduation_date DESC',
      'SELECT * FROM education WHERE user_id = $1 ORDER BY graduation_date DESC',
      [req.user.id]
    );

    const certifications = await getAllCompat(
      'SELECT * FROM certifications WHERE user_id = ?',
      'SELECT * FROM certifications WHERE user_id = $1',
      [req.user.id]
    );

    const skills = await getAllCompat(
      'SELECT * FROM skills WHERE user_id = ?',
      'SELECT * FROM skills WHERE user_id = $1',
      [req.user.id]
    );

    const additionalInfo = await getAllCompat(
      'SELECT * FROM additional_info WHERE user_id = ?',
      'SELECT * FROM additional_info WHERE user_id = $1',
      [req.user.id]
    );

    const tags = await getAllCompat(
      'SELECT * FROM user_tags WHERE user_id = ?',
      'SELECT * FROM user_tags WHERE user_id = $1',
      [req.user.id]
    );

    const userProfile = {
      user,
      employmentHistory,
      education,
      certifications,
      skills,
      additionalInfo,
      tags
    };

    const cvContent = await generateCVContent(userProfile, jobDescription);

    res.json({
      message: 'CV preview generated',
      cvContent,
      userInfo: {
        fullName: user.full_name,
        email: user.email,
        phone: user.phone_number,
        address: user.address,
        linkedin: user.linkedin_profile,
        github: user.github_link
      }
    });
  } catch (error) {
    console.error('CV preview error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate preview' });
  }
});

// Helper function to sanitize filename for download
function sanitizeDownloadFilename(name) {
  return name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').trim();
}

// Download CV as DOCX
router.get('/download/docx/:applicationId', authMiddleware, async (req, res) => {
  try {
    const application = await getOneCompat(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      'SELECT * FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.applicationId, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const user = await getOneCompat(
      'SELECT full_name FROM users WHERE id = ?',
      'SELECT full_name FROM users WHERE id = $1',
      [req.user.id]
    );

    const downloadFilename = `${sanitizeDownloadFilename(user.full_name)}_Resume.docx`;

    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(`/uploads/${application.cv_doc_path}`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Download CV as PDF
router.get('/download/pdf/:applicationId', authMiddleware, async (req, res) => {
  try {
    const application = await getOneCompat(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      'SELECT * FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.applicationId, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const user = await getOneCompat(
      'SELECT full_name FROM users WHERE id = ?',
      'SELECT full_name FROM users WHERE id = $1',
      [req.user.id]
    );

    const downloadFilename = `${sanitizeDownloadFilename(user.full_name)}_Resume.pdf`;

    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(`/uploads/${application.cv_pdf_path}`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Download Cover Letter as DOCX
router.get('/download/cover-letter/docx/:applicationId', authMiddleware, async (req, res) => {
  try {
    const application = await getOneCompat(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      'SELECT * FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.applicationId, req.user.id]
    );

    if (!application || !application.cover_letter_doc_path) {
      return res.status(404).json({ error: 'Cover letter not found' });
    }

    const user = await getOneCompat(
      'SELECT full_name FROM users WHERE id = ?',
      'SELECT full_name FROM users WHERE id = $1',
      [req.user.id]
    );

    const downloadFilename = `${sanitizeDownloadFilename(user.full_name)}_Cover_Letter.docx`;

    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(`/uploads/${application.cover_letter_doc_path}`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Download Cover Letter as PDF
router.get('/download/cover-letter/pdf/:applicationId', authMiddleware, async (req, res) => {
  try {
    const application = await getOneCompat(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      'SELECT * FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.applicationId, req.user.id]
    );

    if (!application || !application.cover_letter_pdf_path) {
      return res.status(404).json({ error: 'Cover letter not found' });
    }

    const user = await getOneCompat(
      'SELECT full_name FROM users WHERE id = ?',
      'SELECT full_name FROM users WHERE id = $1',
      [req.user.id]
    );

    const downloadFilename = `${sanitizeDownloadFilename(user.full_name)}_Cover_Letter.pdf`;

    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(`/uploads/${application.cover_letter_pdf_path}`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

module.exports = router;