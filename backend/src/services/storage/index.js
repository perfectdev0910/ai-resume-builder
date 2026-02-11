/**
 * Cloud Storage Service
 * Supports: Supabase Storage (default) or Cloudflare R2
 * Set STORAGE_PROVIDER env var to 'supabase' or 'r2'
 */

const supabaseStorage = require('./supabase');
const r2Storage = require('./r2');

const provider = process.env.STORAGE_PROVIDER || 'supabase';

const storageService = provider === 'r2' ? r2Storage : supabaseStorage;

module.exports = {
  uploadFile: storageService.uploadFile,
  deleteFile: storageService.deleteFile,
  getFileUrl: storageService.getFileUrl,
  deleteOldFiles: storageService.deleteOldFiles,
  provider
};
