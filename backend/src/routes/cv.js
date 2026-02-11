const express = require('express');
const { runQuery, getOne, getAll } = require('../models/database');
const { authMiddleware } = require('../middleware/auth');
const { generateCVContent, generateCoverLetter, extractJobDetails } = require('../services/openai');
const { generateDocx, generatePdf, generateCoverLetterDocx, generateCoverLetterPdf } = require('../services/cvGenerator');

const router = express.Router();

// Generate CV and Cover Letter from job description
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { jobDescription, jdLink, jobTitle: providedJobTitle, companyName: providedCompanyName } = req.body;

    if (!jobDescription) {
      return res.status(400).json({ error: 'Job description is required' });
    }

    // Get user profile
    const user = await getOne(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, credly_profile_link 
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    const employmentHistory = await getAll(
      `SELECT * 
      FROM employment_history 
      WHERE user_id = ? 
      ORDER BY 
        CASE 
          WHEN end_date IS NULL OR end_date = "" OR LOWER(end_date) = "present" THEN 0 
          ELSE 1 
        END, 
        -- Convert 'MMM YYYY' to 'YYYY-MM-DD' format for sorting
        strftime('%Y-%m-%d', 
          CASE 
            WHEN LENGTH(start_date) = 7 THEN 
              -- Format like "Apr 2025", prepend "01-" to make it a valid date string
              '01-' || start_date
            ELSE 
              start_date
          END
        ) DESC`,
      [req.user.id]
    );



    const education = await getAll(
      'SELECT * FROM education WHERE user_id = ? ORDER BY graduation_date DESC',
      [req.user.id]
    );

    const certifications = await getAll(
      'SELECT * FROM certifications WHERE user_id = ?',
      [req.user.id]
    );

    const additionalInfo = await getAll(
      'SELECT * FROM additional_info WHERE user_id = ?',
      [req.user.id]
    );

    const tags = await getAll(
      'SELECT * FROM user_tags WHERE user_id = ?',
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
      jobTitle = providedJobTitle && providedJobTitle !== 'Unknown Position' ? providedJobTitle : extractedDetails.jobTitle;
      companyName = providedCompanyName && providedCompanyName !== 'Unknown Company' ? providedCompanyName : extractedDetails.companyName;
    }

    // Generate CV content and cover letter using OpenAI
    const [cvContent, coverLetterContent] = await Promise.all([
      generateCVContent(userProfile, jobDescription),
      generateCoverLetter(userProfile, jobDescription, jobTitle, companyName)
    ]);

    // Generate file names based on user name
    const resumeFilename = `${user.full_name}_Resume`;
    const coverLetterFilename = `${user.full_name}_Cover Letter`;

    // Options for document generation (credly link and tags)
    const docOptions = {
      credlyProfileLink: user.credly_profile_link || null,
      tags: tags.map(t => t.tag)
    };

    // Generate DOCX and PDF for both resume and cover letter
    const [docxResult, pdfResult, coverLetterDocxResult, coverLetterPdfResult] = await Promise.all([
      generateDocx(cvContent, user, resumeFilename, docOptions),
      generatePdf(cvContent, user, resumeFilename, docOptions),
      generateCoverLetterDocx(coverLetterContent, user, coverLetterFilename),
      generateCoverLetterPdf(coverLetterContent, user, coverLetterFilename)
    ]);

    // Save application record
    const result = await runQuery(
      `INSERT INTO applications (user_id, job_title, company_name, jd_link, jd_content, cv_doc_path, cv_pdf_path, cover_letter_doc_path, cover_letter_pdf_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

    const application = await getOne('SELECT * FROM applications WHERE id = ?', [result.lastID]);

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

    // Get user profile
    const user = await getOne(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, credly_profile_link 
       FROM users WHERE id = ?`,
      [req.user.id]
    );

   const employmentHistory = await getAll(
      `SELECT * 
      FROM employment_history 
      WHERE user_id = ? 
      ORDER BY 
        CASE 
          WHEN end_date IS NULL OR end_date = "" OR LOWER(end_date) = "present" THEN 0 
          ELSE 1 
        END, 
        -- Convert 'MMM YYYY' format to 'YYYY-MM-DD' for sorting
        strftime('%Y-%m-%d', 
          CASE 
            WHEN LENGTH(start_date) = 7 THEN 
              -- Format like "Apr 2025"
              '01-' || start_date
            ELSE 
              start_date
          END
        ) DESC`,
      [req.user.id]
    );



    const education = await getAll(
      'SELECT * FROM education WHERE user_id = ? ORDER BY graduation_date DESC',
      [req.user.id]
    );

    const certifications = await getAll(
      'SELECT * FROM certifications WHERE user_id = ?',
      [req.user.id]
    );

    const skills = await getAll(
      'SELECT * FROM skills WHERE user_id = ?',
      [req.user.id]
    );

    const additionalInfo = await getAll(
      'SELECT * FROM additional_info WHERE user_id = ?',
      [req.user.id]
    );

    const tags = await getAll(
      'SELECT * FROM user_tags WHERE user_id = ?',
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

    // Generate CV content using OpenAI
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
    const application = await getOne(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      [req.params.applicationId, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Get user's full name for download filename
    const user = await getOne('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
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
    const application = await getOne(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      [req.params.applicationId, req.user.id]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Get user's full name for download filename
    const user = await getOne('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
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
    const application = await getOne(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      [req.params.applicationId, req.user.id]
    );

    if (!application || !application.cover_letter_doc_path) {
      return res.status(404).json({ error: 'Cover letter not found' });
    }

    // Get user's full name for download filename
    const user = await getOne('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
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
    const application = await getOne(
      'SELECT * FROM applications WHERE id = ? AND user_id = ?',
      [req.params.applicationId, req.user.id]
    );

    if (!application || !application.cover_letter_pdf_path) {
      return res.status(404).json({ error: 'Cover letter not found' });
    }

    // Get user's full name for download filename
    const user = await getOne('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
    const downloadFilename = `${sanitizeDownloadFilename(user.full_name)}_Cover_Letter.pdf`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.redirect(`/uploads/${application.cover_letter_pdf_path}`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

module.exports = router;