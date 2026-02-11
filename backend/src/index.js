require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const applicationRoutes = require('./routes/applications');
const cvRoutes = require('./routes/cv');
const { initDatabase, initAdminAccount, migrateExistingUsers } = require('./models/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure upload directories exist
const uploadDir = path.join(__dirname, '..', 'uploads');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Middleware
app.use(cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:5173', 'chrome-extension://*'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Helper to sanitize and strip UUID from filename for download
function getCleanDownloadFilename(filename) {
  // Remove UUID pattern (e.g., John_Doe_Resume_a1b2c3d4-e5f6-7890-abcd-ef1234567890.pdf)
  // UUID pattern: 8-4-4-4-12 hex characters
  const uuidPattern = /_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
  return filename.replace(uuidPattern, '');
}

// Static files for CV downloads with Content-Disposition header
app.use('/uploads', (req, res, next) => {
  const filename = path.basename(req.path);
  const cleanFilename = getCleanDownloadFilename(filename);
  res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"`);
  next();
}, express.static(uploadDir));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/cv', cvRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Initialize database and start server
initDatabase().then(async () => {
  // Migrate existing users to active status
  await migrateExistingUsers();
  // Initialize admin account
  await initAdminAccount();
  
  app.listen(PORT, () => {
    console.log(`🚀 AI Resume Builder API running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
