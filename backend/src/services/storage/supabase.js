/**
 * Supabase Storage Service
 * Free tier: 1GB storage, 2GB bandwidth/month
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'resumes';

let supabase = null;

function getClient() {
  if (!supabase && supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

/**
 * Upload file to Supabase Storage
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Filename to store
 * @param {string} contentType - MIME type
 * @returns {Promise<{filename: string, url: string}>}
 */
async function uploadFile(buffer, filename, contentType) {
  const client = getClient();
  
  if (!client) {
    throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
  }

  const filePath = `uploads/${filename}`;
  
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .upload(filePath, buffer, {
      contentType,
      upsert: true
    });

  if (error) {
    throw new Error(`Supabase upload error: ${error.message}`);
  }

  // Get public URL
  const { data: urlData } = client.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  return {
    filename: filePath,
    url: urlData.publicUrl
  };
}

/**
 * Delete file from Supabase Storage
 * @param {string} filename - File path to delete
 */
async function deleteFile(filename) {
  const client = getClient();
  
  if (!client) {
    console.warn('Supabase not configured, skipping delete');
    return;
  }

  const { error } = await client.storage
    .from(BUCKET_NAME)
    .remove([filename]);

  if (error) {
    console.error(`Supabase delete error: ${error.message}`);
  }
}

/**
 * Get public URL for a file
 * @param {string} filename - File path
 * @returns {string} Public URL
 */
function getFileUrl(filename) {
  const client = getClient();
  
  if (!client) {
    return `/uploads/${filename}`;
  }

  const { data } = client.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filename);

  return data.publicUrl;
}

/**
 * Delete files older than specified days
 * @param {number} days - Delete files older than this many days
 */
async function deleteOldFiles(days = 60) {
  const client = getClient();
  
  if (!client) {
    console.warn('Supabase not configured, skipping cleanup');
    return { deleted: 0 };
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // List all files in the bucket
  const { data: files, error } = await client.storage
    .from(BUCKET_NAME)
    .list('uploads', {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'asc' }
    });

  if (error) {
    console.error(`Error listing files: ${error.message}`);
    return { deleted: 0, error: error.message };
  }

  // Filter old files
  const oldFiles = files.filter(file => {
    const fileDate = new Date(file.created_at);
    return fileDate < cutoffDate;
  });

  if (oldFiles.length === 0) {
    return { deleted: 0 };
  }

  // Delete old files
  const filePaths = oldFiles.map(f => `uploads/${f.name}`);
  const { error: deleteError } = await client.storage
    .from(BUCKET_NAME)
    .remove(filePaths);

  if (deleteError) {
    console.error(`Error deleting old files: ${deleteError.message}`);
    return { deleted: 0, error: deleteError.message };
  }

  console.log(`Cleaned up ${oldFiles.length} files older than ${days} days`);
  return { deleted: oldFiles.length };
}

module.exports = {
  uploadFile,
  deleteFile,
  getFileUrl,
  deleteOldFiles
};
