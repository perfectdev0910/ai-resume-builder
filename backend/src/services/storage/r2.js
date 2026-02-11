/**
 * Cloudflare R2 Storage Service
 * Free tier: 10GB storage, 1M Class A ops, 10M Class B ops/month
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const PUBLIC_URL = process.env.R2_PUBLIC_URL; // Your R2 public bucket URL or custom domain

let s3Client = null;

function getClient() {
  if (!s3Client && ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY
      }
    });
  }
  return s3Client;
}

/**
 * Upload file to Cloudflare R2
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Filename to store
 * @param {string} contentType - MIME type
 * @returns {Promise<{filename: string, url: string}>}
 */
async function uploadFile(buffer, filename, contentType) {
  const client = getClient();
  
  if (!client) {
    throw new Error('R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  }

  const key = `uploads/${filename}`;

  // Add metadata with upload timestamp for cleanup
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    Metadata: {
      'upload-date': new Date().toISOString()
    }
  });

  await client.send(command);

  const url = PUBLIC_URL ? `${PUBLIC_URL}/${key}` : key;

  return {
    filename: key,
    url
  };
}

/**
 * Delete file from R2
 * @param {string} filename - File path to delete
 */
async function deleteFile(filename) {
  const client = getClient();
  
  if (!client) {
    console.warn('R2 not configured, skipping delete');
    return;
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filename
    });
    await client.send(command);
  } catch (error) {
    console.error(`R2 delete error: ${error.message}`);
  }
}

/**
 * Get public URL for a file
 * @param {string} filename - File path
 * @returns {string} Public URL
 */
function getFileUrl(filename) {
  if (PUBLIC_URL) {
    return `${PUBLIC_URL}/${filename}`;
  }
  return `/uploads/${filename}`;
}

/**
 * Delete files older than specified days
 * @param {number} days - Delete files older than this many days
 */
async function deleteOldFiles(days = 60) {
  const client = getClient();
  
  if (!client) {
    console.warn('R2 not configured, skipping cleanup');
    return { deleted: 0 };
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  try {
    // List all objects
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'uploads/'
    });

    const response = await client.send(listCommand);
    
    if (!response.Contents || response.Contents.length === 0) {
      return { deleted: 0 };
    }

    // Filter old files based on LastModified
    const oldFiles = response.Contents.filter(obj => {
      return obj.LastModified && new Date(obj.LastModified) < cutoffDate;
    });

    if (oldFiles.length === 0) {
      return { deleted: 0 };
    }

    // Delete old files in batch
    const deleteCommand = new DeleteObjectsCommand({
      Bucket: BUCKET_NAME,
      Delete: {
        Objects: oldFiles.map(f => ({ Key: f.Key }))
      }
    });

    await client.send(deleteCommand);

    console.log(`Cleaned up ${oldFiles.length} files older than ${days} days`);
    return { deleted: oldFiles.length };
  } catch (error) {
    console.error(`R2 cleanup error: ${error.message}`);
    return { deleted: 0, error: error.message };
  }
}

module.exports = {
  uploadFile,
  deleteFile,
  getFileUrl,
  deleteOldFiles
};
