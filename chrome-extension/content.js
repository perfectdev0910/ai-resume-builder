// Content script for AI Resume Builder
// Runs on all pages to enable JD scraping

(function() {
  // Flag to prevent multiple injections
  if (window.__aiResumeBuilderInjected) return;
  window.__aiResumeBuilderInjected = true;

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'scrapeJD') {
      const result = scrapeJobDescription();
      sendResponse(result);
    }
    return true;
  });

  // Job description scraping function
  function scrapeJobDescription() {
    const selectors = [
      // LinkedIn
      '.jobs-description__content',
      '.jobs-box__html-content',
      '.jobs-description-content__text',
      // Indeed
      '#jobDescriptionText',
      '.jobsearch-jobDescriptionText',
      // Glassdoor
      '.jobDescriptionContent',
      '#JobDescriptionContainer',
      '.desc',
      // Monster
      '.job-description',
      // ZipRecruiter
      '.job_description',
      // Workday
      '[data-automation-id="jobPostingDescription"]',
      // Greenhouse
      '#content .content',
      '.app-body',
      // Lever
      '.posting-page .content',
      '.section-wrapper',
      // AngelList/Wellfound
      '.job-description-wrapper',
      // SmartRecruiters
      '.job-sections',
      // Jobvite
      '.jv-job-detail-description',
      // Generic selectors
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[class*="job_description"]',
      '[id*="job-description"]',
      '[id*="jobDescription"]',
      '[data-testid*="job-description"]',
      'article.job',
      '.job-details',
      '.description',
      '[role="main"]'
    ];

    let jobDescription = '';
    let jobTitle = '';
    let companyName = '';

    // Extract job title
    const titleSelectors = [
      '.jobs-unified-top-card__job-title',
      '.topcard__title',
      '.jobsearch-JobInfoHeader-title',
      '.job-title',
      '.posting-headline h2',
      '[data-testid="job-title"]',
      '[class*="job-title"]',
      '[class*="jobTitle"]',
      'h1.title',
      'h1'
    ];

    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        jobTitle = el.textContent.trim();
        break;
      }
    }

    // Extract company name
    const companySelectors = [
      '.jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      '.jobsearch-InlineCompanyRating-companyHeader',
      '.company-name',
      '[data-testid="company-name"]',
      '[class*="company-name"]',
      '[class*="companyName"]'
    ];

    for (const selector of companySelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        companyName = el.textContent.trim();
        break;
      }
    }

    // Extract job description
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.innerText || el.textContent;
        if (text && text.trim().length > 200) {
          jobDescription = text.trim();
          break;
        }
      }
    }

    // Fallback: get main content area
    if (!jobDescription) {
      const main = document.querySelector('main') || 
                   document.querySelector('article') || 
                   document.querySelector('[role="main"]');
      if (main) {
        jobDescription = main.innerText || main.textContent;
      }
    }

    // Final fallback: body text
    if (!jobDescription || jobDescription.length < 200) {
      const bodyText = document.body.innerText;
      // Try to extract relevant portion
      const jdMarkers = ['responsibilities', 'requirements', 'qualifications', 'about the role', 'job description', 'what you'];
      let startIdx = -1;
      for (const marker of jdMarkers) {
        const idx = bodyText.toLowerCase().indexOf(marker);
        if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
          startIdx = idx;
        }
      }
      if (startIdx !== -1) {
        jobDescription = bodyText.substring(Math.max(0, startIdx - 200), startIdx + 5000);
      } else {
        jobDescription = bodyText.substring(0, 8000);
      }
    }

    // Clean up whitespace
    jobDescription = jobDescription
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // Limit length
    if (jobDescription.length > 10000) {
      jobDescription = jobDescription.substring(0, 10000) + '...';
    }

    return {
      jobDescription,
      jobTitle: jobTitle || 'Unknown Position',
      companyName: companyName || 'Unknown Company',
      url: window.location.href
    };
  }

  // Optional: Add a floating button for quick access
  function addQuickAccessButton() {
    // Check if we're on a job page
    const isJobPage = document.querySelector('[class*="job"]') ||
                      document.querySelector('[id*="job"]') ||
                      window.location.href.includes('job') ||
                      window.location.href.includes('career');

    if (!isJobPage) return;

    const button = document.createElement('div');
    button.id = 'ai-resume-builder-fab';
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    `;
    button.title = 'Generate CV with AI Resume Builder';
    
    button.addEventListener('click', () => {
      // Open popup or trigger action
      chrome.runtime.sendMessage({ action: 'openDashboard' });
    });

    document.body.appendChild(button);
  }

  // Initialize
  if (document.readyState === 'complete') {
    addQuickAccessButton();
  } else {
    window.addEventListener('load', addQuickAccessButton);
  }
})();
