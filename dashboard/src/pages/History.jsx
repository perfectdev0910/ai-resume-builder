import { useState, useEffect } from 'react';
import { applicationsAPI, cvAPI } from '../utils/api';
import { formatInTimeZone, resolveTimeZone } from '../utils/timezone';
import { useAuth } from '../contexts/AuthContext';

// Helper to sanitize filename
const sanitizeFilename = (name) => name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').trim();


// Download helper function that includes auth token
const downloadFile = async (applicationId, fileType, docType) => {
  try {
    if (!applicationId) {
      console.error('Missing application ID');
      return;
    }

    let url;

    if (docType === 'resume') {
      url = fileType === 'docx'
        ? cvAPI.downloadDocUrl(applicationId)
        : cvAPI.downloadPdfUrl(applicationId);
    } else if (docType === 'cover') {
      url = fileType === 'docx'
        ? cvAPI.downloadCoverLetterDocUrl(applicationId)
        : cvAPI.downloadCoverLetterPdfUrl(applicationId);
    }

    console.log('FINAL URL:', url);

    const token = localStorage.getItem('authToken');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Download failed:', text);
      throw new Error('Download failed');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${docType}.${fileType}`;
    document.body.appendChild(a);
    a.click();
    a.remove();

  } catch (err) {
    console.error(err);
  }
};

export default function History() {
  const { user } = useAuth();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [filter, setFilter] = useState('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const [excludeLinkedIn, setExcludeLinkedIn] = useState(true);
  const userTimezone = resolveTimeZone(user?.timezone || 'UTC');

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
      
      // Safely handle response data
      const apps = response.data?.applications || [];
      setApplications(Array.isArray(apps) ? apps : []);
      setPagination(prev => ({
        ...prev,
        total: response.data?.pagination?.total || 0,
        totalPages: response.data?.pagination?.totalPages || 1
      }));
    } catch (error) {
      console.error('Failed to fetch applications:', error);
      setApplications([]);
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

  /* ---- Excel export of the chosen date range ---- */

  // The API names the file; fall back only if the header is missing.
  const filenameFrom = (disposition) => {
    const match = /filename="?([^"]+)"?/i.exec(disposition || '');
    return match ? match[1] : 'applications.xlsx';
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportNote('');
    try {
      const params = {};
      if (dateRange.start) params.startDate = dateRange.start;
      if (dateRange.end) params.endDate = dateRange.end;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      if (excludeLinkedIn) params.excludeLinkedIn = 'true';

      const response = await applicationsAPI.exportExcel(params);
      const rows = Number(response.headers['x-row-count'] || 0);
      if (!rows) {
        setExportNote('No applications in that range — nothing to download.');
        return;
      }

      const url = URL.createObjectURL(new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFrom(response.headers['content-disposition']);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setExportNote(rows >= 5000
        ? `Downloaded 5000 applications — the export is capped, so narrow the dates for the rest.`
        : `Downloaded ${rows} application${rows === 1 ? '' : 's'}.`);
    } catch (error) {
      // With responseType 'blob' the error body is a Blob, so read it back as text.
      let message = 'Export failed.';
      try {
        const body = error.response?.data;
        const text = body instanceof Blob ? await body.text() : '';
        if (text) message = JSON.parse(text).error || message;
      } catch {
        // keep the generic message
      }
      setExportNote(message);
    } finally {
      setExporting(false);
    }
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

        {/* Export of whatever the filters above select */}
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-3">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn btn-secondary py-1.5 text-sm disabled:opacity-50"
            title="Download the selected date range as an Excel file"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting ? 'Preparing…' : 'Download Excel'}
          </button>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={excludeLinkedIn}
              onChange={e => setExcludeLinkedIn(e.target.checked)}
              className="rounded border-gray-300"
            />
            Exclude LinkedIn jobs
          </label>

          <span className="text-xs text-gray-500">
            {dateRange.start || dateRange.end
              ? `${dateRange.start || 'the beginning'} to ${dateRange.end || 'today'}`
              : 'All dates — pick a range above to narrow it'}
            {searchQuery.trim() ? ` · company contains “${searchQuery.trim()}”` : ''}
          </span>

          {exportNote && <span className="text-xs text-gray-600 ml-auto">{exportNote}</span>}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>Showing {applications?.length || 0} of {pagination?.total || 0} applications</span>
        <span className="text-xs">Timezone: {userTimezone}</span>
      </div>

      {/* Applications List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      ) : (applications && applications.length > 0) ? (
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
                        {formatInTimeZone(app.appliedAt, userTimezone, 'MMM d, yyyy h:mm a')}
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
                    <button
                      onClick={() => downloadFile(app.id, 'docx', 'resume')}
                      className="btn btn-secondary py-1 px-2 text-xs"
                      title="Download Resume DOCX"
                    >
                      DOCX
                    </button>
                    <button
                      onClick={() => downloadFile(app.id, 'pdf', 'resume')}
                      className="btn btn-secondary py-1 px-2 text-xs"
                      title="Download Resume PDF"
                    >
                      PDF
                    </button>
                  </div>
                  
                  {/* Cover Letter Downloads */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16">Cover:</span>
                    <button
                      onClick={() => downloadFile(app.id, 'docx', 'cover')}
                      className="btn btn-secondary py-1 px-2 text-xs"
                      title="Download Cover Letter DOCX"
                    >
                      DOCX
                     </button>
                    <button
                      onClick={() => downloadFile(app.id, 'pdf', 'cover')}
                      className="btn btn-secondary py-1 px-2 text-xs"
                      title="Download Cover Letter PDF"
                    >
                      PDF
                    </button>
                  </div>
                  
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