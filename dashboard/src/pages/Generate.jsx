import { useRef, useState } from 'react';
import { cvAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

// Helper to sanitize filename
const sanitizeFilename = (name) => name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').trim();
const trimCompanyName = (name) => String(name || '').trim();
const prettyCompanyName = (name) => {
  const trimmed = trimCompanyName(name);
  if (!trimmed) return '';
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
    return trimmed;
  }
  return trimmed.replace(/\S+/g, (word) => {
    if (word.length <= 4 && word === word.toUpperCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
};

export default function Generate() {
  const { user } = useAuth();
  const [jobDescription, setJobDescription] = useState('');
  const [jdLink, setJdLink] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const generatingRef = useRef(false);

  const handleGenerate = async (skipDuplicateCheck = false) => {
    const force = skipDuplicateCheck === true;

    if (generatingRef.current) return;

    if (!jobDescription.trim()) {
      setError('Please enter a job description');
      return;
    }

    const normalizedCompany = prettyCompanyName(companyName);
    if (!normalizedCompany) {
      setError('Company name is required');
      return;
    }

    if (normalizedCompany !== companyName) {
      setCompanyName(normalizedCompany);
    }

    generatingRef.current = true;
    setLoading(true);
    setError('');
    setResult(null);
    setShowDuplicateModal(false);

    try {
      const response = await cvAPI.generate(jobDescription, jdLink, normalizedCompany, { force });
      setResult(response.data);
      if (response.data?.warning) {
        setError(response.data.warning);
      }
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.isDuplicate) {
        setShowDuplicateModal(true);
      } else {
        setError(err.response?.data?.error || 'Failed to generate documents. Please try again.');
      }
    } finally {
      generatingRef.current = false;
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!jobDescription.trim()) {
      setError('Please enter a job description');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await cvAPI.preview(jobDescription);
      setPreview(response.data.cvContent);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate preview');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setJobDescription('');
    setJdLink('');
    setCompanyName('');
    setResult(null);
    setPreview(null);
    setError('');
    setShowDuplicateModal(false);
  };
  
  const fullName = sanitizeFilename(user?.full_name || 'User');

  const handleDownload = async (kind, fileType) => {
    try {
      const applicationId = result?.application?.id;
      if (!applicationId) {
        setError('Missing application ID');
        return;
      }

      let url;
      if (kind === 'resume') {
        url = fileType === 'docx'
          ? cvAPI.downloadDocUrl(applicationId)
          : cvAPI.downloadPdfUrl(applicationId);
      } else {
        url = fileType === 'docx'
          ? cvAPI.downloadCoverLetterDocUrl(applicationId)
          : cvAPI.downloadCoverLetterPdfUrl(applicationId);
      }

      const token = localStorage.getItem('authToken');
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const prefix = kind === 'resume' ? 'Resume' : 'Cover_Letter';
      link.href = blobUrl;
      link.download = `${fullName}_${prefix}.${fileType}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed:', err);
      setError('Failed to download file');
    }
  };

  const previewSkillLines = (skills) => {
    if (!skills) return [];
    if (Array.isArray(skills)) return skills.filter(Boolean);
    if (typeof skills === 'string') {
      return skills.split('\n').map((line) => line.trim()).filter(Boolean);
    }
    return [];
  };

  const previewExperienceBullets = (exp) => [
    ...(Array.isArray(exp.responsibilities) ? exp.responsibilities : []),
    ...(Array.isArray(exp.keyAchievements) ? exp.keyAchievements : []),
    ...(Array.isArray(exp.achievements) ? exp.achievements : [])
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Generate Tailored Resume & Cover Letter</h1>
        <p className="text-gray-500 mt-1">Paste a job description and we'll create a perfectly tailored Resume and Cover Letter</p>
      </div>

      {/* Duplicate Warning Modal */}
      {showDuplicateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-yellow-800 mb-2">⚠️ Duplicate Application</h3>
            <p className="text-gray-600 mb-4">
              You have already applied to <strong>{prettyCompanyName(companyName)}</strong> in the last 30 days. Are you sure you want to proceed?
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDuplicateModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button onClick={() => handleGenerate(true)} className="btn btn-primary">
                Proceed Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Result */}
      {result && (
        <div className="card p-6 bg-green-50 border-green-200">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-green-800">Documents Generated Successfully!</h2>
              <p className="text-green-700 mt-1">
                Your tailored Resume and Cover Letter for <strong>{result.application?.jobTitle}</strong> at <strong>{result.application?.companyName}</strong> are ready.
              </p>
              
              {/* Resume Downloads */}
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-green-800 mb-2">Resume</h4>
                <div className="flex gap-3">

                  <button
                    onClick={() => handleDownload('resume', 'docx')}
                    className="btn bg-green-600 text-white hover:bg-green-700"
                  >
                    DOCX
                  </button>

                  <button
                    onClick={() => handleDownload('resume', 'pdf')}
                    className="btn bg-white text-green-700 border border-green-300 hover:bg-green-50"
                  >
                    PDF
                  </button>

                </div>
              </div>
              
              {(result.application?.coverLetterDocUrl || result.application?.coverLetterPdfUrl) && (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-green-800 mb-2">Cover Letter</h4>
                  <div className="flex gap-3">
                    {result.application?.coverLetterDocUrl && (
                      <button
                        onClick={() => handleDownload('cover', 'docx')}
                        className="btn bg-green-600 text-white hover:bg-green-700"
                      >
                        DOCX
                      </button>
                    )}
                    {result.application?.coverLetterPdfUrl && (
                      <button
                        onClick={() => handleDownload('cover', 'pdf')}
                        className="btn bg-white text-green-700 border border-green-300 hover:bg-green-50"
                      >
                        PDF
                      </button>
                    )}
                  </div>
                </div>
              )}
              
              <button onClick={handleReset} className="btn btn-secondary mt-4">
                Generate Another
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="flex items-center gap-3 text-red-700">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        </div>
      )}

      {/* Input Form */}
      {!result && (
        <div className="card p-6 space-y-4">
          <div>
            <label className="label">Job Description *</label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              className="input"
              rows="12"
              placeholder="Paste the complete job description here...

Include:
• Job title and company
• Responsibilities
• Required qualifications
• Preferred skills
• Any other relevant details"
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Company Name *</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                onBlur={() => setCompanyName((name) => prettyCompanyName(name))}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text');
                  if (!pasted) return;
                  e.preventDefault();
                  setCompanyName(prettyCompanyName(pasted));
                }}
                className="input"
                placeholder="e.g., Google, Microsoft"
                disabled={loading}
                required
              />
              <p className="text-xs text-gray-500 mt-1">Required. Used to check for duplicate applications</p>
            </div>
            <div>
              <label className="label">Job Posting URL (Optional)</label>
              <input
                type="url"
                value={jdLink}
                onChange={(e) => setJdLink(e.target.value)}
                className="input"
                placeholder="https://example.com/job-posting"
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => handleGenerate(false)}
              disabled={loading || !jobDescription.trim()}
              className="btn btn-primary px-6"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate Resume & Cover Letter
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handlePreview}
              disabled={loading || !jobDescription.trim()}
              className="btn btn-secondary"
            >
              Preview Content
            </button>
          </div>
        </div>
      )}

      {/* Preview Section */}
      {preview && !result && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">CV Preview</h2>
            <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="prose prose-sm max-w-none">
            {/* Summary */}
            {preview.summary && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Professional Summary</h3>
                <p className="text-gray-700">{preview.summary}</p>
              </div>
            )}

            {previewSkillLines(preview.skills).length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Skills</h3>
                <div className="space-y-2">
                  {previewSkillLines(preview.skills).map((skill, idx) => (
                    <p key={idx} className="text-gray-700 text-sm">{skill}</p>
                  ))}
                </div>
              </div>
            )}

            {preview.experience?.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Experience</h3>
                {preview.experience.map((exp, idx) => (
                  <div key={idx} className="mb-4 last:mb-0">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold text-gray-900">{exp.position}</h4>
                        <p className="text-gray-600">{exp.company}</p>
                      </div>
                      <span className="text-sm text-gray-500">{exp.period}</span>
                    </div>
                    {exp.summary && (
                      <p className="mt-1 text-sm text-gray-600 italic">{exp.summary}</p>
                    )}
                    {previewExperienceBullets(exp).length > 0 && (
                      <ul className="mt-2 space-y-1 text-gray-700">
                        {previewExperienceBullets(exp).map((ach, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-primary-500 mt-1">•</span>
                            {ach}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Education */}
            {preview.education?.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Education</h3>
                {preview.education.map((edu, idx) => (
                  <div key={idx} className="mb-2 last:mb-0">
                    <h4 className="font-semibold text-gray-900">{edu.degree}</h4>
                    <p className="text-gray-600">{edu.institution} • {edu.graduation}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Certifications */}
            {preview.certifications?.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Certifications</h3>
                <ul className="space-y-1">
                  {preview.certifications.map((cert, idx) => (
                    <li key={idx} className="text-gray-700">• {cert}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100">
            <p className="text-sm text-gray-500 mb-4">
              Happy with this content? Click "Generate CV" to create downloadable documents.
            </p>
            <button
              type="button"
              onClick={() => handleGenerate(false)}
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? 'Generating...' : 'Generate CV Documents'}
            </button>
          </div>
        </div>
      )}

      {/* Tips */}
      {!result && !preview && (
        <div className="card p-6 bg-blue-50 border-blue-200">
          <h3 className="font-semibold text-blue-800 mb-2">💡 Tips for best results</h3>
          <ul className="text-blue-700 space-y-1 text-sm">
            <li>• Include the complete job description with all requirements</li>
            <li>• Make sure your profile has detailed employment history and skills</li>
            <li>• The AI will highlight your most relevant experiences for this specific role</li>
            <li>• Generated CVs are saved to your history for future reference</li>
          </ul>
        </div>
      )}
    </div>
  );
}
