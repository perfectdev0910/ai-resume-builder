/**
 * CV Generator (local filesystem storage).
 * Layout/styling lives in documentRenderer.js; this module only decides where files go.
 */
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const renderer = require('./documentRenderer');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').trim();
}

async function save(bytes, userInfo, kind, ext) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const sanitizedName = sanitizeFilename(userInfo.full_name || 'User');
  const filename = `${sanitizedName}_${kind}_${uuidv4()}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(filepath, bytes);
  return { filename, filepath };
}

async function generateDocx(cvContent, userInfo, customFilename = null, options = {}) {
  return save(await renderer.buildResumeDocx(cvContent, userInfo, options), userInfo, 'Resume', 'docx');
}

async function generatePdf(cvContent, userInfo, customFilename = null, options = {}) {
  return save(await renderer.buildResumePdf(cvContent, userInfo, options), userInfo, 'Resume', 'pdf');
}

async function generateCoverLetterDocx(coverLetterContent, userInfo, customFilename = null, options = {}) {
  return save(await renderer.buildCoverLetterDocx(coverLetterContent, userInfo, options), userInfo, 'Cover_Letter', 'docx');
}

async function generateCoverLetterPdf(coverLetterContent, userInfo, customFilename = null, options = {}) {
  return save(await renderer.buildCoverLetterPdf(coverLetterContent, userInfo, options), userInfo, 'Cover_Letter', 'pdf');
}

module.exports = { generateDocx, generatePdf, generateCoverLetterDocx, generateCoverLetterPdf };
