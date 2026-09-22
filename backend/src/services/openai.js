const OpenAI = require('openai');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
// 'deepseek-v4-flash' was retired (requests now route to deepseek-flash, V4.1, thinking ON by default).
const DEFAULT_MODEL = 'deepseek-flash';
const MAX_ATTEMPTS = 3;
// Hard cap per upstream request. Without it the SDK waits 10 minutes per attempt (x3 SDK
// retries x3 of ours), so a stalled DeepSeek response left /api/cv/generate pending "forever".
const REQUEST_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 90_000;

function getClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0 // chatJson does its own retrying with backoff
  });
}

function getModel(kind = 'default') {
  if (kind === 'fast') {
    return process.env.DEEPSEEK_FAST_MODEL || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  }
  return process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
}

function safeParse(jsonString) {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    // Fallback attempts run without JSON mode, so prose around the object is expected.
    try {
      const start = jsonString.indexOf('{');
      const end = jsonString.lastIndexOf('}');
      return JSON.parse(jsonString.slice(start, end + 1));
    } catch (err) {
      console.error('JSON parse failed:', jsonString);
      return {
        summary: '',
        skills: '',
        experience: [],
        education: [],
        certifications: []
      };
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Transient upstream failures worth retrying (rate limit, overload, gateway errors, network).
function isRetryableHttpError(error) {
  const status = error?.status ?? error?.response?.status;
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  return !status && /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|timed out/i.test(error?.message || '');
}

async function chatJson({ model, messages, temperature = 0.7, max_tokens = 2000 }) {
  const client = getClient();
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Attempt 1: normal JSON mode with thinking off.
    // Later attempts also force reasoning_effort=none (in case the model ignored `thinking`)
    // and drop response_format — DeepSeek documents that JSON mode "may occasionally return
    // empty content"; the prompts already demand JSON and safeParse tolerates prose around it.
    const request = {
      model,
      messages,
      temperature,
      max_tokens,
      thinking: { type: 'disabled' }
    };
    if (attempt === 1) {
      request.response_format = { type: 'json_object' };
    } else {
      request.reasoning_effort = 'none';
    }

    let response;
    const startedAt = Date.now();
    try {
      response = await client.chat.completions.create(request);
      console.log(`DeepSeek ${model} responded in ${Date.now() - startedAt}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
    } catch (error) {
      lastError = error;
      console.warn(
        `DeepSeek request failed after ${Date.now() - startedAt}ms ` +
        `(attempt ${attempt}/${MAX_ATTEMPTS}, status=${error.status || 'n/a'}): ${error.message}`
      );
      if (attempt < MAX_ATTEMPTS && isRetryableHttpError(error)) {
        await sleep(1000 * attempt);
        continue;
      }
      throw error;
    }

    const choice = response.choices?.[0];
    const content = choice?.message?.content;
    if (content && content.trim()) {
      return safeParse(content);
    }

    const finishReason = choice?.finish_reason || 'unknown';
    const reasoningLength = choice?.message?.reasoning_content?.length || 0;
    console.warn(
      `DeepSeek returned empty content (attempt ${attempt}/${MAX_ATTEMPTS}, model=${response.model || model}, ` +
      `finish_reason=${finishReason}, reasoning_chars=${reasoningLength}, ` +
      `usage=${JSON.stringify(response.usage || {})}, id=${response.id || 'n/a'})`
    );

    lastError = new Error(
      `Empty model response (finish_reason=${finishReason}` +
      (reasoningLength ? ', thinking mode was active' : '') + ')'
    );

    // Reasoning consumed the whole budget: give the next attempt (thinking forced off) more room.
    if (finishReason === 'length' && reasoningLength) {
      max_tokens = Math.min(max_tokens * 2, 16000);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(1000 * attempt);
    }
  }

  throw lastError || new Error('Empty model response');
}

// Short, safe-to-show reason for the client (no keys / request bodies).
function describeUpstreamError(error) {
  const status = error?.status ?? error?.response?.status;
  if (status === 401) return 'DeepSeek rejected the API key';
  if (status === 402) return 'DeepSeek account has insufficient balance';
  if (status === 429) return 'DeepSeek rate limit reached, try again shortly';
  if (status >= 500) return `DeepSeek is unavailable (HTTP ${status})`;
  if (/timed out/i.test(error?.message || '')) {
    return `DeepSeek did not respond within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s, try again`;
  }
  return error?.message || 'unknown error';
}

async function generateCVContent(userProfile, jobDescription) {
  const { user, employmentHistory, education, certifications, additionalInfo, skills } = userProfile;

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
- Summary: Null
- Responsibilities: 3 bullets, descriptive as above
- KeyAchievements: Null

Skills Section:
- EXACTLY 10 categories
- Each category ≥ 8 technical skills (tools, frameworks, programming languages, databases, cloud, DevOps, testing)
- Include ALL JD skills, no duplicates
- Soft skills only in one category (max 5–8 items)
- Each category must be on its own line, in this format:
  Category Name: skill1, skill2, skill3, ..., skillN

9. Industry Experience:
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
     • 3 responsibilities
   )`}
`).join('\n')}

### Education
${education.map(edu => `
- **${edu.degree}** - ${edu.institution}
  Location: ${edu.location || 'N/A'}
  Graduation: ${edu.graduation_date || 'N/A'}
  ${edu.gpa ? `GPA: ${edu.gpa}` : ''}
`).join('\n')}

### Skills
${(skills || []).length
  ? skills.map(skill => `- ${skill.skill_name}${skill.proficiency_level ? ` (${skill.proficiency_level})` : ''}`).join('\n')
  : 'None provided — infer only from employment history and the job description. Do not invent tools the candidate never used.'}

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
- OTHER roles: 3 responsibilities
- Include **every role provided**, do not omit any.
`;

  try {
    return await chatJson({
      model: getModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });
  } catch (error) {
    console.error('DeepSeek CV generation error:', error);
    throw new Error(error.message === 'DEEPSEEK_API_KEY is not configured'
      ? error.message
      : `Failed to generate CV content: ${describeUpstreamError(error)}`);
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
    return await chatJson({
      model: getModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1500
    });
  } catch (error) {
    console.error('DeepSeek cover letter generation error:', error);
    throw new Error(error.message === 'DEEPSEEK_API_KEY is not configured'
      ? error.message
      : `Failed to generate cover letter: ${describeUpstreamError(error)}`);
  }
}

async function extractJobDetails(jdContent) {
  const systemPrompt = `Extract the job title and company name from the following job description. Return as JSON: {"jobTitle": "...", "companyName": "..."}. If not found, use "Not specified".`;

  try {
    return await chatJson({
      model: getModel('fast'),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: jdContent.substring(0, 2000) }
      ],
      temperature: 0,
      max_tokens: 100
    });
  } catch (error) {
    console.error('DeepSeek job details extraction error:', error);
    return { jobTitle: 'Not specified', companyName: 'Not specified' };
  }
}

/**
 * Answer one application-form question in the candidate's voice, grounded in their profile
 * and the job description. Returns { answer }.
 */
async function answerApplicationQuestion({ question, profileText, jobDescription, jobTitle, companyName }) {
  const systemPrompt = `You are helping a job candidate answer application-form and interview questions.
Write the answer in the FIRST PERSON as the candidate. Ground every claim in the candidate profile —
never invent employers, degrees, numbers, or experience that are not in the profile. Tailor the answer
to the job description and company. Be specific, confident and natural; avoid clichés and filler.

LENGTH RULE: the answer must be EXACTLY TWO sentences. The first sentence should draw on the
candidate's relevant experience or skills; the second should connect it to this job or company.
If the question only needs a fact (yes/no, a number, a date), still give two short sentences.
Do not add a greeting, sign-off, bullet points, or the question text.

OUTPUT FORMAT (JSON): {"answer": "..."}`;

  const userPrompt = `## CANDIDATE PROFILE
${profileText}

## JOB
${jobTitle ? `Title: ${jobTitle}
` : ''}${companyName ? `Company: ${companyName}
` : ''}
## JOB DESCRIPTION
${String(jobDescription || '').slice(0, 6000)}

## QUESTION
${question}`;

  try {
    const result = await chatJson({
      model: getModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 400
    });
    const answer = typeof result?.answer === 'string' ? result.answer.trim() : '';
    if (!answer) throw new Error('Empty answer from model');
    return { answer };
  } catch (error) {
    console.error('DeepSeek question answering error:', error);
    throw new Error(error.message === 'DEEPSEEK_API_KEY is not configured'
      ? error.message
      : `Failed to answer question: ${describeUpstreamError(error)}`);
  }
}

/**
 * Streaming plain-text completion. Calls onToken for each content delta and resolves with
 * the full text. Thinking is disabled and there is no JSON mode — this is for spoken answers
 * where time-to-first-token matters more than structure.
 */
async function streamChat({ messages, kind = 'fast', temperature = 0.6, max_tokens = 400, signal, onToken }) {
  const client = getClient();
  const model = getModel(kind);
  const startedAt = Date.now();
  let first = true;
  let full = '';
  try {
    const stream = await client.chat.completions.create(
      { model, messages, temperature, max_tokens, stream: true, thinking: { type: 'disabled' } },
      { signal }
    );
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) continue;
      if (first) {
        console.log(`DeepSeek ${model} first token in ${Date.now() - startedAt}ms`);
        first = false;
      }
      full += delta;
      if (onToken) onToken(delta);
    }
    return full;
  } catch (error) {
    if (signal?.aborted) return full;
    throw new Error(error.message === 'DEEPSEEK_API_KEY is not configured'
      ? error.message
      : describeUpstreamError(error));
  }
}

