const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder'
});

function safeParse(jsonString) {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error("JSON parse failed:", jsonString);

    // 🔥 emergency repair attempt
    try {
      const start = jsonString.indexOf("{");
      const end = jsonString.lastIndexOf("}");
      return JSON.parse(jsonString.slice(start, end + 1));
    } catch (err) {
      return {
        summary: "",
        skills: "",
        experience: [],
        education: [],
        certifications: []
      };
    }
  }
}

async function generateCVContent(userProfile, jobDescription) {
  const { user, employmentHistory, education, certifications, additionalInfo } = userProfile;

  const systemPrompt = `You are a professional resume writer.

Return ONLY valid JSON.

Do not include explanations, markdown, or extra text.

Follow this structure exactly:
{
  "summary": string,
  "skills": string,
  "experience": array,
  "education": array,
  "certifications": array
}`;

const userPrompt = `
Generate a tailored ATS-optimized resume using the candidate data and job description below.

Return ONLY valid JSON. No markdown, no explanations.

---

CANDIDATE PROFILE

Name: ${user.full_name}
Email: ${user.email}
Phone: ${user.phone_number || 'N/A'}
Location: ${user.address || 'N/A'}
LinkedIn: ${user.linkedin_profile || 'N/A'}
GitHub: ${user.github_link || 'N/A'}
Years of Experience: ${user.experience_years || 0}

---

EMPLOYMENT HISTORY

${employmentHistory.map((job, index) => `
Role ${index + 1}:
Title: ${job.position}
Company: ${job.company}
Location: ${job.location || 'N/A'}
Period: ${job.start_date || ''} - ${job.end_date || 'Present'}
Description: ${job.description || 'N/A'}
`).join('\n')}

---

EDUCATION

${education.map(edu => `
- ${edu.degree} | ${edu.institution} | ${edu.graduation_date || 'N/A'}
`).join('\n')}

---

CERTIFICATIONS

${certifications.map(cert => `
- ${cert.name} ${cert.issuer ? `(${cert.issuer})` : ''} ${cert.date_obtained || ''}
`).join('\n')}

---

ADDITIONAL INFO

${additionalInfo.map(info => `
- ${info.category}: ${info.content}
`).join('\n')}

---

JOB DESCRIPTION

${jobDescription}

---

INSTRUCTIONS

- Tailor the resume strictly to the job description
- Do NOT fabricate experience or skills
- Maintain factual consistency with provided data
- Optimize for ATS keyword matching
- Focus 85–90% on technical skills
- Limit soft skills to MAX 1 category and 5–8 items total.
- Keep soft skills minimal (max 1 category)
- Ensure all roles are included
- Prioritize recent roles with strong alignment to the JD; older roles can be generalized
- Use JD keywords naturally across experience and skills

ROLE HANDLING RULES:
- In the MOST RECENT ROLE summary, explicitly mention relevant industry/domain experience (e.g., fintech, healthcare, SaaS, AI, e-commerce) based on the candidate’s work and JD context.
- Full descriptive sentence of responsibility with technologies, collaboration, and system context.
- Another detailed responsibility showing impact and alignment with JD
- Most recent role: 1 summary, 8–10 responsibilities, 3–4 achievements (max 2 with metrics)
- Second role: same structure as above
- Other roles: 1 summary, 3 responsibilities, 1 achievement

Job Titles: 
- Adjust job titles to align with the JD keywords for ATS optimization, but DO NOT fabricate seniority or misrepresent roles.
- If needed, use this format: "ATS-Optimized Title (Original Title)" - Ensure consistency with responsibilities and experience level.

SKILLS RULES:
- Exactly 10 categories
- Each category ≥ 8 technical skills (tools, frameworks, programming languages, databases, cloud, DevOps, testing)
- Include all JD skills where relevant
- One category may contain soft skills only

OUTPUT FORMAT (STRICT JSON):

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
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 4000,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    console.log(content);
    return safeParse(content);
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
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    return safeParse(content);
  } catch (error) {
    console.error('Cover letter generation error:', error);
    throw new Error('Failed to generate cover letter');
  }
}

async function extractJobDetails(jdContent) {
  const systemPrompt = `Extract the job title and company name from the following job description. Return as JSON: {"jobTitle": "...", "companyName": "..."}. If not found, use "Not specified".`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: jdContent.substring(0, 2000) }
      ],
      max_completion_tokens: 200,
      response_format: { type: 'json_object' }
    });

    return safeParse(response.choices[0].message.content);
  } catch (error) {
    console.error('Job details extraction error:', error);
    return { jobTitle: 'Not specified', companyName: 'Not specified' };
  }
}

module.exports = { generateCVContent, generateCoverLetter, extractJobDetails };
