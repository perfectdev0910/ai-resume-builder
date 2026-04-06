const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder'
});

async function generateCVContent(userProfile, jobDescription) {
  const { user, employmentHistory, education, certifications, additionalInfo } = userProfile;

  const systemPrompt = `You are a professional resume/CV writer...

CRITICAL GUIDELINES:
- Tailor resume strictly to job description
- Do NOT fabricate experience
- Use natural senior-level tone

JOB DESCRIPTION PRIORITY (HIGHEST IMPORTANCE):

1. The JOB DESCRIPTION is the PRIMARY source of truth.
2. ALL skills, tools, technologies, and responsibilities mentioned in the JD MUST:
   - Appear in the SKILLS section
   - Be reflected in the EXPERIENCE section

3. EXPERIENCE REWRITE RULE:
   - Rewrite past roles to mirror the JD as closely as possible
   - Use the SAME terminology, tools, and patterns from the JD
   - If JD mentions "ETL pipelines", do NOT say "data workflows" — use "ETL pipelines"

4. SKILL COVERAGE:
   - EVERY technical keyword from the JD MUST appear in the skills section
   - Missing even one JD skill is NOT allowed

5. PRIORITIZATION:
   - JD skills MUST appear BEFORE candidate-added skills in each category
   - Most recent role should include MOST of the JD skills

6. STRICT RELEVANCE:
   - Remove or avoid low-relevance skills that are not useful for this JD
   - Do NOT include generic filler skills unless necessary to meet category size

EXPERIENCE STRUCTURE (STRICT):

Each role MUST include:
1. summary → exactly 1 sentence
2. responsibilities → array of bullet points
3. keyAchievements → array of bullet points

ROLE LENGTH:
- Most recent: 6–8 responsibilities, 4–6 achievements (2–3 with metrics)
- Second: 6–8 responsibilities, 4–6 achievements (max 1–2 metrics)
- Others: 3–5 responsibilities, 2–3 achievements (no forced metrics)

STRICT REQUIREMENTS:
- experience MUST NOT be empty
- Each role MUST include all 3 fields
- Do NOT output generic bullet lists

SKILLS (STRICT):
- EXACTLY 10 categories
- EACH category ≥ 8 skills
- ALL JD skills must appear ONCE
- No duplicates

OUTPUT FORMAT (JSON):
{
  "summary": "...",
  "skills": "Category: skill1, skill2...",
  "experience": [
    {
      "position": "...",
      "company": "...",
      "location": "...",
      "period": "...",
      "summary": "...",
      "responsibilities": [],
      "keyAchievements": []
    }
  ],
  "education": [],
  "certifications": []
}

IMPORTANT: Ensure experience is ALWAYS populated before returning.
`;

  const userPrompt = `Generate a tailored resume:

## CANDIDATE
Name: ${user.full_name}
Experience: ${user.experience_years} years

### Employment
${employmentHistory.map((job, i) => `
${i + 1}. ${job.position} at ${job.company}
Period: ${job.start_date} - ${job.end_date || 'Present'}
Description: ${job.description}

(IMPORTANT: Use structured format:
- 1 summary
- responsibilities (6–8 recent / 3–5 older)
- keyAchievements (4–6 recent / 2–3 older)
)`).join('\n')}

### Education
${education.map(e => `${e.degree} - ${e.institution}`).join('\n')}

### Certifications
${certifications.map(c => c.name).join('\n')}

## JOB DESCRIPTION
${jobDescription}

Generate JSON only.`;

  try {
    let attempts = 0;
    let parsed;

    while (attempts < 2) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0].message.content;
      parsed = JSON.parse(content);

      // ✅ Validation
      if (
        parsed.experience &&
        parsed.experience.length > 0 &&
        parsed.experience.every(e =>
          e.summary &&
          Array.isArray(e.responsibilities) &&
          e.responsibilities.length > 0 &&
          Array.isArray(e.keyAchievements) &&
          e.keyAchievements.length > 0
        )
      ) {
        return parsed;
      }

      attempts++;
    }

    throw new Error('Failed to generate valid experience section after retry');

  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error('Failed to generate CV content');
  }
}

async function generateCoverLetter(userProfile, jobDescription, jobTitle, companyName) {
  const { user, employmentHistory, education, certifications } = userProfile;

  const systemPrompt = `Write a professional cover letter.

Rules:
- 3–4 paragraphs
- 250–350 words
- Personalized, not generic

OUTPUT JSON:
{
  "fullText": "Complete cover letter"
}`;

  const userPrompt = `
Candidate: ${user.full_name}
Role: ${jobTitle}
Company: ${companyName}

Experience:
${employmentHistory.slice(0, 2).map(j => `${j.position} at ${j.company}`).join('\n')}

Job Description:
${jobDescription}
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.8,
      max_tokens: 1200,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);

  } catch (error) {
    console.error('Cover letter error:', error);
    throw new Error('Failed to generate cover letter');
  }
}

async function extractJobDetails(jdContent) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'Extract job title and company. Return JSON.'
        },
        {
          role: 'user',
          content: jdContent.substring(0, 2000)
        }
      ],
      temperature: 0,
      max_tokens: 100,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);

  } catch {
    return { jobTitle: 'Not specified', companyName: 'Not specified' };
  }
}

module.exports = {
  generateCVContent,
  generateCoverLetter,
  extractJobDetails
};