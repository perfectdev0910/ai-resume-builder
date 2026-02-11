import { useState } from 'react';
import { cvAPI, applicationsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

// Helper to sanitize filename
const sanitizeFilename = (name) => name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').trim();

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

  const checkDuplicate = async () => {
    if (!companyName.trim()) return false;
    try {
      const response = await applicationsAPI.checkDuplicate(companyName);
      return response.data.isDuplicate;
    } catch {
      return false;
    }
  };

  const handleGenerate = async (skipDuplicateCheck = false) => {
    if (!jobDescription.trim()) {
      setError('Please enter a job description');
      return;
    }

    if (!companyName.trim()) {
      setError('Company name is required');
      return;
    }

    // Check for duplicate application
    if (!skipDuplicateCheck && companyName.trim()) {
      const isDuplicate = await checkDuplicate();
      if (isDuplicate) {
        setShowDuplicateModal(true);
        return;
      }
    }

    setLoading(true);
    setError('');
    setResult(null);
    setShowDuplicateModal(false);

    try {
      const response = await cvAPI.generate(jobDescription, jdLink, companyName);
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate documents. Please try again.');
    } finally {
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
              You have already applied to <strong>{companyName}</strong> in the last 2 weeks. Are you sure you want to proceed?
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
                  <a
                    href={result.application?.cvDocUrl}
                    download={`${fullName}_Resume.docx`}
                    className="btn bg-green-600 text-white hover:bg-green-700"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    DOCX
                  </a>
                  <a
                    href={result.application?.cvPdfUrl}
                    download={`${fullName}_Resume.pdf`}
                    className="btn bg-white text-green-700 border border-green-300 hover:bg-green-50"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    PDF
                  </a>
                </div>
              </div>
              
              {/* Cover Letter Downloads */}
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-green-800 mb-2">Cover Letter</h4>
                <div className="flex gap-3">
                  <a
                    href={result.application?.coverLetterDocUrl}
                    download={`${fullName}_Cover_Letter.docx`}
                    className="btn bg-green-600 text-white hover:bg-green-700"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    DOCX
                  </a>
                  <a
                    href={result.application?.coverLetterPdfUrl}
                    download={`${fullName}_Cover_Letter.pdf`}
                    className="btn bg-white text-green-700 border border-green-300 hover:bg-green-50"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    PDF
                  </a>
                </div>
              </div>
              
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
              onClick={() => handleGenerate()}
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

            {/* Skills */}
            {preview.skills?.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Skills</h3>
                <div className="flex flex-wrap gap-2">
                  {preview.skills.map((skill, idx) => (
                    <span key={idx} className="px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Experience */}
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
                    {exp.achievements?.length > 0 && (
                      <ul className="mt-2 space-y-1 text-gray-700">
                        {exp.achievements.map((ach, i) => (
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
            <button onClick={handleGenerate} disabled={loading} className="btn btn-primary">
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
