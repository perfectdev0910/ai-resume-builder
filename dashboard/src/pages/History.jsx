import { useState, useEffect } from 'react';
import { applicationsAPI } from '../utils/api';
import { format, parseISO } from 'date-fns';
import { toZonedTime, format as formatTz } from 'date-fns-tz';
import { useAuth } from '../contexts/AuthContext';

// Helper to sanitize filename
const sanitizeFilename = (name) => name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').trim();

export default function History() {
  const { user } = useAuth();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [filter, setFilter] = useState('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [userTimezone, setUserTimezone] = useState('UTC');

  useEffect(() => {
    fetchApplications();
  }, [pagination.page, filter]);

  const fetchApplications = async (search = searchQuery) => {
    setLoading(true);
    try {
      const params = { page: pagination.page, limit: 10 };
      
      if (filter !== 'all' && filter !== 'custom') {
        params.period = filter;
      } else if (filter === 'custom' && dateRange.start && dateRange.end) {
        params.startDate = dateRange.start;
        params.endDate = dateRange.end;
      }

      // Add search parameter for company name
      if (search && search.trim()) {
        params.search = search.trim();
      }

      const response = await applicationsAPI.getAll(params);
      setApplications(response.data.applications);
      setPagination(prev => ({
        ...prev,
        total: response.data.pagination.total,
        totalPages: response.data.pagination.totalPages
      }));
      // Set user timezone from response
      if (response.data.userTimezone) {
        setUserTimezone(response.data.userTimezone);
      }
    } catch (error) {
      console.error('Failed to fetch applications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this application?')) return;
    try {
      await applicationsAPI.delete(id);
      setApplications(prev => prev.filter(app => app.id !== id));
    } catch (error) {
      console.error('Failed to delete application:', error);
    }
  };

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleDateRangeSearch = () => {
    if (dateRange.start && dateRange.end) {
      setFilter('custom');
      setPagination(prev => ({ ...prev, page: 1 }));
      fetchApplications();
    }
  };

  const handleCompanySearch = (e) => {
    e.preventDefault();
    setPagination(prev => ({ ...prev, page: 1 }));
    fetchApplications(searchQuery);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setPagination(prev => ({ ...prev, page: 1 }));
    fetchApplications('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Application History</h1>
        <p className="text-gray-500 mt-1">View and manage your past CV generations</p>
      </div>

      {/* Company Search */}
      <div className="card p-4">
        <form onSubmit={handleCompanySearch} className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input py-2 pl-10"
              placeholder="Search by company name..."
            />
            <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button type="submit" className="btn btn-primary py-2">
            Search
          </button>
          {searchQuery && (
            <button type="button" onClick={handleClearSearch} className="btn btn-secondary py-2">
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-2">
            {['all', 'daily', 'weekly', 'monthly'].map(f => (
              <button
                key={f}
                onClick={() => handleFilterChange(f)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === f
                    ? 'bg-primary-100 text-primary-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <input
              type="date"
              value={dateRange.start}
              onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="input py-1.5 text-sm"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="input py-1.5 text-sm"
            />
            <button onClick={handleDateRangeSearch} className="btn btn-secondary py-1.5 text-sm">
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>Showing {applications.length} of {pagination.total} applications</span>
        <span className="text-xs">Timezone: {userTimezone}</span>
      </div>

      {/* Applications List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      ) : applications.length > 0 ? (
        <div className="space-y-4">
          {applications.map(app => (
            <div key={app.id} className="card p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex gap-4">
                  <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{app.jobTitle || 'Unknown Position'}</h3>
                    <p className="text-gray-600">{app.companyName || 'Unknown Company'}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {(() => {
                          const utcDate = app.appliedAt.endsWith('Z') ? parseISO(app.appliedAt) : parseISO(app.appliedAt + 'Z');
                          const zonedDate = toZonedTime(utcDate, userTimezone);
                          return formatTz(zonedDate, 'MMM d, yyyy h:mm a', { timeZone: userTimezone });
                        })()}
                      </span>
                      {app.jdLink && (
                        <a
                          href={app.jdLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-primary-600 hover:text-primary-700"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          Job Link
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {/* Resume Downloads */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16">Resume:</span>
                    {app.cvDocUrl && (
                      <a
                        href={app.cvDocUrl}
                        download={`${sanitizeFilename(user?.full_name || 'Resume')}_Resume.docx`}
                        className="btn btn-secondary py-1 px-2 text-xs"
                        title="Download Resume DOCX"
                      >
                        DOCX
                      </a>
                    )}
                    {app.cvPdfUrl && (
                      <a
                        href={app.cvPdfUrl}
                        download={`${sanitizeFilename(user?.full_name || 'Resume')}_Resume.pdf`}
                        className="btn btn-secondary py-1 px-2 text-xs"
                        title="Download Resume PDF"
                      >
                        PDF
                      </a>
                    )}
                  </div>
                  
                  {/* Cover Letter Downloads */}
                  {(app.coverLetterDocUrl || app.coverLetterPdfUrl) && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-16">Cover:</span>
                      {app.coverLetterDocUrl && (
                        <a
                          href={app.coverLetterDocUrl}
                          download={`${sanitizeFilename(user?.full_name || 'Cover_Letter')}_Cover_Letter.docx`}
                          className="btn btn-secondary py-1 px-2 text-xs"
                          title="Download Cover Letter DOCX"
                        >
                          DOCX
                        </a>
                      )}
                      {app.coverLetterPdfUrl && (
                        <a
                          href={app.coverLetterPdfUrl}
                          download={`${sanitizeFilename(user?.full_name || 'Cover_Letter')}_Cover_Letter.pdf`}
                          className="btn btn-secondary py-1 px-2 text-xs"
                          title="Download Cover Letter PDF"
                        >
                          PDF
                        </a>
                      )}
                    </div>
                  )}
                  
                  {/* Delete Button */}
                  <button
                    onClick={() => handleDelete(app.id)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors self-end"
                    title="Delete"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="btn btn-secondary py-2 px-4"
              >
                Previous
              </button>
              <span className="text-gray-600">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
                className="btn btn-secondary py-2 px-4"
              >
                Next
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No applications found</h3>
          <p className="text-gray-500 mb-4">
            {filter === 'all' 
              ? "You haven't generated any CVs yet. Start by generating your first tailored CV!"
              : `No applications found for the selected time period.`
            }
          </p>
        </div>
      )}
    </div>
  );
}
