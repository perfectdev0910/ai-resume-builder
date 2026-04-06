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

EXPERIENCE ALIGNMENT RULES (CRITICAL):

1. ALIGN WITH JOB DESCRIPTION:
   - Each bullet point MUST reflect responsibilities and requirements from the JOB DESCRIPTION
   - Reframe the candidate’s past experience to closely match the target role
   - Use similar terminology, tools, and patterns from the JD

2. INCORPORATE JD SKILLS:
   - Use skills and technologies from the JOB DESCRIPTION within bullet points
   - Ensure JD keywords appear naturally across the experience section
   - Prioritize high-impact and frequently mentioned JD skills

3. ADAPT TO TARGET JOB TITLE:
   - Interpret the TARGET JOB TITLE from the job description
   - Adjust tone and responsibilities to match expectations of that role
     Example:
     - Backend role → APIs, microservices, scalability, databases
     - Frontend role → UI/UX, performance, accessibility
     - Data role → pipelines, ETL, analytics, ML
     - DevOps → CI/CD, infrastructure, automation

4. DO NOT FABRICATE:
   - Do NOT introduce completely new experiences or technologies not implied by the candidate’s background
   - You MAY generalize or reframe existing experience to better match the JD

5. PRIORITIZATION:
   - Most recent roles should have the STRONGEST alignment with the JD
   - Older roles can be less aligned but still relevant

6. NATURAL INTEGRATION:
   - Do NOT keyword-stuff
   - Blend JD skills into real-world responsibilities naturally

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

SKILLS GUIDELINES (CRITICAL - DYNAMIC CATEGORIES):

1. FIRST: Extract ALL skills, tools, technologies, frameworks, and keywords explicitly mentioned in the JOB DESCRIPTION.
   - Do NOT miss any skill
   - Keep original wording (no paraphrasing)
   - Include even minor tools and methodologies

2. SECOND: Generate SKILL CATEGORIES dynamically based on the JOB DESCRIPTION.
   - Categories MUST reflect how the role is structured in the JD
   - Examples (do NOT hardcode): Backend, Frontend, Data Engineering, Cloud Infrastructure, AI/ML, DevOps, Security, Mobile, etc.
   - Use only relevant categories — no generic or empty ones

3. THIRD: Assign ALL extracted JD skills into the most appropriate categories
   - Every JD skill MUST appear exactly once
   - Do NOT drop or duplicate any skill

4. FOURTH: Add additional relevant skills from the candidate’s experience
   - Only if they strengthen the application
   - Place them in appropriate categories

5. STRICT REQUIREMENTS:
   - ALL JD skills MUST be included
   - Total skills MUST exceed 100
   - Each category should contain MANY skills (10–25+ where applicable)
   - Avoid duplicates
   - Do NOT invent irrelevant skills

6. ORDERING:
   - Within each category: JD skills FIRST, then candidate skills

7. OUTPUT FORMAT (STRICT STRING FORMAT):
Category Name 1: skill1, skill2, skill3...
Category Name 2: skill1, skill2, skill3...
Category Name 3: skill1, skill2, skill3...

OUTPUT FORMAT (JSON):
{
  "summary": "Detailed 7-8 sentence professional summary in FIRST PERSON (using 'I' statements, without mentioning name) tailored to the job with specific expertise, achievements, domain knowledge, and career objectives",
  "skills": "Category Name 1: skill1, skill2, skill3...\\nCategory Name 2: skill1, skill2, skill3...\\nCategory Name 3: skill1, skill2, skill3...\\n...",
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
2. SKILLS: Must include AT LEAST 100 skills organized by category 
3. EXPERIENCE (First 2 positions): Must have AT LEAST 10 detailed bullet points each with specific metrics, technologies, and business impact
4. EXPERIENCE (Other positions): Must have 4-6 bullet points each
5. DO NOT include "additionalSections" - any extra content should be omitted

Format skills EXACTLY like: "Category Name 1: skill1, skill2, skill3...\\nCategory Name 2: skill1, skill2, skill3...\\n..." etc.
IMPORTANT (EXPERIENCE ALIGNMENT):
- Experience MUST be rewritten to closely match the job description
- Use terminology and skills from the JD throughout bullet points
- Adapt responsibilities to match the target job title
- Do NOT copy JD text directly — rewrite naturally based on candidate experience`
;

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
