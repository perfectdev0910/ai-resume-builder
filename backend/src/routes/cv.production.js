/**
 * CV Routes - Production Version
 * Supports both local filesystem and cloud storage (Supabase/R2)
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { generateCVContent, generateCoverLetter, extractJobDetails } = require('../services/openai');
const { prettyCompanyName } = require('../utils/companyName');

// Choose database and CV generator based on environment
const db = process.env.DATABASE_URL 
  ? require('../models/database.postgres') 
  : require('../models/database');

// Use cloud storage in production
const cvGenerator = require('../services/cvGenerator.cloud');



const storage = process.env.STORAGE_PROVIDER 
  ? require('../services/storage') 
  : null;

const router = express.Router();

function storedFileValue(result) {
  if (!result) return null;
  return result.url || result.filename || null;
}

function publicFileUrl(result) {
  if (!result) return null;
  if (result.url) return result.url;
  if (result.filename) return `/uploads/${result.filename}`;
  return null;
}

function resolveStoredFile(application, ...keys) {
  for (const key of keys) {
    const stored = application?.[key];
    if (!stored) continue;
    if (/^https?:\/\//i.test(stored)) return stored;
    return `/uploads/${stored.split('/').pop()}`;
  }
  return null;
}

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    console.log('STORAGE_PROVIDER:', process.env.STORAGE_PROVIDER);
    console.log('Using cloud generator:', !!process.env.STORAGE_PROVIDER);

    const { jobDescription, jdLink, jobTitle: providedJobTitle, companyName: rawCompanyName, force } = req.body;
    const providedCompanyName = prettyCompanyName(rawCompanyName);

    if (!jobDescription) {
      return res.status(400).json({ error: 'Job description is required' });
    }

    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';

    if (!force && providedCompanyName) {
      const duplicate = await db.getOne(
        process.env.DATABASE_URL
          ? `SELECT COUNT(*)::int as count FROM applications
             WHERE user_id = $1
             AND LOWER(company_name) = LOWER($2)
             AND applied_at >= NOW() - INTERVAL '30 days'`
          : `SELECT COUNT(*) as count FROM applications
             WHERE user_id = ?
             AND LOWER(company_name) = LOWER(?)
             AND applied_at >= DATE('now', '-30 days')`,
        [req.user.id, providedCompanyName]
      );

      if (Number(duplicate?.count) > 0) {
        return res.status(409).json({
          error: 'You have already applied to this company in the last 30 days.',
          isDuplicate: true
        });
      }
    }

    // ✅ Get user
    const user = await db.getOne(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, credly_profile_link 
       FROM users WHERE id = ${paramPlaceholder}`,
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // ✅ Fetch profile data
    const employmentHistory = await db.getAll(
      `SELECT * 
      FROM employment_history 
      WHERE user_id = $1 
      ORDER BY 
        CASE 
          WHEN end_date IS NULL OR LOWER(end_date) = 'present' THEN 0 
          ELSE 1 
        END,
        CASE 
          WHEN end_date IS NULL OR LOWER(end_date) = 'present' THEN NULL
          ELSE TO_DATE(end_date, 'Mon YYYY')
        END DESC;`,
      [req.user.id]
    );

    const education = await db.getAll(
      `SELECT * FROM education WHERE user_id = ${paramPlaceholder} ORDER BY graduation_date DESC`,
      [req.user.id]
    );

    const certifications = await db.getAll(
      `SELECT * FROM certifications WHERE user_id = ${paramPlaceholder}`,
      [req.user.id]
    );

    const additionalInfo = await db.getAll(
      `SELECT * FROM additional_info WHERE user_id = ${paramPlaceholder}`,
      [req.user.id]
    );

    const skills = await db.getAll(
      `SELECT * FROM skills WHERE user_id = ${paramPlaceholder}`,
      [req.user.id]
    );

    const tags = await db.getAll(
      `SELECT * FROM user_tags WHERE user_id = ${paramPlaceholder}`,
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

    // ✅ Extract job details
    let jobTitle = providedJobTitle;
    let companyName = providedCompanyName;

    if (!jobTitle || !companyName || jobTitle === 'Unknown Position' || companyName === 'Unknown Company') {
      const extractedDetails = await extractJobDetails(jobDescription);
      jobTitle = providedJobTitle && providedJobTitle !== 'Unknown Position'
        ? providedJobTitle
        : extractedDetails.jobTitle;

      companyName = providedCompanyName && providedCompanyName !== 'Unknown Company'
        ? providedCompanyName
        : extractedDetails.companyName;
    }

    if (typeof jobTitle === 'string') jobTitle = jobTitle.trim();
    companyName = prettyCompanyName(companyName);

    if (companyName) {
      const existingCompany = await db.getOne(
        process.env.DATABASE_URL
          ? `SELECT company_name FROM applications
             WHERE user_id = $1 AND LOWER(company_name) = LOWER($2)
             ORDER BY applied_at DESC LIMIT 1`
          : `SELECT company_name FROM applications
             WHERE user_id = ? AND LOWER(company_name) = LOWER(?)
             ORDER BY applied_at DESC LIMIT 1`,
        [req.user.id, companyName]
      );
      if (existingCompany?.company_name) {
        companyName = existingCompany.company_name;
      }
    }

    const [cvOutcome, coverOutcome] = await Promise.allSettled([
      generateCVContent(userProfile, jobDescription),
      generateCoverLetter(userProfile, jobDescription, jobTitle, companyName)
    ]);

    if (cvOutcome.status === 'rejected') {
      throw cvOutcome.reason instanceof Error
        ? cvOutcome.reason
        : new Error('Failed to generate CV content');
    }

    const cvContent = cvOutcome.value;
    const coverLetterContent = coverOutcome.status === 'fulfilled' ? coverOutcome.value : null;
    const coverLetterWarning = coverOutcome.status === 'rejected'
      ? (coverOutcome.reason?.message || 'Cover letter generation failed')
      : null;

    const resumeFilename = `${user.full_name}_Resume`;
    const coverLetterFilename = `${user.full_name}_Cover Letter`;

    const docOptions = {
      credlyProfileLink: user.credly_profile_link || null,
      tags: tags.map(t => t.tag)
    };

    const [docxResult, pdfResult] = await Promise.all([
      cvGenerator.generateDocx(cvContent, user, resumeFilename, docOptions),
      cvGenerator.generatePdf(cvContent, user, resumeFilename, docOptions)
    ]);

    let coverLetterDocxResult = null;
    let coverLetterPdfResult = null;
    if (coverLetterContent) {
      [coverLetterDocxResult, coverLetterPdfResult] = await Promise.all([
        cvGenerator.generateCoverLetterDocx(coverLetterContent, user, coverLetterFilename),
        cvGenerator.generateCoverLetterPdf(coverLetterContent, user, coverLetterFilename)
      ]);
    }

    console.log('PDF RESULT:', pdfResult);

    // 🚨 Ensure cloud upload worked
    if (process.env.STORAGE_PROVIDER) {
      if (!pdfResult?.url || !docxResult?.url) {
        throw new Error('Cloud upload failed: missing file URLs');
      }
    }

    // ✅ Save application
    let result;
    if (process.env.DATABASE_URL) {
      result = await db.runQuery(
        `INSERT INTO applications (user_id, job_title, company_name, jd_link, jd_content, cv_doc_url, cv_pdf_url, cover_letter_doc_url, cover_letter_pdf_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          req.user.id,
          jobTitle,
          companyName,
          jdLink || '',
          jobDescription,
          storedFileValue(docxResult),
          storedFileValue(pdfResult),
          storedFileValue(coverLetterDocxResult),
          storedFileValue(coverLetterPdfResult)
        ]
      );
    } else {
      result = await db.runQuery(
        `INSERT INTO applications (user_id, job_title, company_name, jd_link, jd_content, cv_doc_url, cv_pdf_url, cover_letter_doc_url, cover_letter_pdf_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          jobTitle,
          companyName,
          jdLink || '',
          jobDescription,
          storedFileValue(docxResult),
          storedFileValue(pdfResult),
          storedFileValue(coverLetterDocxResult),
          storedFileValue(coverLetterPdfResult)
        ]
      );
    }

    // ✅ FIXED: Get appId correctly
    let appId;

    if (process.env.DATABASE_URL) {
      appId = result.rows?.[0]?.id;
    } else {
      appId = result.lastID;
    }

    if (!appId) {
      console.error('Insert result:', result);
      throw new Error('Failed to retrieve application ID');
    }

    // ✅ Fetch application
    const application = await db.getOne(
      `SELECT * FROM applications WHERE id = ${paramPlaceholder}`,
      [appId]
    );

    if (!application) {
      throw new Error('Application not found after insert');
    }

    const cvDocUrl = publicFileUrl(docxResult);
    const cvPdfUrl = publicFileUrl(pdfResult);
    const coverLetterDocUrl = publicFileUrl(coverLetterDocxResult);
    const coverLetterPdfUrl = publicFileUrl(coverLetterPdfResult);

    return res.json({
      message: coverLetterWarning
        ? 'Resume generated successfully. Cover letter could not be generated.'
        : 'Resume and Cover Letter generated successfully',
      warning: coverLetterWarning,
      application: {
        id: application.id,
        jobTitle: application.job_title,
        companyName: application.company_name,
        appliedAt: application.applied_at,
        cvDocUrl,
        cvPdfUrl,
        coverLetterDocUrl,
        coverLetterPdfUrl
      },
      cvContent,
      coverLetterContent
    });

  } catch (error) {
    console.error('CV generation error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate documents'
    });
  }
});

// Preview CV content (without saving)
router.post('/preview', authMiddleware, async (req, res) => {
  try {
    const { jobDescription } = req.body;

    if (!jobDescription) {
      return res.status(400).json({ error: 'Job description is required' });
    }

    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';

    const user = await db.getOne(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, credly_profile_link 
       FROM users WHERE id = ${paramPlaceholder}`,
      [req.user.id]
    );

    let employmentHistory;
    if (process.env.DATABASE_URL) {
      // PostgreSQL: Sort by end_date descending, with "Present" first
      // NULLS LAST ensures jobs without end_date (current jobs) come first
      employmentHistory = await db.getAll(
        `SELECT * FROM employment_history WHERE user_id = $1 
         ORDER BY CASE WHEN end_date IS NULL OR end_date = 'Present' THEN 0 ELSE 1 END,
                  CASE WHEN end_date = 'Present' THEN 1 ELSE 0 END DESC,
                  end_date DESC`,
        [req.user.id]
      );
    } else {
      // SQLite: Sort by end_date descending, with "Present" first
      employmentHistory = await db.getAll(
        `SELECT * FROM employment_history WHERE user_id = ? 
         ORDER BY CASE WHEN end_date IS NULL OR end_date = 'Present' THEN 0 ELSE 1 END,
                  CASE WHEN end_date = 'Present' THEN 1 ELSE 0 END DESC,
                  end_date DESC`,
        [req.user.id]
      );
    }

    const education = await db.getAll(
      `SELECT * FROM education WHERE user_id = ${paramPlaceholder} ORDER BY graduation_date DESC`,
      [req.user.id]
    );

    const certifications = await db.getAll(
      `SELECT * FROM certifications WHERE user_id = ${paramPlaceholder}`,
      [req.user.id]
    );

    const skills = await db.getAll(
      `SELECT * FROM skills WHERE user_id = ${paramPlaceholder}`,
      [req.user.id]
    );

    const additionalInfo = await db.getAll(
      `SELECT * FROM additional_info WHERE user_id = ${paramPlaceholder}`,
      [req.user.id]
    );

    const tags = await db.getAll(
      `SELECT * FROM user_tags WHERE user_id = ${paramPlaceholder}`,
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

// Helper function to validate applicationId
function validateApplicationId(applicationId) {
  if (!applicationId || isNaN(parseInt(applicationId))) {
    return null;
  }
  return parseInt(applicationId);
}

// Download endpoints for cloud storage - redirect to cloud URLs
router.get('/download/docx/:applicationId', authMiddleware, async (req, res) => {
  try {
    const applicationId = validateApplicationId(req.params.applicationId);
    if (!applicationId) {
      return res.status(400).json({ error: 'Invalid application ID' });
    }
    
    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';
    const param2 = process.env.DATABASE_URL ? '$2' : '?';
    
    const application = await db.getOne(
      `SELECT * FROM applications WHERE id = ${paramPlaceholder} AND user_id = ${param2}`,
      [applicationId, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // For cloud storage, redirect to the cloud URL
    if (storage) {
      const url = application.cv_doc_url;
      return res.redirect(url);
    }

    const fileUrl = resolveStoredFile(application, 'cv_doc_url', 'cv_doc_path');
    if (!fileUrl) {
      return res.status(404).json({ error: 'Resume file not found' });
    }

    const user = await db.getOne(
      `SELECT full_name FROM users WHERE id = ${paramPlaceholder}`, 
      [req.user.id]
    );
    const downloadFilename = `${sanitizeDownloadFilename(user.full_name)}_Resume.docx`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(fileUrl);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

router.get('/download/pdf/:applicationId', authMiddleware, async (req, res) => {
  try {
    const applicationId = validateApplicationId(req.params.applicationId);
    if (!applicationId) {
      return res.status(400).json({ error: 'Invalid application ID' });
    }
    
    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';
    const param2 = process.env.DATABASE_URL ? '$2' : '?';
    
    const application = await db.getOne(
      `SELECT * FROM applications WHERE id = ${paramPlaceholder} AND user_id = ${param2}`,
      [applicationId, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (storage) {
      const url =application.cv_pdf_url;
      return res.redirect(url);
    }

    const user = await db.getOne(
      `SELECT full_name FROM users WHERE id = ${paramPlaceholder}`, 
      [req.user.id]
    );
    const downloadFilename = `${sanitizeDownloadFilename(user.full_name)}_Resume.pdf`;
    
    const fileUrl = resolveStoredFile(application, 'cv_pdf_url', 'cv_pdf_path');
    if (!fileUrl) {
      return res.status(404).json({ error: 'Resume file not found' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(fileUrl);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

router.get('/download/cover-letter/docx/:applicationId', authMiddleware, async (req, res) => {
  try {
    const applicationId = validateApplicationId(req.params.applicationId);
    if (!applicationId) {
      return res.status(400).json({ error: 'Invalid application ID' });
    }
    
    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';
    const param2 = process.env.DATABASE_URL ? '$2' : '?';
    
    const application = await db.getOne(
      `SELECT * FROM applications WHERE id = ${paramPlaceholder} AND user_id = ${param2}`,
      [applicationId, req.user.id]
    );

    if (!application || !application.cover_letter_doc_url) {
      return res.status(404).json({ error: 'Cover letter not found' });
    }

    if (storage) {
      const url = application.cover_letter_doc_url;
      return res.redirect(url);
    }

    const user = await db.getOne(
      `SELECT full_name FROM users WHERE id = ${paramPlaceholder}`, 
      [req.user.id]
    );
    const downloadFilename = `${sanitizeDownloadFilename(user.full_name)}_Cover_Letter.docx`;
    const fileUrl = resolveStoredFile(application, 'cover_letter_doc_url', 'cover_letter_doc_path');
    if (!fileUrl) {
      return res.status(404).json({ error: 'Cover letter not found' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(fileUrl);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

router.get('/download/cover-letter/pdf/:applicationId', authMiddleware, async (req, res) => {
  try {
    const applicationId = validateApplicationId(req.params.applicationId);
    if (!applicationId) {
      return res.status(400).json({ error: 'Invalid application ID' });
    }
    
    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';
    const param2 = process.env.DATABASE_URL ? '$2' : '?';
    
    const application = await db.getOne(
      `SELECT * FROM applications WHERE id = ${paramPlaceholder} AND user_id = ${param2}`,
      [applicationId, req.user.id]
    );

    if (!application || !application.cover_letter_pdf_url) {
      return res.status(404).json({ error: 'Cover letter not found' });
    }

    if (storage) {
      const url = application.cover_letter_pdf_url;
      return res.redirect(url);
    }

    const user = await db.getOne(
      `SELECT full_name FROM users WHERE id = ${paramPlaceholder}`, 
      [req.user.id]
    );
    const downloadFilename = `${sanitizeDownloadFilename(user.full_name)}_Cover_Letter.pdf`;
    
    const fileUrl = resolveStoredFile(application, 'cover_letter_pdf_url', 'cover_letter_pdf_path');
    if (!fileUrl) {
      return res.status(404).json({ error: 'Cover letter not found' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(fileUrl);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

module.exports = router;