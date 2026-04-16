const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder'
});

async function generateCVContent(userProfile, jobDescription) {
  const { user, employmentHistory, education, certifications, additionalInfo } = userProfile;

  const systemPrompt = `You are a professional resume/CV writer specialized in ATS-optimized resumes for technical roles.
CRITICAL GUIDELINES:

1. Tailor the resume to the job description (JD) precisely.
2. Focus 85–90% on technical skills/tools (programming languages, frameworks, databases, cloud, DevOps, APIs, architecture, testing, AI/ML if applicable). 
3. Limit soft skills to MAX 1 category and 5–8 items total.
4. Generate ATS-friendly, professional, non-marketing tone.
5. Use JD keywords naturally across experience and skills.
6. Do NOT fabricate experiences or skills.
7. Prioritize recent roles with strong alignment to the JD; older roles can be generalized.
8. Experience section structure:

MOST RECENT ROLE:
- Summary: 1 sentence describing role and impact
- Responsibilities: 8-10 bullets. Each bullet should be a full sentence describing complex tasks, system design, technologies, collaboration, and measurable impact where appropriate. Avoid single-line fragments.
- KeyAchievements: 4–6 bullets. Include detailed outcomes and improvements. Only 2–3 bullets may include metrics. 

SECOND ROLE:
- Summary: 1 sentence
- Responsibilities: 8–10 bullets, detailed and descriptive as above
- KeyAchievements: 4–6 bullets, max 1–2 with metrics

OTHER ROLES:
- Summary: 1 sentence
- Responsibilities: 3–5 bullets, descriptive as above
- KeyAchievements: 2–3 bullets

Skills Section:
- EXACTLY 10 categories
- Each category ≥ 8 technical skills (tools, frameworks, programming languages, databases, cloud, DevOps, testing)
- Include ALL JD skills, no duplicates
- Soft skills only in one category (max 5–8 items)
- Each category must be on its own line, in this format:
  Category Name: skill1, skill2, skill3, ..., skillN

9. Job Titles:
- Adjust job titles to align with the JD keywords for ATS optimization, but DO NOT fabricate seniority or misrepresent roles.
- If needed, use this format:
  "ATS-Optimized Title (Original Title)"
- Ensure consistency with responsibilities and experience level.

10. Industry Experience:
- In the MOST RECENT ROLE summary, explicitly mention relevant industry/domain experience (e.g., fintech, healthcare, SaaS, AI, e-commerce) based on the candidate’s work and JD context.

Output JSON:
{
  "summary": "... 7–8 sentence first-person summary, including technical expertise, achievements, domain knowledge, leadership, career objectives, JD keywords",
  "skills": "Category1: skill1, skill2, skill3, ..., skillN\\nCategory2: skill1, skill2, skill3, ..., skillN\\nCategory3: ...",
  "experience": [
    {
      "position": "Job Title",
      "company": "Company Name",
      "location": "City, State",
      "period": "Start - End",
      "summary": "1 sentence summary",
      "responsibilities": [
        "Full descriptive sentence of responsibility with technologies, collaboration, and system context.",
        "Another detailed responsibility showing impact and alignment with JD."
      ],
      "keyAchievements": [
        "Detailed achievement describing outcome, improvements, or optimization; include metrics for only allowed bullets.",
        "Another achievement bullet describing problem solved, technologies used, or business impact."
      ]
    }
  ],
  "education": [
    {
      "degree": "Degree Name",
      "institution": "School Name",
      "graduation": "Year",
      "details": "Optional details"
    }
  ],
  "certifications": ["Certification Name (Issuer, Date)"]
}`;

 const userPrompt = `Generate a tailored resume for the following candidate applying to this job:

## CANDIDATE PROFILE

**Name:** ${user.full_name}
**Email:** ${user.email}
**Phone:** ${user.phone_number || 'N/A'}
**Location:** ${user.address || 'N/A'}
**LinkedIn:** ${user.linkedin_profile || 'N/A'}
**GitHub:** ${user.github_link || 'N/A'}
**Years of Experience:** ${user.experience_years || 0}

### Employment History (Listed from most recent)
${employmentHistory.map((job, index) => `
${index + 1}. **${job.position}** at **${job.company}**
   Location: ${job.location || 'N/A'}
   Period: ${job.start_date || ''} - ${job.end_date || 'Present'}
   Description: ${job.description || 'N/A'}

      (TITLE OPTIMIZATION RULE:
   - Align the job title with the JOB DESCRIPTION keywords for ATS optimization.
   - DO NOT fabricate seniority or misrepresent the role.
   - If alignment is needed, use format:
     "ATS-Optimized Title (Original Title)"
   - Ensure consistency with responsibilities and experience level.)

   ${index === 0 ? `
   (MOST RECENT ROLE REQUIREMENTS:
   - Generate:
     • 1 strong summary (1 sentence)
     • 8–10 responsibilities (NO metrics, focus on systems, architecture, JD alignment)
     • 4–6 key achievements (ONLY 2–3 with metrics)
   )` : index === 1 ? `
   (SECOND ROLE REQUIREMENTS:
   - Generate:
     • 1 summary
     • 8–10 responsibilities
     • 4–6 key achievements (max 1–2 metrics)
   )` : `
   (OTHER ROLE REQUIREMENTS:
   - Generate:
     • 1 summary
     • 3–5 responsibilities
     • 2–3 key achievements
   )`}
`).join('\n')}

### Education
${education.map(edu => `
- **${edu.degree}** - ${edu.institution}
  Location: ${edu.location || 'N/A'}
  Graduation: ${edu.graduation_date || 'N/A'}
  ${edu.gpa ? `GPA: ${edu.gpa}` : ''}
`).join('\n')}

### Certifications
${certifications.map(cert => `- ${cert.name}${cert.issuer ? ` (${cert.issuer})` : ''}${cert.date_obtained ? ` - ${cert.date_obtained}` : ''}${cert.credly_link ? ` [Verified: ${cert.credly_link}]` : ''}`).join('\n')}

### Additional Information
${additionalInfo.map(info => `- ${info.category}: ${info.content}`).join('\n')}

---

## JOB DESCRIPTION

${jobDescription}

## STRICT OUTPUT RULES

- Apply TITLE OPTIMIZATION RULE to EVERY role
- MOST RECENT role MUST include INDUSTRY/DOMAIN mention in summary
- Maintain factual consistency with provided experience
- Do NOT omit any role
- Ensure alignment with JD keywords across titles, responsibilities, and achievements
- Avoid generic phrasing; keep it technical and ATS-optimized

Guidelines:
- MOST RECENT role: 1 summary, 8–10 responsibilities, 4–6 achievements
- SECOND role: 1 summary, 8–10 responsibilities, 4–6 achievements
- OTHER roles: 1 summary, 3–5 responsibilities, 2–3 achievements each
- Include **every role provided**, do not omit any.
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error('Failed to generate CV content');
  }
}

async function generateCoverLetter(userProfile, jobDescription, jobTitle, companyName) {
  const { user, employmentHistory, education, certifications } = userProfile;

  const systemPrompt = `You are an expert cover letter writer. Write a compelling, professional cover letter that:
1. Opens with enthusiasm and mentions the specific position and company
2. Highlights 2-3 key qualifications that match the job requirements
3. Provides specific examples of achievements from the candidate's background
4. Shows knowledge of the company and why the candidate wants to work there
5. Closes with a strong call to action
6. Is personalized and NOT generic - avoid clichés

The cover letter should be 3-4 paragraphs, approximately 250-350 words.

OUTPUT FORMAT (JSON):
{
  "salutation": "Dear Hiring Manager,",
  "opening": "First paragraph - enthusiastic opening mentioning position and company",
  "body": "Second paragraph - key qualifications and achievements with specific examples",
  "companyFit": "Third paragraph - why this company and how you'll contribute",
  "closing": "Final paragraph - strong closing with call to action",
  "signoff": "Sincerely,",
  "fullText": "Complete cover letter as one formatted text block"
}`;

  const userPrompt = `Write a tailored cover letter for:

**Candidate:** ${user.full_name}
**Email:** ${user.email}
**Phone:** ${user.phone_number || 'N/A'}

**Applying for:** ${jobTitle || 'the position'}
**Company:** ${companyName || 'your company'}

### Candidate's Background
**Recent Experience:**
${employmentHistory.slice(0, 2).map(job => `- ${job.position} at ${job.company} (${job.start_date || ''} - ${job.end_date || 'Present'})`).join('\n')}

**Education:**
${education.slice(0, 1).map(edu => `- ${edu.degree} from ${edu.institution}`).join('\n')}

**Certifications:**
${certifications.slice(0, 3).map(cert => `- ${cert.name}`).join('\n')}

### Job Description
${jobDescription}

---

Write a compelling, personalized cover letter that connects the candidate's experience to this specific job. Make it genuine and avoid generic phrases.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.8,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    console.error('Cover letter generation error:', error);
    throw new Error('Failed to generate cover letter');
  }
}

async function extractJobDetails(jdContent) {
  const systemPrompt = `Extract the job title and company name from the following job description. Return as JSON: {"jobTitle": "...", "companyName": "..."}. If not found, use "Not specified".`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: jdContent.substring(0, 2000) }
      ],
      temperature: 0,
      max_tokens: 100,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Job details extraction error:', error);
    return { jobTitle: 'Not specified', companyName: 'Not specified' };
  }
}

module.exports = { generateCVContent, generateCoverLetter, extractJobDetails };
