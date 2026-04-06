const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder'
});

async function generateCVContent(userProfile, jobDescription) {
  const { user, employmentHistory, education, certifications, additionalInfo } = userProfile;

  const systemPrompt = `You are a professional resume/CV writer with expertise in creating ATS-friendly, compelling resumes. Your task is to generate a tailored resume based on the candidate's profile and the job description provided.

CRITICAL GUIDELINES:
1. Tailor the resume to match the job requirements precisely
2. Use a natural, professional tone. Avoid overuse of metrics and percentages.
Only include quantifiable achievements (metrics, percentages, numbers) in 2–3 bullet points for the MOST RECENT position.
All other bullet points should focus on responsibilities, impact, technologies, and collaboration without forced metrics.
3. Keep it professional and impactful
4. Highlight the most relevant skills and experiences for this specific job
5. Use keywords from the job description naturally throughout
6. Do NOT fabricate information - only use and enhance what's provided
7. Generate skills based on the candidate's experience and the job requirements
8. Avoid repetitive sentence structures and overuse of buzzwords.
9. Vary sentence tone and phring across bullet points.
10. Write like an experienced senior engineer, not a marketing document.

EXPERIENCE GUIDELINES:
For the MOST RECENT position:
- Write AT LEAST 10 bullet points
- ONLY 2–3 bullet points should include metrics (%, $, numbers)
- The remaining bullet points should describe responsibilities, technical contributions, system design, collaboration, and impact in a natural way

For the SECOND position:
- Write AT LEAST 10 bullet points
- Avoid metrics unless truly necessary (max 1–2)

For OTHER positions:
- Write 4–6 concise bullet points with no forced metrics

SUMMARY GUIDELINES:
- Write a compelling 7-8 sentence professional summary in FIRST PERSON (use "I" statements)
- Do NOT mention the candidate's name in the summary
- Start with years of experience and primary role focus (e.g., "I am a Software Engineer with 10+ years of experience...")
- Include 2-3 key areas of expertise with specific technologies
- Mention notable achievements with metrics where possible
- Include relevant industry experience and domain knowledge
- Highlight leadership experience or team collaboration
- Mention any relevant certifications or specialized training
- End with value proposition and career objectives
- Include relevant keywords from the job description naturally

SKILLS GUIDELINES (VERY IMPORTANT):
- Generate AT LEAST 100 relevant skills across all categories.
1. FIRST: Extract ALL skills, tools, technologies, frameworks, and keywords explicitly mentioned in the JOB DESCRIPTION.
   - Do NOT miss any skill from the JD
   - Do NOT paraphrase or generalize (keep original terms)
   - Include even minor tools if mentioned

2. SECOND: Add relevant skills from the candidate's experience ONLY if they complement the JD.

3. THIRD: Organize skills into categories BASED ON the job description.
   - Categories should reflect how skills are grouped in the JD
   - You may adapt or create categories dynamically (e.g., Backend, Frontend, Cloud, Data, AI/ML, DevOps, etc.)

4. STRICT REQUIREMENTS:
   - ALL JD skills MUST be included
   - Total skills MUST exceed 100
   - Each category should contain MANY skills (10–25+)
   - Avoid duplicates
   - Do NOT invent irrelevant skills

5. PRIORITIZATION:
   - JD skills come FIRST in each category
   - Candidate skills come AFTER

6. OUTPUT FORMAT (STRICT):
Programming Languages: skill1, skill2, skill3...
Frameworks & Libraries: skill1, skill2...
Cloud & Infrastructure: skill1, skill2...
Architecture & Design Patterns: skill1, skill2...
Databases & Storage: skill1, skill2...
DevOps & CI/CD: skill1, skill2...
Testing & Quality Assurance: skill1, skill2...
Security & Authentication: skill1, skill2...
Tools & Platforms: skill1, skill2...
Additional Skills: skill1, skill2...

SKILLS REQUIREMENTS:
- Each category must contain MANY skills (10–20+ each)
- Ensure total skills count exceeds 100
- Avoid repetition
- Include both core and advanced tools/technologies
- Include modern industry tools based on job description
- Format skills EXACTLY like this example:
  "Programming Languages: (15+ skills)
Frameworks & Libraries: (15+ skills)
Cloud Technologies & Services: (15+ skills)
Architecture & Design Patterns: (10+ skills)
AI & ML (if relevant): (5–10 skills)
Databases & Data Storage: (10+ skills)
DevOps & CI/CD: (10+ skills)
Version Control & Collaboration: (5–10 skills)
Testing & Quality Assurance: (10+ skills)
Security & Authentication: (5–10 skills)
Additional Skills: (10–15 skills)"
- Include skills based on candidate's experience AND job requirements
- Organize into clear categories as shown above

OUTPUT FORMAT (JSON):
{
  "summary": "Detailed 7-8 sentence professional summary in FIRST PERSON (using 'I' statements, without mentioning name) tailored to the job with specific expertise, achievements, domain knowledge, and career objectives",
  "skills": "Programming Languages: skill1, skill2, skill3...\\nFrameworks & Libraries: skill1, skill2...\\nCloud Technologies & Services: skill1, skill2...\\nArchitecture: skill1, skill2...\\nDatabases & Data Storage: skill1, skill2...\\nDevOps & CI/CD: skill1, skill2...\\nVersion Control & Collaboration: skill1, skill2...\\nTesting & Quality Assurance: skill1, skill2...\\nAdditional Skills: skill1, skill2...",
  "experience": [
    {
      "position": "Job Title",
      "company": "Company Name",
      "location": "City, State",
      "period": "Start - End",
      "achievements": ["Detailed achievement with metrics and impact", ...]
    }
  ],
  "education": [
    {
      "degree": "Degree Name",
      "institution": "School Name",
      "graduation": "Year",
      "details": "Optional details like honors, relevant coursework"
    }
  ],
  "certifications": ["Certification Name (Issuer, Date)"],
  "additionalSections": [
    {
      "title": "Section Title",
      "content": "Content"
    }
  ]
}
IMPORTANT: Before generating the final output, internally extract and list all skills from the job description and ensure 100% of them appear in the skills section.  
`
;

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
   ${index < 2 ? '(IMPORTANT: Generate AT LEAST 10 detailed bullet points for this position - Only 2–3 bullet points should include metrics. The rest should focus on responsibilities, technologies, system design, and real-world impact in a natural tone.)' : '(Generate 4-6 concise bullet points for this position)'}
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

---

Generate a professional, highly tailored resume in the JSON format specified. 

CRITICAL REQUIREMENTS:
1. SUMMARY: Must be 7-8 sentences in FIRST PERSON (use "I" statements) WITHOUT mentioning the candidate's name, covering experience, expertise, achievements, domain knowledge, leadership, certifications, and career objectives
2. SKILLS: Must include AT LEAST 40 skills organized by category (Programming Languages, Frameworks & Libraries, Cloud Technologies, Architecture, Databases, DevOps, Version Control, Testing, Additional Skills)
3. EXPERIENCE (First 2 positions): Must have AT LEAST 10 detailed bullet points each with specific metrics, technologies, and business impact
4. EXPERIENCE (Other positions): Must have 4-6 bullet points each
5. DO NOT include "additionalSections" - any extra content should be omitted

Format skills EXACTLY like: "Programming Languages: Java, Python, JavaScript...\\nFrameworks & Libraries: React, Spring Boot...\\n..." etc.`;

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
