/**
 * Production Server Entry Point
 * Supports both local SQLite and cloud PostgreSQL databases
 * Uses cloud storage (Supabase/R2) for file uploads
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

// Choose database based on environment
const db = process.env.DATABASE_URL 
  ? require('./models/database.postgres') 
  : require('./models/database');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const applicationRoutes = require('./routes/applications');
const cvRoutes = require('./routes/cv');
const { cleanupOldFiles } = require('./jobs/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration for production
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'chrome-extension://*',
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Check if origin matches allowed patterns
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        const pattern = new RegExp(allowed.replace('*', '.*'));
        return pattern.test(origin);
      }
      return allowed === origin;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    storage: process.env.STORAGE_PROVIDER || 'supabase'
  });
});

// Cleanup endpoint (can be triggered by external cron service)
app.post('/api/cleanup', async (req, res) => {
  const authHeader = req.headers.authorization;
  const cleanupSecret = process.env.CLEANUP_SECRET;
  
  // Verify cleanup secret if configured
  if (cleanupSecret && authHeader !== `Bearer ${cleanupSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const result = await cleanupOldFiles();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/cv', cvRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Initialize database and start server
async function startServer() {
  try {
    await db.initDatabase();
    await db.migrateExistingUsers();
    await db.initAdminAccount();
    
    // Schedule cleanup job (runs daily at 2 AM)
    if (process.env.ENABLE_CRON_CLEANUP === 'true') {
      cron.schedule('0 2 * * *', async () => {
        console.log('Running scheduled cleanup...');
        try {
          await cleanupOldFiles();
        } catch (err) {
          console.error('Scheduled cleanup failed:', err);
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
