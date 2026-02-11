const express = require('express');
const bcrypt = require('bcryptjs');
const { runQuery, getOne, getAll } = require('../models/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get user profile with all details
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await getOne(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, timezone, credly_profile_link, created_at 
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    const employmentHistory = await getAll(
      `SELECT * 
      FROM employment_history 
      WHERE user_id = ? 
      ORDER BY 
        CASE 
          WHEN end_date IS NULL OR end_date = "" OR LOWER(end_date) = "present" THEN 0 
          ELSE 1 
        END, 
        -- Convert 'MMM YYYY' to 'YYYY-MM-DD' for sorting
        strftime('%Y-%m-%d', 
          CASE 
            WHEN LENGTH(start_date) = 7 THEN 
              -- Format like "Apr 2025"
              '01-' || start_date
            ELSE 
              start_date
          END
        ) DESC`,
      [req.user.id]
    );



    const education = await getAll(
      'SELECT * FROM education WHERE user_id = ? ORDER BY graduation_date DESC',
      [req.user.id]
    );

    const certifications = await getAll(
      'SELECT * FROM certifications WHERE user_id = ? ORDER BY date_obtained DESC',
      [req.user.id]
    );

    const skills = await getAll(
      'SELECT * FROM skills WHERE user_id = ?',
      [req.user.id]
    );

    const additionalInfo = await getAll(
      'SELECT * FROM additional_info WHERE user_id = ?',
      [req.user.id]
    );

    const tags = await getAll(
      'SELECT * FROM user_tags WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    res.json({
      user,
      employmentHistory,
      education,
      certifications,
      skills,
      additionalInfo,
      tags
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user basic info
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const {
      full_name,
      address,
      phone_number,
      linkedin_profile,
      github_link,
      experience_years,
      timezone,
      credly_profile_link
    } = req.body;

    await runQuery(
      `UPDATE users SET 
        full_name = COALESCE(?, full_name),
        address = COALESCE(?, address),
        phone_number = COALESCE(?, phone_number),
        linkedin_profile = COALESCE(?, linkedin_profile),
        github_link = COALESCE(?, github_link),
        experience_years = COALESCE(?, experience_years),
        timezone = COALESCE(?, timezone),
        credly_profile_link = COALESCE(?, credly_profile_link),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [full_name, address, phone_number, linkedin_profile, github_link, experience_years, timezone, credly_profile_link, req.user.id]
    );

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Employment History CRUD
router.post('/employment', authMiddleware, async (req, res) => {
  try {
    const { position, company, location, start_date, end_date, description } = req.body;
    
    if (!position || !company) {
      return res.status(400).json({ error: 'Position and company are required' });
    }

    const result = await runQuery(
      `INSERT INTO employment_history (user_id, position, company, location, start_date, end_date, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, position, company, location || '', start_date || '', end_date || '', description || '']
    );

    const employment = await getOne('SELECT * FROM employment_history WHERE id = ?', [result.lastID]);
    res.status(201).json({ employment });
  } catch (error) {
    console.error('Employment add error:', error);
    res.status(500).json({ error: 'Failed to add employment' });
  }
});

router.put('/employment/:id', authMiddleware, async (req, res) => {
  try {
    const { position, company, location, start_date, end_date, description } = req.body;
    
    await runQuery(
      `UPDATE employment_history SET 
        position = COALESCE(?, position),
        company = COALESCE(?, company),
        location = COALESCE(?, location),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        description = COALESCE(?, description)
       WHERE id = ? AND user_id = ?`,
      [position, company, location, start_date, end_date, description, req.params.id, req.user.id]
    );

    res.json({ message: 'Employment updated successfully' });
  } catch (error) {
    console.error('Employment update error:', error);
    res.status(500).json({ error: 'Failed to update employment' });
  }
});

router.delete('/employment/:id', authMiddleware, async (req, res) => {
  try {
    await runQuery('DELETE FROM employment_history WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Employment deleted successfully' });
  } catch (error) {
    console.error('Employment delete error:', error);
    res.status(500).json({ error: 'Failed to delete employment' });
  }
});

