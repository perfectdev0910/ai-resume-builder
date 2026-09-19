import { useRef, useState } from 'react';
import { cvAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import CompanySearch from '../components/CompanySearch';
import QuestionAnswers from '../components/QuestionAnswers';
import StylePicker from '../components/StylePicker';

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
  const [template, setTemplate] = useState('classic');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
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
      const response = await cvAPI.generate(jobDescription, jdLink, normalizedCompany, { force, template });
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

  const handleReset = () => {
    setJobDescription('');
    setJdLink('');
    setCompanyName('');
    setResult(null);
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
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
              <button
                onClick={() => {
                  setShowDuplicateModal(false);
                  setJobDescription('');
                  setJdLink('');
                  setCompanyName('');
                  setError('');
                }}
                className="btn btn-secondary"
              >
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

      {/* Two columns: CV generation on the left, application questions on the right */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      <div className="space-y-6 min-w-0">
        {/* Input Form */}
        {!result && (
          <div className="card p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CompanySearch
                value={companyName}
                onChange={setCompanyName}
                disabled={loading}
              />
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

            <StylePicker value={template} onChange={setTemplate} disabled={loading} />

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
            </div>
          </div>
        )}

        {/* Tips */}
        {!result && (
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

      {/* Application questions answered by AI */}
      <div className="min-w-0 xl:sticky xl:top-4">
        <QuestionAnswers
          jobDescription={jobDescription}
          companyName={result?.application?.companyName || companyName}
          jobTitle={result?.application?.jobTitle || ''}
        />
      </div>
      </div>
    </div>
  );
}
