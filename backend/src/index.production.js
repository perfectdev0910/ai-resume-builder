/**
 * Production Server Entry Point
 * Supports both local SQLite and cloud PostgreSQL databases
 * Uses cloud storage (Supabase/R2) for file uploads
 */

require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');

const { isOriginAllowed, isProduction, getFrontendOrigins } = require('./config/env');
const { mountProtectedUploads } = require('./middleware/protectedUploads');

const db = process.env.DATABASE_URL
  ? require('./models/database.postgres')
  : require('./models/database');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const applicationRoutes = require('./routes/applications');
const cvRoutes = require('./routes/cv.production');
const interviewRoutes = require('./routes/interviews');
const { cleanupOldFiles } = require('./jobs/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  ...getFrontendOrigins(),
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin, allowedOrigins)) return callback(null, true);
    console.warn(`CORS rejected origin ${origin} (allowed: ${allowedOrigins.join(', ') || 'none'})`);
    callback(new Error('CORS not allowed'));
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' }
});

const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many generate requests, please try again later' }
});

mountProtectedUploads(app);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/cleanup', async (req, res) => {
  const cleanupSecret = process.env.CLEANUP_SECRET;
  const authHeader = req.headers.authorization;

  if (!cleanupSecret || authHeader !== `Bearer ${cleanupSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await cleanupOldFiles();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Cleanup error:', error.message);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/cv/generate', generateLimiter);
app.use('/api/cv', cvRoutes);
app.use('/api/interviews', interviewRoutes);

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  console.log(`${req.method} ${req.originalUrl}`, {
    origin: req.headers.origin
  });
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    error: isProduction() ? 'Internal server error' : (err.message || 'Internal server error'),
    ...(!isProduction() && { stack: err.stack })
  });
});

async function startServer() {
  try {
    // Fail closed on missing JWT in production
    require('./config/env').getJwtSecret();

    await db.initDatabase();
    if (typeof db.ensureInterviewsTable === 'function') {
      await db.ensureInterviewsTable();
    }
    await db.migrateExistingUsers();
    await db.initAdminAccount();

    if (process.env.ENABLE_CRON_CLEANUP === 'true') {
      cron.schedule('0 2 * * *', async () => {
        console.log('Running scheduled cleanup...');
        try {
          await cleanupOldFiles();
        } catch (err) {
          console.error('Scheduled cleanup failed:', err.message);
        }
      });
      console.log('📅 Cleanup cron job scheduled (daily at 2 AM)');
    }

    app.listen(PORT, () => {
      console.log(`🚀 AI Resume Builder API running on port ${PORT}`);
      console.log(`📦 Storage provider: ${process.env.STORAGE_PROVIDER || 'supabase'}`);
      console.log(`🗄️  Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
