const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder'
});

async function generateCVContent(userProfile, jobDescription) {
  const { user, employmentHistory, education, certifications, additionalInfo } = userProfile;

  const systemPrompt = `You are a professional resume/CV writer with expertise in creating ATS-friendly, compelling resumes. Your task is to generate a tailored resume based on the candidate's profile and the job description provided.

CRITICAL GUIDELINES:
1. Tailor the resume to match the job requirements precisely
2. Use strong action verbs and quantifiable achievements with metrics where possible
3. Keep it professional and impactful
4. Highlight the most relevant skills and experiences for this specific job
5. Use keywords from the job description naturally throughout
6. Do NOT fabricate information - only use and enhance what's provided
7. Generate skills based on the candidate's experience and the job requirements

EXPERIENCE GUIDELINES:
- For the FIRST and SECOND most recent positions: Write AT LEAST 10 detailed sentences/bullet points explaining responsibilities, achievements, and impact. Include specific metrics, technologies used, team leadership, project outcomes, and business impact. Each bullet point should be detailed and substantial.
- For OTHER positions: Write 4-6 concise sentences/bullet points focusing on key achievements and relevant experience.

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
- Generate AT LEAST 40 relevant skills organized by category
- Format skills EXACTLY like this example:
  "Programming Languages: Java, Scala, Kotlin, JavaScript, TypeScript, SQL, Python, Bash, C#
  Frameworks & Libraries: React, Angular, Vue.js, Next.js, Nuxt.js, Spring Boot, Hibernate, J2EE, Spring MVC, Spring Security, Spring Data JPA, Apache Kafka, RabbitMQ, JAX-RS, Play, Akka, Ktor, Micronaut, Express, NestJS, .NET
  Cloud Technologies & Services: AWS (Lambda, EC2, S3, RDS, CloudFormation), Azure (App Services, Functions, CosmosDB), Google Cloud Platform (BigQuery, Firebase, Pub/Sub)
  Architecture: Microservices, Event-Driven, Reactive, DDD, TDD, BDD, Clean Architecture, CQRS
  AI & ML: OpenAI, TensorFlow, Recommendation Systems
  Databases & Data Storage: SQL (MySQL, PostgreSQL, MSSQL), NoSQL (MongoDB, Redis, Cassandra), Data Warehousing (Redshift, BigQuery), Graph Databases (Neo4j)
  DevOps & CI/CD: Docker, Kubernetes, Helm, Jenkins, GitLab CI/CD, GitHub Actions, Terraform, Ansible, AWS Elastic Beanstalk, Azure DevOps
  Version Control & Collaboration: Git (GitHub, GitLab, Bitbucket), SVN, Agile/Scrum methodologies, JIRA, Confluence
  Testing & Quality Assurance: Unit Testing (JUnit, TestNG, Mockito, PowerMock), Integration Testing (Selenium, Postman, RestAssured), TDD, Code Coverage (SonarQube, Jacoco)
  Additional Skills: RESTful API Design, GraphQL, WebSockets, Web Performance Optimization, Cross-Browser Compatibility, CI/CD Pipeline Design, Security Best Practices (OAuth, JWT, HTTPS), Agile/Scrum Leadership"
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
   ${index < 2 ? '(IMPORTANT: Generate AT LEAST 10 detailed bullet points for this position - include metrics, technologies, leadership, project outcomes, and business impact)' : '(Generate 4-6 concise bullet points for this position)'}
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
