/**
 * Loads everything the AI prompts need to know about a user, on either database.
 */
const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const p1 = isPostgres ? '$1' : '?';

async function loadUserProfile(userId) {
  const user = await db.getOne(
    `SELECT id, email, full_name, address, phone_number, linkedin_profile, github_link, experience_years, credly_profile_link
     FROM users WHERE id = ${p1}`,
    [userId]
  );
  if (!user) return null;

  const [employmentHistory, education, certifications, skills, additionalInfo, tags] = await Promise.all([
    db.getAll(
      `SELECT * FROM employment_history WHERE user_id = ${p1}
       ORDER BY CASE WHEN end_date IS NULL OR end_date = '' OR LOWER(end_date) = 'present' THEN 0 ELSE 1 END, start_date DESC`,
      [userId]
    ),
    db.getAll(`SELECT * FROM education WHERE user_id = ${p1} ORDER BY graduation_date DESC`, [userId]),
    db.getAll(`SELECT * FROM certifications WHERE user_id = ${p1}`, [userId]),
    db.getAll(`SELECT * FROM skills WHERE user_id = ${p1}`, [userId]),
    db.getAll(`SELECT * FROM additional_info WHERE user_id = ${p1}`, [userId]),
    db.getAll(`SELECT * FROM user_tags WHERE user_id = ${p1}`, [userId])
  ]);

  return { user, employmentHistory, education, certifications, skills, additionalInfo, tags };
}

// Compact plain-text version of the profile for prompts.
function describeProfile(profile) {
  const { user, employmentHistory = [], education = [], certifications = [], skills = [], additionalInfo = [] } = profile;
  const lines = [];
  lines.push(`Name: ${user.full_name || 'N/A'}`);
  if (user.experience_years != null) lines.push(`Years of experience: ${user.experience_years}`);
  if (user.address) lines.push(`Location: ${user.address}`);

  if (employmentHistory.length) {
    lines.push('', 'Experience:');
    for (const job of employmentHistory) {
      const title = job.position || job.job_title || '';
      const company = job.company || job.company_name || '';
      const when = `${job.start_date || ''} – ${job.end_date || 'Present'}`;
      lines.push(`- ${title} at ${company} (${when})`);
      const desc = job.description || job.responsibilities || '';
      if (desc) lines.push(`  ${String(desc).replace(/\s+/g, ' ').slice(0, 600)}`);
    }
  }
  if (education.length) {
    lines.push('', 'Education:');
    for (const edu of education) {
      lines.push(`- ${edu.degree || ''}${edu.field_of_study ? ` in ${edu.field_of_study}` : ''} — ${edu.institution || ''}${edu.graduation_date ? ` (${edu.graduation_date})` : ''}`);
    }
  }
  if (certifications.length) {
    lines.push('', `Certifications: ${certifications.map((c) => c.name).filter(Boolean).join(', ')}`);
  }
  if (skills.length) {
    lines.push('', `Skills: ${skills.map((s) => s.skill_name).filter(Boolean).join(', ')}`);
  }
  if (additionalInfo.length) {
    lines.push('', 'Additional info:');
    for (const info of additionalInfo) {
      const label = info.category || info.info_type || '';
      const value = info.content || info.info_value || '';
      if (value) lines.push(`- ${label ? `${label}: ` : ''}${String(value).replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }
  return lines.join('\n');
}

module.exports = { loadUserProfile, describeProfile };
