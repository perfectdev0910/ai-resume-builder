const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder'
});

async function generateCVContent(userProfile, jobDescription) {
  const { user, employmentHistory, education, certifications, additionalInfo } = userProfile;

  const systemPrompt = `You are a professional resume/CV writer with expertise in creating ATS-friendly, realistic, and compelling resumes.

CRITICAL GUIDELINES:
1. Tailor the resume precisely to the job requirements
2. Use a natural, human tone (avoid overly "AI-generated" phrasing)
3. Do NOT overuse metrics or percentages
4. Only use information provided - do NOT fabricate
5. Integrate keywords from the job description naturally
6. Vary sentence structure and avoid repetition

EXPERIENCE GUIDELINES:
- MOST RECENT POSITION:
  • Write AT LEAST 10 detailed bullet points
  • ONLY 2–3 bullet points may include metrics (%, $, numbers)
  • Remaining bullets must focus on responsibilities, architecture, impact, collaboration, and technologies

- SECOND POSITION:
  • Write AT LEAST 10 bullet points
  • Avoid metrics (maximum 1–2 if truly meaningful)

- OTHER POSITIONS:
  • Write 4–6 concise bullet points
  • No forced metrics

SUMMARY GUIDELINES:
- 7–8 sentences in FIRST PERSON ("I")
- Do NOT mention name
- Include:
  • Years of experience
  • Core expertise
  • Technologies
  • Leadership/collaboration
  • Domain knowledge
  • Certifications (if relevant)
  • Career direction

SKILLS GUIDELINES (VERY IMPORTANT):
- Generate AT LEAST 100 skills
- Each category must contain MANY skills (10–20+)
- Avoid repetition
- Include modern and relevant tools

FORMAT EXACTLY:

Programming Languages: ...
Frameworks & Libraries: ...
Cloud Technologies & Services: ...
Architecture & Design Patterns: ...
AI & ML: ...
Databases & Data Storage: ...
DevOps & CI/CD: ...
Version Control & Collaboration: ...
Testing & Quality Assurance: ...
Security & Authentication: ...
Additional Skills: ...

OUTPUT FORMAT (JSON ONLY):
{
  "summary": "...",
  "skills": "...",
  "experience": [],
  "education": [],
  "certifications": []
}`;

  const userPrompt = `Generate a tailored resume:

## CANDIDATE PROFILE

Name: ${user.full_name}
Email: ${user.email}
Phone: ${user.phone_number || 'N/A'}
Location: ${user.address || 'N/A'}
LinkedIn: ${user.linkedin_profile || 'N/A'}
GitHub: ${user.github_link || 'N/A'}
Years of Experience: ${user.experience_years || 0}

### Employment History
${employmentHistory.map((job, index) => `
${index + 1}. ${job.position} at ${job.company}
Location: ${job.location || 'N/A'}
Period: ${job.start_date || ''} - ${job.end_date || 'Present'}
Description: ${job.description || 'N/A'}

${index === 0 
  ? '(IMPORTANT: Only 2–3 bullet points should include metrics. Others should be natural and descriptive.)'
  : index === 1 
  ? '(Avoid metrics except 1–2 if truly impactful.)'
  : '(No metrics required.)'
}
`).join('\n')}

### Education
${education.map(edu => `
- ${edu.degree} - ${edu.institution}
  Graduation: ${edu.graduation_date || 'N/A'}
`).join('\n')}

### Certifications
${certifications.map(cert => `- ${cert.name}`).join('\n')}

### Additional Information
${additionalInfo.map(info => `- ${info.category}: ${info.content}`).join('\n')}

---

## JOB DESCRIPTION
${jobDescription}

---

IMPORTANT:
- Only 2–3 metrics in FIRST job
- Keep tone natural and senior-level
- Generate 100+ skills
- Do NOT include additionalSections
- Return VALID JSON ONLY`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.6,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error('Failed to generate CV content');
  }
}

async function generateCoverLetter(userProfile, jobDescription, jobTitle, companyName) {
  const { user, employmentHistory, education, certifications } = userProfile;

  const systemPrompt = `You are an expert cover letter writer.

Write a compelling, natural, non-generic cover letter:
- 3–4 paragraphs (250–350 words)
- Avoid clichés and generic phrases
- Use real examples from experience
- Keep tone professional but human

OUTPUT (JSON):
{
  "salutation": "",
  "opening": "",
  "body": "",
  "companyFit": "",
  "closing": "",
  "signoff": "",
  "fullText": ""
}`;

  const userPrompt = `Candidate: ${user.full_name}
Role: ${jobTitle}
Company: ${companyName}

Recent Experience:
${employmentHistory.slice(0, 2).map(j => `- ${j.position} at ${j.company}`).join('\n')}

Education:
${education.slice(0, 1).map(e => `- ${e.degree}`).join('\n')}

Certifications:
${certifications.slice(0, 3).map(c => `- ${c.name}`).join('\n')}

Job Description:
${jobDescription}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Cover letter generation error:', error);
    throw new Error('Failed to generate cover letter');
  }
}

async function extractJobDetails(jdContent) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Extract job title and company name. Return JSON: {"jobTitle":"","companyName":""}'
        },
        {
          role: 'user',
          content: jdContent.substring(0, 2000)
        }
      ],
      temperature: 0,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    return { jobTitle: 'Not specified', companyName: 'Not specified' };
  }
}

module.exports = {
  generateCVContent,
  generateCoverLetter,
  extractJobDetails
};