/**
 * Post-interview summary for the candidate's own review and for briefing later rounds.
 * Returns plain text with short sections.
 */
async function summarizeInterview({ candidateName, companyName, jobTitle, stage, transcript = [], qa = [] }) {
  const stamp = (sec) => `${Math.floor((sec || 0) / 60)}:${String(Math.floor((sec || 0) % 60)).padStart(2, '0')}`;
  const transcriptText = transcript
    .map((t) => `[${stamp(t.at)}] ${t.speaker || 'Interviewer'}: ${t.text}`)
    .join('\n')
    .slice(0, 24000);
  const qaText = qa
    .map((t, i) => `Q${i + 1}: ${t.question}\nSuggested answer: ${t.answer}`)
    .join('\n\n')
    .slice(0, 8000);

  const systemPrompt = `You write concise, useful post-interview summaries for a job candidate. You are given the interviewer-side transcript of a live interview (the candidate's own words were not recorded) plus the questions that were detected and the answers suggested at the time.
Write for the candidate to re-read before the next round. Be specific and factual; do not invent anything that is not in the material.

OUTPUT FORMAT (JSON):
{
  "overview": "2-3 sentences: what the interview covered and how it went",
  "questions": ["each question the interviewer asked, in order, one line each"],
  "topics": ["key themes / technologies / requirements the interviewer emphasised"],
  "signals": ["anything the interviewer said about the role, team, process, timeline or expectations"],
  "followUps": ["concrete things to prepare or clarify before the next round"],
  "nextSteps": "what the interviewer said happens next, or empty string"
}`;

  const userPrompt = `Candidate: ${candidateName}
Company: ${companyName || 'unknown'} · Role: ${jobTitle || 'unknown'} · Stage: ${stage ? stage.replace(/_/g, ' ') : 'unknown'}

## INTERVIEWER TRANSCRIPT
${transcriptText || '(no transcript captured)'}

## DETECTED QUESTIONS AND SUGGESTED ANSWERS
${qaText || '(none)'}`;

  const result = await chatJson({
    model: getModel(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: 1400
  });

  const lines = [];
  if (result.overview) lines.push(String(result.overview).trim());
  const list = (title, items) => {
    const arr = Array.isArray(items) ? items.map((x) => String(x).trim()).filter(Boolean) : [];
    if (arr.length) lines.push('', `${title}:`, ...arr.map((x) => `- ${x}`));
  };
  list('Questions asked', result.questions);
  list('Key topics', result.topics);
  list('What the interviewer said', result.signals);
  list('Prepare for next time', result.followUps);
  if (result.nextSteps) lines.push('', `Next steps: ${String(result.nextSteps).trim()}`);
  const text = lines.join('\n').trim();
  if (!text) throw new Error('Empty summary from model');
  return text;
}

module.exports = { generateCVContent, generateCoverLetter, extractJobDetails, answerApplicationQuestion, streamChat, summarizeInterview };