// Education CRUD
router.post('/education', authMiddleware, async (req, res) => {
  try {
    const { degree, institution, location, graduation_date, gpa } = req.body;
    
    if (!degree || !institution) {
      return res.status(400).json({ error: 'Degree and institution are required' });
    }

    const result = await runQuery(
      `INSERT INTO education (user_id, degree, institution, location, graduation_date, gpa)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, degree, institution, location || '', graduation_date || '', gpa || '']
    );

    const edu = await getOne('SELECT * FROM education WHERE id = ?', [result.lastID]);
    res.status(201).json({ education: edu });
  } catch (error) {
    console.error('Education add error:', error);
    res.status(500).json({ error: 'Failed to add education' });
  }
});

router.put('/education/:id', authMiddleware, async (req, res) => {
  try {
    const { degree, institution, location, graduation_date, gpa } = req.body;
    
    await runQuery(
      `UPDATE education SET 
        degree = COALESCE(?, degree),
        institution = COALESCE(?, institution),
        location = COALESCE(?, location),
        graduation_date = COALESCE(?, graduation_date),
        gpa = COALESCE(?, gpa)
       WHERE id = ? AND user_id = ?`,
      [degree, institution, location, graduation_date, gpa, req.params.id, req.user.id]
    );

    res.json({ message: 'Education updated successfully' });
  } catch (error) {
    console.error('Education update error:', error);
    res.status(500).json({ error: 'Failed to update education' });
  }
});

router.delete('/education/:id', authMiddleware, async (req, res) => {
  try {
    await runQuery('DELETE FROM education WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Education deleted successfully' });
  } catch (error) {
    console.error('Education delete error:', error);
    res.status(500).json({ error: 'Failed to delete education' });
  }
});

// Certifications CRUD
router.post('/certifications', authMiddleware, async (req, res) => {
  try {
    const { name, issuer, date_obtained, expiry_date, credential_id, credly_link } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Certification name is required' });
    }

    const result = await runQuery(
      `INSERT INTO certifications (user_id, name, issuer, date_obtained, expiry_date, credential_id, credly_link)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, name, issuer || '', date_obtained || '', expiry_date || '', credential_id || '', credly_link || '']
    );

    const cert = await getOne('SELECT * FROM certifications WHERE id = ?', [result.lastID]);
    res.status(201).json({ certification: cert });
  } catch (error) {
    console.error('Certification add error:', error);
    res.status(500).json({ error: 'Failed to add certification' });
  }
});

router.delete('/certifications/:id', authMiddleware, async (req, res) => {
  try {
    await runQuery('DELETE FROM certifications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Certification deleted successfully' });
  } catch (error) {
    console.error('Certification delete error:', error);
    res.status(500).json({ error: 'Failed to delete certification' });
  }
});

// Skills CRUD
router.post('/skills', authMiddleware, async (req, res) => {
  try {
    const { skill_name, proficiency_level } = req.body;
    
    if (!skill_name) {
      return res.status(400).json({ error: 'Skill name is required' });
    }

    const result = await runQuery(
      `INSERT INTO skills (user_id, skill_name, proficiency_level)
       VALUES (?, ?, ?)`,
      [req.user.id, skill_name, proficiency_level || 'intermediate']
    );

    const skill = await getOne('SELECT * FROM skills WHERE id = ?', [result.lastID]);
    res.status(201).json({ skill });
  } catch (error) {
    console.error('Skill add error:', error);
    res.status(500).json({ error: 'Failed to add skill' });
  }
});

