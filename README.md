# AI Resume Builder

An AI-powered resume/CV builder Chrome extension with a full-stack dashboard. Generate tailored, ATS-friendly resumes from job descriptions using OpenAI GPT.

## Features

### Chrome Extension
- 🔍 **Job Description Scraping** - Automatically extract JD from job posting pages (LinkedIn, Indeed, Glassdoor, etc.)
- ⚡ **Quick CV Generation** - Generate tailored CVs with one click
- 📄 **Multiple Formats** - Download as DOCX or PDF
- 🔐 **Secure Authentication** - Login/register from the extension

### Web Dashboard
- 👤 **Complete Profile Management**
  - Basic info (name, email, phone, address)
  - Employment history with detailed descriptions
  - Education records
  - Certifications
  - Skills with proficiency levels
  
- 📊 **Application History**
  - View all past CV generations
  - Filter by daily/weekly/monthly/custom date range
  - Download generated CVs anytime
  - Track applications over time

- 📈 **Analytics Dashboard**
  - Total applications count
  - Activity timeline charts
  - Top companies applied to
  - Recent applications list

- 👥 **Admin User Management** (Admin only)
  - View all users
  - Manage user roles
  - View all applications across users

### Backend API
- JWT-based authentication
- OpenAI GPT-4 integration for CV content generation
- DOCX and PDF generation
- SQLite database for data persistence
- Cloud storage for generated CVs

## Project Structure

```
ai-resume-builder/
├── backend/                 # Express.js API server
│   ├── src/
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic (OpenAI, CV generation)
│   │   ├── models/         # Database models
│   │   └── middleware/     # Auth middleware
│   └── package.json
├── chrome-extension/        # Chrome extension
│   ├── manifest.json
│   ├── popup.html/js/css   # Extension popup
│   ├── background.js       # Service worker
│   └── content.js/css      # Content scripts
└── dashboard/              # React frontend
    ├── src/
    │   ├── pages/          # Page components
    │   ├── components/     # Shared components
    │   ├── contexts/       # React contexts
    │   └── utils/          # API utilities
    └── package.json
```

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- OpenAI API key

### 1. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env and add your OpenAI API key
# OPENAI_API_KEY=your-key-here

# Start the server
npm run dev
```

Backend runs on http://localhost:3000

### 2. Dashboard Setup

```bash
cd dashboard

# Install dependencies
npm install

# Start development server
npm run dev
```

Dashboard runs on http://localhost:5173

### 3. Chrome Extension Setup

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `chrome-extension` folder
5. The extension icon should appear in your toolbar

### Configuration

By default, the extension connects to:
- API: `http://localhost:3000`
- Dashboard: `http://localhost:5173`

You can change these in the extension settings (gear icon).

## Usage

### Generating a CV

#### From Chrome Extension:
1. Navigate to any job posting page
2. Click the extension icon
3. Login or register if not authenticated
4. Click "Scrape Job Description"
5. Review the extracted JD
6. Click "Generate Tailored CV"
7. Download in DOCX or PDF format

#### From Dashboard:
1. Navigate to "Generate CV" page
2. Paste the job description
3. Optionally add the job posting URL
4. Click "Preview Content" to see the generated CV
5. Click "Generate CV" to create downloadable files

### Setting Up Your Profile

For best results, complete your profile with:
- Full contact information
- Detailed employment history with achievements
- Education background
- Relevant certifications
- Technical and soft skills

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Users
- `GET /api/users/profile` - Get full profile
- `PUT /api/users/profile` - Update basic info
- `POST /api/users/employment` - Add employment
- `POST /api/users/education` - Add education
- `POST /api/users/certifications` - Add certification
- `POST /api/users/skills` - Add skill

### CV Generation
- `POST /api/cv/generate` - Generate CV (creates files)
- `POST /api/cv/preview` - Preview CV content only

### Applications
- `GET /api/applications` - Get user's applications
- `GET /api/applications/stats` - Get statistics

## Tech Stack

- **Backend**: Node.js, Express.js, SQLite3, OpenAI SDK
- **Frontend**: React 18, Vite, TailwindCSS, Chart.js
- **Extension**: Chrome Manifest V3, Service Workers
- **Document Generation**: docx, pdf-lib

## Environment Variables

### Backend (.env)
```env
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key
OPENAI_API_KEY=your-openai-api-key
DATABASE_PATH=./data/resume_builder.db
STORAGE_PATH=./uploads
FRONTEND_URL=http://localhost:5173
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT License
