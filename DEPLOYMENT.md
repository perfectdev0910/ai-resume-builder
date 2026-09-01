# 🚀 AI Resume Builder - Free Deployment Guide

Deploy your AI Resume Builder for **FREE** using:
- **Backend**: Render.com (free tier)
- **Dashboard**: Vercel (free tier)
- **Database**: Supabase PostgreSQL (free tier - 500MB)
- **Storage**: Supabase Storage (free tier - 1GB)
- **Automatic Cleanup**: Files older than 2 months are automatically deleted

## 📋 Prerequisites

1. GitHub account (for code hosting)
2. [Render.com](https://render.com) account
3. [Vercel](https://vercel.com) account
4. [Supabase](https://supabase.com) account
5. [DeepSeek](https://platform.deepseek.com) API key

---

## Step 1: Set Up Supabase (Database + Storage)

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **"New Project"**
3. Enter project details:
   - **Name**: `ai-resume-builder`
   - **Database Password**: (save this securely!)
   - **Region**: Choose closest to your users
4. Click **"Create new project"** and wait for setup (~2 minutes)

### 1.2 Get Database Connection String

1. Go to **Settings** → **Database**
2. Under **Connection string**, select **URI**
3. Copy the connection string (looks like: `postgresql://postgres:[PASSWORD]@...`)
4. Replace `[YOUR-PASSWORD]` with your actual database password

### 1.3 Create Storage Bucket

1. Go to **Storage** in the sidebar
2. Click **"Create a new bucket"**
3. Enter:
   - **Name**: `resumes`
   - **Public bucket**: ✅ Enable (for file downloads)
4. Click **"Create bucket"**

### 1.4 Get API Keys

1. Go to **Settings** → **API**
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **service_role key**: (under "Project API keys" - the secret one)

⚠️ **Important**: Use the `service_role` key (not `anon` key) for backend server access.

---

## Step 2: Deploy Backend to Render

### 2.1 Push Code to GitHub

```bash
# In your ai-resume-builder directory
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/ai-resume-builder.git
git push -u origin main
```

### 2.2 Create Render Web Service

1. Go to [render.com](https://render.com) and sign in
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `ai-resume-builder-api`
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start:production`
   - **Instance Type**: `Free`

### 2.3 Set Environment Variables

In Render dashboard, add these environment variables:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `JWT_SECRET` | (generate: `openssl rand -hex 32`) |
| `DEEPSEEK_API_KEY` | `sk-your-deepseek-key` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` |
| `DATABASE_URL` | (from Supabase Step 1.2) |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | (from Supabase Step 1.4) |
| `SUPABASE_BUCKET` | `resumes` |
| `STORAGE_PROVIDER` | `supabase` |
| `FRONTEND_URL` | (add after Step 3, e.g., `https://your-app.vercel.app`) |
| `ADMIN_EMAIL` | `admin@yourdomain.com` |
| `ADMIN_PASSWORD` | (your secure password) |
| `FILE_RETENTION_DAYS` | `60` |
| `ENABLE_CRON_CLEANUP` | `true` |
| `CLEANUP_SECRET` | (generate: `openssl rand -hex 16`) |

5. Click **"Create Web Service"**
6. Wait for deployment (~5 minutes)
7. Note your API URL: `https://ai-resume-builder-api.onrender.com`

---

## Step 3: Deploy Dashboard to Vercel

### 3.1 Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository
4. Configure:
   - **Root Directory**: `dashboard`
   - **Framework Preset**: `Vite`

### 3.2 Set Environment Variables

Add this environment variable:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://ai-resume-builder-api.onrender.com` |

5. Click **"Deploy"**
6. Note your dashboard URL: `https://your-app.vercel.app`

### 3.3 Update Backend CORS

Go back to Render and update the `FRONTEND_URL` environment variable with your Vercel URL.

---

## Step 4: Configure Chrome Extension

### 4.1 Update Default URLs

Edit `chrome-extension/popup.js`:

```javascript
const DEFAULT_CONFIG = {
  apiUrl: 'https://ai-resume-builder-api.onrender.com',
  dashboardUrl: 'https://your-app.vercel.app'
};
```

### 4.2 Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **"Developer mode"** (top right)
3. Click **"Load unpacked"**
4. Select the `chrome-extension` folder
5. The extension should now appear in your toolbar

### 4.3 (Optional) Publish to Chrome Web Store

1. Create a ZIP of the `chrome-extension` folder
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Pay one-time $5 developer fee
4. Upload your extension

---

## Step 5: Set Up Automatic Cleanup (Optional)

The backend has a built-in cron job that runs daily at 2 AM to delete files older than 2 months.

### Alternative: External Cron Service

If using a free tier that suspends services, use [cron-job.org](https://cron-job.org):

1. Create free account at cron-job.org
2. Create new cron job:
   - **URL**: `https://ai-resume-builder-api.onrender.com/api/cleanup`
   - **Method**: `POST`
   - **Headers**: `Authorization: Bearer YOUR_CLEANUP_SECRET`
   - **Schedule**: Daily at 2:00 AM
3. This keeps your storage clean even when the server sleeps

---

## 🔧 Alternative Storage: Cloudflare R2

If you need more storage (10GB free), use Cloudflare R2:

### Set Up R2

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select **R2** → **Create bucket**
3. Name it `resumes`
4. Go to **R2** → **Manage R2 API Tokens** → **Create API token**
5. Copy Access Key ID and Secret Access Key

### Update Environment Variables

```env
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=resumes
R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
```

---

## 📊 Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Chrome Extension│────▶│  Backend (Render) │────▶│ Supabase/R2     │
└─────────────────┘     │  - Express.js     │     │ - PostgreSQL DB │
                        │  - DeepSeek API   │     │ - File Storage  │
┌─────────────────┐     │  - JWT Auth       │     └─────────────────┘
│ Dashboard       │────▶│  - Cleanup Cron   │
│ (Vercel)        │     └──────────────────┘
└─────────────────┘
```

---

## 🔒 Security Checklist

- [ ] Use strong JWT_SECRET (32+ characters)
- [ ] Use strong ADMIN_PASSWORD
- [ ] Set CLEANUP_SECRET for external cron
- [ ] Enable HTTPS (automatic on Render/Vercel)
- [ ] Set proper CORS (FRONTEND_URL)
- [ ] Use Supabase Row Level Security (optional)

---

## 💰 Cost Summary

| Service | Free Tier Limits | Monthly Cost |
|---------|------------------|--------------|
| Render.com | 750 hours/month, sleeps after 15min inactivity | $0 |
| Vercel | 100GB bandwidth, unlimited sites | $0 |
| Supabase | 500MB DB, 1GB storage, 2GB bandwidth | $0 |
| Cloudflare R2 | 10GB storage, 1M requests | $0 |
| DeepSeek | Pay per use | ~$1-5 |

**Total: ~$1-5/month** (only DeepSeek API costs)

---

## 🐛 Troubleshooting

### Backend not starting
- Check Render logs for errors
- Verify all environment variables are set
- Ensure DATABASE_URL is correct

### CORS errors
- Update FRONTEND_URL in Render
- Clear browser cache
- Check Chrome extension manifest permissions

### Files not uploading
- Verify SUPABASE_SERVICE_KEY (not anon key)
- Check storage bucket is public
- Verify SUPABASE_BUCKET name matches

### Cleanup not running
- Check ENABLE_CRON_CLEANUP is `true`
- For external cron, verify CLEANUP_SECRET header
- Check Render logs for cron execution

---

## 📞 Support

- Create an issue on GitHub
- Check Render/Vercel/Supabase documentation
- DeepSeek platform: https://platform.deepseek.com

---

Happy deploying! 🎉