router.delete('/skills/:id', authMiddleware, async (req, res) => {
  try {
    await runQuery('DELETE FROM skills WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Skill deleted successfully' });
  } catch (error) {
    console.error('Skill delete error:', error);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

// Additional Info CRUD
router.post('/additional', authMiddleware, async (req, res) => {
  try {
    const { category, content } = req.body;
    
    if (!category || !content) {
      return res.status(400).json({ error: 'Category and content are required' });
    }

    const result = await runQuery(
      `INSERT INTO additional_info (user_id, category, content)
       VALUES (?, ?, ?)`,
      [req.user.id, category, content]
    );

    const info = await getOne('SELECT * FROM additional_info WHERE id = ?', [result.lastID]);
    res.status(201).json({ additionalInfo: info });
  } catch (error) {
    console.error('Additional info add error:', error);
    res.status(500).json({ error: 'Failed to add additional info' });
  }
});

router.delete('/additional/:id', authMiddleware, async (req, res) => {
  try {
    await runQuery('DELETE FROM additional_info WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Additional info deleted successfully' });
  } catch (error) {
    console.error('Additional info delete error:', error);
    res.status(500).json({ error: 'Failed to delete additional info' });
  }
});

// Tags CRUD (plain text tags for "Other" section)
router.post('/tags', authMiddleware, async (req, res) => {
  try {
    const { tag } = req.body;
    
    if (!tag || !tag.trim()) {
      return res.status(400).json({ error: 'Tag is required' });
    }

    const result = await runQuery(
      `INSERT INTO user_tags (user_id, tag)
       VALUES (?, ?)`,
      [req.user.id, tag.trim()]
    );

    const newTag = await getOne('SELECT * FROM user_tags WHERE id = ?', [result.lastID]);
    res.status(201).json({ tag: newTag });
  } catch (error) {
    console.error('Tag add error:', error);
    res.status(500).json({ error: 'Failed to add tag' });
  }
});

router.delete('/tags/:id', authMiddleware, async (req, res) => {
  try {
    await runQuery('DELETE FROM user_tags WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('Tag delete error:', error);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

// Admin: Get all users
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await getAll(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, status, created_at 
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users });
  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Admin: Get all user profiles with full details
router.get('/all/profiles', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await getAll(
      `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, role, status, timezone, credly_profile_link, created_at 
       FROM users ORDER BY created_at DESC`
    );

    // Fetch full profile details for each user
    const profiles = await Promise.all(users.map(async (user) => {
      const employmentHistory = await getAll(
        `SELECT * 
        FROM employment_history 
        WHERE user_id = ? 
        ORDER BY 
          CASE 
            WHEN end_date IS NULL OR end_date = "" OR LOWER(end_date) = "present" THEN 0 
            ELSE 1 
          END, 
          -- Convert 'MMM YYYY' to 'YYYY-MM-DD' format for sorting
          strftime('%Y-%m-%d', 
            CASE 
              WHEN LENGTH(start_date) = 7 THEN 
                -- Format like "Apr 2025"
                '01-' || start_date
              ELSE 
                start_date
            END
          ) DESC`,
        [user.id]
      );



      const education = await getAll(
        'SELECT * FROM education WHERE user_id = ? ORDER BY graduation_date DESC',
        [user.id]
      );

      const certifications = await getAll(
        'SELECT * FROM certifications WHERE user_id = ? ORDER BY date_obtained DESC',
        [user.id]
      );

      const skills = await getAll(
        'SELECT * FROM skills WHERE user_id = ?',
        [user.id]
      );

      const additionalInfo = await getAll(
        'SELECT * FROM additional_info WHERE user_id = ?',
        [user.id]
      );

      const tags = await getAll(
        'SELECT * FROM user_tags WHERE user_id = ? ORDER BY created_at DESC',
        [user.id]
      );

      // Get application count
      const appCount = await getOne(
        'SELECT COUNT(*) as count FROM applications WHERE user_id = ?',
        [user.id]
      );

      return {
        user,
        employmentHistory,
        education,
        certifications,
        skills,
        additionalInfo,
        tags,
        applicationCount: appCount?.count || 0
      };
    }));

    res.json({ profiles });
  } catch (error) {
    console.error('Profiles fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

// Admin: Register new user
router.post('/admin/register', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      email,
      password,
      full_name,
      address,
      phone_number,
      linkedin_profile,
      github_link,
      experience_years,
      timezone,
      role
    } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    // Check if user already exists
    const existingUser = await getOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user with role
    const result = await runQuery(
      `INSERT INTO users (email, password, full_name, address, phone_number, linkedin_profile, github_link, experience_years, timezone, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [email, hashedPassword, full_name, address || '', phone_number || '', linkedin_profile || '', github_link || '', experience_years || 0, timezone || 'UTC', role || 'user']
    );

    const user = await getOne('SELECT id, email, full_name, role, timezone, created_at FROM users WHERE id = ?', [result.lastID]);

    res.status(201).json({
      message: 'User registered successfully',
      user
    });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Admin: Update user role
router.put('/:id/role', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    await runQuery('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ message: 'User role updated successfully' });
  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Admin: Delete user
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.params.id == req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await runQuery('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('User delete error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Admin: Approve user
router.put('/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await runQuery(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['active', req.params.id]
    );
    res.json({ message: 'User approved successfully' });
  } catch (error) {
    console.error('User approval error:', error);
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

// Admin: Reject user
router.put('/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await runQuery(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['rejected', req.params.id]
    );
    res.json({ message: 'User rejected' });
  } catch (error) {
    console.error('User rejection error:', error);
    res.status(500).json({ error: 'Failed to reject user' });
  }
});

// Admin: Update user status
router.put('/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['pending', 'active', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await runQuery(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, req.params.id]
    );
    res.json({ message: 'User status updated successfully' });
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Admin: Get application statistics with time filters
router.get('/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { period = 'all', userId } = req.query;
    
    let dateFilter = '';
    const params = [];
    
    // Set date filter based on period
    if (period === 'daily') {
      dateFilter = "AND DATE(a.applied_at) = DATE('now')";
    } else if (period === 'weekly') {
      dateFilter = "AND a.applied_at >= DATE('now', '-7 days')";
    } else if (period === 'monthly') {
      dateFilter = "AND a.applied_at >= DATE('now', '-30 days')";
    }
    
    // Filter by user if specified
    let userFilter = '';
    if (userId) {
      userFilter = 'AND a.user_id = ?';
      params.push(userId);
    }
    
    // Get overall stats
    const totalApps = await getOne(
      `SELECT COUNT(*) as count FROM applications a WHERE 1=1 ${dateFilter} ${userFilter}`,
      params
    );
    
    // Get daily breakdown for chart
    const dailyStats = await getAll(
      `SELECT DATE(a.applied_at) as date, COUNT(*) as count 
       FROM applications a 
       WHERE 1=1 ${dateFilter} ${userFilter}
       GROUP BY DATE(a.applied_at) 
       ORDER BY date DESC 
       LIMIT 30`,
      params
    );
    
    // Get stats by user
    const userStats = await getAll(
      `SELECT u.id, u.full_name, u.email, COUNT(a.id) as application_count
       FROM users u
       LEFT JOIN applications a ON u.id = a.user_id ${dateFilter ? 'AND ' + dateFilter.substring(4) : ''}
       WHERE u.role != 'admin'
       GROUP BY u.id
       ORDER BY application_count DESC`,
      []
    );
    
    // Get stats by company
    const companyStats = await getAll(
      `SELECT company_name, COUNT(*) as count 
       FROM applications a 
       WHERE company_name IS NOT NULL AND company_name != '' ${dateFilter} ${userFilter}
       GROUP BY company_name 
       ORDER BY count DESC 
       LIMIT 10`,
      params
    );
    
    // Get hourly distribution for today
    const hourlyStats = await getAll(
      `SELECT strftime('%H', a.applied_at) as hour, COUNT(*) as count 
       FROM applications a 
       WHERE DATE(a.applied_at) = DATE('now') ${userFilter}
       GROUP BY hour 
       ORDER BY hour`,
      userId ? [userId] : []
    );
    
    // Get weekly trend (last 7 days by day name)
    const weeklyTrend = await getAll(
      `SELECT strftime('%w', a.applied_at) as day_num, 
              CASE strftime('%w', a.applied_at)
                WHEN '0' THEN 'Sun'
                WHEN '1' THEN 'Mon'
                WHEN '2' THEN 'Tue'
                WHEN '3' THEN 'Wed'
                WHEN '4' THEN 'Thu'
                WHEN '5' THEN 'Fri'
                WHEN '6' THEN 'Sat'
              END as day_name,
              COUNT(*) as count 
       FROM applications a 
       WHERE a.applied_at >= DATE('now', '-7 days') ${userFilter}
       GROUP BY day_num 
       ORDER BY day_num`,
      userId ? [userId] : []
    );
    
    // Pending users count
    const pendingUsers = await getOne(
      "SELECT COUNT(*) as count FROM users WHERE status = 'pending'"
    );
    
    res.json({
      totalApplications: totalApps?.count || 0,
      pendingUsers: pendingUsers?.count || 0,
      dailyStats,
      userStats,
      companyStats,
      hourlyStats,
      weeklyTrend
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Admin: Get applications with filters
router.get('/admin/applications', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { period = 'all', userId, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    let dateFilter = '';
    const params = [];
    
    if (period === 'daily') {
      dateFilter = "AND DATE(a.applied_at) = DATE('now')";
    } else if (period === 'weekly') {
      dateFilter = "AND a.applied_at >= DATE('now', '-7 days')";
    } else if (period === 'monthly') {
      dateFilter = "AND a.applied_at >= DATE('now', '-30 days')";
    }
    
    let userFilter = '';
    if (userId) {
      userFilter = 'AND a.user_id = ?';
      params.push(userId);
    }
    
    const applications = await getAll(
      `SELECT a.*, u.full_name, u.email 
       FROM applications a
       JOIN users u ON a.user_id = u.id
       WHERE 1=1 ${dateFilter} ${userFilter}
       ORDER BY a.applied_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    
    const totalCount = await getOne(
      `SELECT COUNT(*) as count FROM applications a WHERE 1=1 ${dateFilter} ${userFilter}`,
      params
    );
    
    res.json({
      applications: applications.map(app => ({
        id: app.id,
        userId: app.user_id,
        userName: app.full_name,
        userEmail: app.email,
        jobTitle: app.job_title,
        companyName: app.company_name,
        appliedAt: app.applied_at,
        status: app.status,
        cvDocUrl: app.cv_doc_path ? `/uploads/${app.cv_doc_path}` : null,
        cvPdfUrl: app.cv_pdf_path ? `/uploads/${app.cv_pdf_path}` : null
      })),
      total: totalCount?.count || 0,
      page: parseInt(page),
      totalPages: Math.ceil((totalCount?.count || 0) / limit)
    });
  } catch (error) {
    console.error('Applications fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

module.exports = router;