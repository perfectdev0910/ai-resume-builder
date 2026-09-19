/**
 * CV Generator with Cloud Storage Support (Supabase/R2).
 * Layout/styling lives in documentRenderer.js; this module only decides where files go.
 */
const { v4: uuidv4 } = require('uuid');
const storage = require('./storage');
const renderer = require('./documentRenderer');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').trim();
}

async function upload(bytes, userInfo, kind, ext, mime) {
  const sanitizedName = sanitizeFilename(userInfo.full_name || 'User');
  const filename = `${sanitizedName}_${kind}_${uuidv4()}.${ext}`;
  const result = await storage.uploadFile(Buffer.from(bytes), filename, mime);
  return { filename: result.filename, url: result.url };
}

async function generateDocx(cvContent, userInfo, customFilename = null, options = {}) {
  return upload(await renderer.buildResumeDocx(cvContent, userInfo, options), userInfo, 'Resume', 'docx', DOCX_MIME);
}

async function generatePdf(cvContent, userInfo, customFilename = null, options = {}) {
  return upload(await renderer.buildResumePdf(cvContent, userInfo, options), userInfo, 'Resume', 'pdf', PDF_MIME);
}

async function generateCoverLetterDocx(coverLetterContent, userInfo, customFilename = null, options = {}) {
  return upload(await renderer.buildCoverLetterDocx(coverLetterContent, userInfo, options), userInfo, 'Cover_Letter', 'docx', DOCX_MIME);
}

async function generateCoverLetterPdf(coverLetterContent, userInfo, customFilename = null, options = {}) {
  return upload(await renderer.buildCoverLetterPdf(coverLetterContent, userInfo, options), userInfo, 'Cover_Letter', 'pdf', PDF_MIME);
}

module.exports = { generateDocx, generatePdf, generateCoverLetterDocx, generateCoverLetterPdf };
