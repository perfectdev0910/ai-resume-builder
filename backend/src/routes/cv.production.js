/**
 * CV Routes - Production Version
 * Supports both local filesystem and cloud storage (Supabase/R2)
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { generateCVContent, generateCoverLetter, extractJobDetails } = require('../services/openai');

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

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    console.log('STORAGE_PROVIDER:', process.env.STORAGE_PROVIDER);
    console.log('Using cloud generator:', !!process.env.STORAGE_PROVIDER);

    const { jobDescription, jdLink, jobTitle: providedJobTitle, companyName: providedCompanyName } = req.body;

    if (!jobDescription) {
      return res.status(400).json({ error: 'Job description is required' });
    }

    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';

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
      process.env.DATABASE_URL
        ? `SELECT * FROM employment_history WHERE user_id = $1 
           ORDER BY 
             CASE WHEN end_date IS NULL OR end_date = '' OR LOWER(end_date) = 'present' THEN 0 ELSE 1 END,
             start_date DESC`
        : `SELECT * FROM employment_history WHERE user_id = ? 
           ORDER BY 
             CASE WHEN end_date IS NULL OR end_date = "" OR LOWER(end_date) = "present" THEN 0 ELSE 1 END,
             start_date DESC`,
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

    const tags = await db.getAll(
      `SELECT * FROM user_tags WHERE user_id = ${paramPlaceholder}`,
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

    // ✅ Generate content
    const [cvContent, coverLetterContent] = await Promise.all([
      generateCVContent(userProfile, jobDescription),
      generateCoverLetter(userProfile, jobDescription, jobTitle, companyName)
    ]);

    const resumeFilename = `${user.full_name}_Resume`;
    const coverLetterFilename = `${user.full_name}_Cover Letter`;

    const docOptions = {
      credlyProfileLink: user.credly_profile_link || null,
      tags: tags.map(t => t.tag)
    };

    // ✅ Generate files
    const [docxResult, pdfResult, coverLetterDocxResult, coverLetterPdfResult] = await Promise.all([
      cvGenerator.generateDocx(cvContent, user, resumeFilename, docOptions),
      cvGenerator.generatePdf(cvContent, user, resumeFilename, docOptions),
      cvGenerator.generateCoverLetterDocx(coverLetterContent, user, coverLetterFilename),
      cvGenerator.generateCoverLetterPdf(coverLetterContent, user, coverLetterFilename)
    ]);

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
          docxResult.url,
          pdfResult.url,
          coverLetterDocxResult.url,
          coverLetterPdfResult.url
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
          docxResult.url,
          pdfResult.url,
          coverLetterDocxResult.url,
          coverLetterPdfResult.url
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

    // ✅ Build URLs
    const cvDocUrl = docxResult.url;
    const cvPdfUrl = pdfResult.url;
    const coverLetterDocUrl = coverLetterDocxResult.url;
    const coverLetterPdfUrl = coverLetterPdfResult.url;

    return res.json({
      message: 'Resume and Cover Letter generated successfully',
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
      employmentHistory = await db.getAll(
        `SELECT * FROM employment_history WHERE user_id = $1 ORDER BY start_date DESC`,
        [req.user.id]
      );
    } else {
      employmentHistory = await db.getAll(
        `SELECT * FROM employment_history WHERE user_id = ? ORDER BY start_date DESC`,
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

// Download endpoints for cloud storage - redirect to cloud URLs
router.get('/download/docx/:applicationId', authMiddleware, async (req, res) => {
  try {
    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';
    const param2 = process.env.DATABASE_URL ? '$2' : '?';
    
    const application = await db.getOne(
      `SELECT * FROM applications WHERE id = ${paramPlaceholder} AND user_id = ${param2}`,
      [req.params.applicationId, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // For cloud storage, redirect to the cloud URL
    if (storage) {
      const url = application.cv_doc_url;
      return res.redirect(url);
    }

    // For local storage, serve the file
    const user = await db.getOne(
      `SELECT full_name FROM users WHERE id = ${paramPlaceholder}`, 
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

router.get('/download/pdf/:applicationId', authMiddleware, async (req, res) => {
  try {
    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';
    const param2 = process.env.DATABASE_URL ? '$2' : '?';
    
    const application = await db.getOne(
      `SELECT * FROM applications WHERE id = ${paramPlaceholder} AND user_id = ${param2}`,
      [req.params.applicationId, req.user.id]
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
    
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(`/uploads/${application.cv_pdf_url}`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

router.get('/download/cover-letter/docx/:applicationId', authMiddleware, async (req, res) => {
  try {
    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';
    const param2 = process.env.DATABASE_URL ? '$2' : '?';
    
    const application = await db.getOne(
      `SELECT * FROM applications WHERE id = ${paramPlaceholder} AND user_id = ${param2}`,
      [req.params.applicationId, req.user.id]
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
    
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

router.get('/download/cover-letter/pdf/:applicationId', authMiddleware, async (req, res) => {
  try {
    const paramPlaceholder = process.env.DATABASE_URL ? '$1' : '?';
    const param2 = process.env.DATABASE_URL ? '$2' : '?';
    
    const application = await db.getOne(
      `SELECT * FROM applications WHERE id = ${paramPlaceholder} AND user_id = ${param2}`,
      [req.params.applicationId, req.user.id]
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
    
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(`/uploads/${application.cover_letter_pdf_url}`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

module.exports = router;
