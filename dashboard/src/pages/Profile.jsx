import { useState, useEffect } from 'react';
import { usersAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

// Common timezones list
const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland'
];

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [message, setMessage] = useState({ type: '', text: '' });

  // Form states
  const [basicInfo, setBasicInfo] = useState({});
  const [newEmployment, setNewEmployment] = useState({ position: '', company: '', location: '', start_date: '', end_date: '' });
  const [newEducation, setNewEducation] = useState({ degree: '', institution: '', location: '', graduation_date: '', gpa: '' });
  const [newCertification, setNewCertification] = useState({ name: '', issuer: '', date_obtained: '', credly_link: '' });
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await usersAPI.getProfile();
      setProfile(response.data);
      setBasicInfo(response.data.user);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load profile' });
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 3000);
  };

  const handleBasicInfoChange = (e) => {
    setBasicInfo(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSaveBasicInfo = async () => {
    setSaving(true);
    try {
      await usersAPI.updateProfile(basicInfo);
      updateUser(basicInfo);
      showMessage('success', 'Profile updated successfully');
    } catch (error) {
      showMessage('error', 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  // Employment handlers
  const handleAddEmployment = async (e) => {
    e.preventDefault();
    try {
      const response = await usersAPI.addEmployment(newEmployment);
      setProfile(prev => ({
        ...prev,
        employmentHistory: [...prev.employmentHistory, response.data.employment]
      }));
      setNewEmployment({ position: '', company: '', location: '', start_date: '', end_date: '' });
      showMessage('success', 'Employment added');
    } catch (error) {
      showMessage('error', 'Failed to add employment');
    }
  };

  const handleDeleteEmployment = async (id) => {
    if (!confirm('Delete this employment record?')) return;
    try {
      await usersAPI.deleteEmployment(id);
      setProfile(prev => ({
        ...prev,
        employmentHistory: prev.employmentHistory.filter(e => e.id !== id)
      }));
      showMessage('success', 'Employment deleted');
    } catch (error) {
      showMessage('error', 'Failed to delete employment');
    }
  };

  // Education handlers
  const handleAddEducation = async (e) => {
    e.preventDefault();
    try {
      const response = await usersAPI.addEducation(newEducation);
      setProfile(prev => ({
        ...prev,
        education: [...prev.education, response.data.education]
      }));
      setNewEducation({ degree: '', institution: '', location: '', graduation_date: '', gpa: '' });
      showMessage('success', 'Education added');
    } catch (error) {
      showMessage('error', 'Failed to add education');
    }
  };

  const handleDeleteEducation = async (id) => {
    if (!confirm('Delete this education record?')) return;
    try {
      await usersAPI.deleteEducation(id);
      setProfile(prev => ({
        ...prev,
        education: prev.education.filter(e => e.id !== id)
      }));
      showMessage('success', 'Education deleted');
    } catch (error) {
      showMessage('error', 'Failed to delete education');
    }
  };

  // Certification handlers
  const handleAddCertification = async (e) => {
    e.preventDefault();
    try {
      const response = await usersAPI.addCertification(newCertification);
      setProfile(prev => ({
        ...prev,
        certifications: [...prev.certifications, response.data.certification]
      }));
      setNewCertification({ name: '', issuer: '', date_obtained: '', credly_link: '' });
      showMessage('success', 'Certification added');
    } catch (error) {
      showMessage('error', 'Failed to add certification');
    }
  };

  const handleDeleteCertification = async (id) => {
    if (!confirm('Delete this certification?')) return;
    try {
      await usersAPI.deleteCertification(id);
      setProfile(prev => ({
        ...prev,
        certifications: prev.certifications.filter(c => c.id !== id)
      }));
      showMessage('success', 'Certification deleted');
    } catch (error) {
      showMessage('error', 'Failed to delete certification');
    }
  };

  // Tag handlers
  const handleAddTag = async (e) => {
    e.preventDefault();
    if (!newTag.trim()) return;
    try {
      const response = await usersAPI.addTag(newTag.trim());
      setProfile(prev => ({
        ...prev,
        tags: [...(prev.tags || []), response.data.tag]
      }));
      setNewTag('');
      showMessage('success', 'Tag added');
    } catch (error) {
      showMessage('error', 'Failed to add tag');
    }
  };

  const handleDeleteTag = async (id) => {
    try {
      await usersAPI.deleteTag(id);
      setProfile(prev => ({
        ...prev,
        tags: prev.tags.filter(t => t.id !== id)
      }));
      showMessage('success', 'Tag deleted');
    } catch (error) {
      showMessage('error', 'Failed to delete tag');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  const tabs = [
    { id: 'basic', label: 'Basic Info' },
    { id: 'employment', label: 'Employment' },
    { id: 'education', label: 'Education' },
    { id: 'certifications', label: 'Certifications' },
    { id: 'tags', label: 'Tags' }
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-gray-500 mt-1">Complete your profile for better CV generation</p>
      </div>

      {/* Message */}
      {message.text && (
        <div className={`p-3 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Basic Info Tab */}
      {activeTab === 'basic' && (
        <div className="card p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Full Name</label>
              <input type="text" name="full_name" value={basicInfo.full_name || ''} onChange={handleBasicInfoChange} className="input" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" name="email" value={basicInfo.email || ''} disabled className="input bg-gray-50" />
            </div>
            <div>
              <label className="label">Phone Number</label>
              <input type="tel" name="phone_number" value={basicInfo.phone_number || ''} onChange={handleBasicInfoChange} className="input" />
            </div>
            <div>
              <label className="label">Years of Experience</label>
              <input type="number" name="experience_years" value={basicInfo.experience_years || ''} onChange={handleBasicInfoChange} className="input" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Timezone</label>
              <select name="timezone" value={basicInfo.timezone || 'UTC'} onChange={handleBasicInfoChange} className="input">
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Used for displaying log history timestamps</p>
            </div>
            <div>
              <label className="label">Address</label>
              <input type="text" name="address" value={basicInfo.address || ''} onChange={handleBasicInfoChange} className="input" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">LinkedIn Profile</label>
              <input type="url" name="linkedin_profile" value={basicInfo.linkedin_profile || ''} onChange={handleBasicInfoChange} className="input" />
            </div>
            <div>
              <label className="label">GitHub Link</label>
              <input type="url" name="github_link" value={basicInfo.github_link || ''} onChange={handleBasicInfoChange} className="input" />
            </div>
          </div>
          <button onClick={handleSaveBasicInfo} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Employment Tab */}
      {activeTab === 'employment' && (
        <div className="space-y-4">
          {/* Info banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-700">
              <strong>Note:</strong> Job descriptions will be automatically generated by AI based on the position, company, and job requirements. Just provide the basic employment details.
            </p>
          </div>

          {/* Existing Employment */}
          {profile?.employmentHistory?.map(emp => (
            <div key={emp.id} className="card p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-900">{emp.position}</h3>
                  <p className="text-gray-600">{emp.company}</p>
                  <p className="text-sm text-gray-500">{emp.location} • {emp.start_date} - {emp.end_date || 'Present'}</p>
                </div>
                <button onClick={() => handleDeleteEmployment(emp.id)} className="text-red-500 hover:text-red-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          {/* Add New Employment */}
          <div className="card p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Add Employment</h3>
            <form onSubmit={handleAddEmployment} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Position *</label>
                  <input type="text" value={newEmployment.position} onChange={e => setNewEmployment(p => ({ ...p, position: e.target.value }))} className="input" required />
                </div>
                <div>
                  <label className="label">Company *</label>
                  <input type="text" value={newEmployment.company} onChange={e => setNewEmployment(p => ({ ...p, company: e.target.value }))} className="input" required />
                </div>
                <div>
                  <label className="label">Location</label>
                  <input type="text" value={newEmployment.location} onChange={e => setNewEmployment(p => ({ ...p, location: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">Start Date</label>
                  <input type="text" value={newEmployment.start_date} onChange={e => setNewEmployment(p => ({ ...p, start_date: e.target.value }))} className="input" placeholder="e.g., Jan 2020" />
                </div>
                <div>
                  <label className="label">End Date</label>
                  <input type="text" value={newEmployment.end_date} onChange={e => setNewEmployment(p => ({ ...p, end_date: e.target.value }))} className="input" placeholder="Present" />
                </div>
              </div>
              <button type="submit" className="btn btn-primary">Add Employment</button>
            </form>
          </div>
        </div>
      )}

      {/* Education Tab */}
      {activeTab === 'education' && (
        <div className="space-y-4">
          {profile?.education?.map(edu => (
            <div key={edu.id} className="card p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-900">{edu.degree}</h3>
                  <p className="text-gray-600">{edu.institution}</p>
                  <p className="text-sm text-gray-500">{edu.location} • {edu.graduation_date}</p>
                  {edu.gpa && <p className="text-sm text-gray-500">GPA: {edu.gpa}</p>}
                </div>
                <button onClick={() => handleDeleteEducation(edu.id)} className="text-red-500 hover:text-red-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          <div className="card p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Add Education</h3>
            <form onSubmit={handleAddEducation} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Degree *</label>
                  <input type="text" value={newEducation.degree} onChange={e => setNewEducation(p => ({ ...p, degree: e.target.value }))} className="input" required placeholder="e.g., B.S. Computer Science" />
                </div>
                <div>
                  <label className="label">Institution *</label>
                  <input type="text" value={newEducation.institution} onChange={e => setNewEducation(p => ({ ...p, institution: e.target.value }))} className="input" required />
                </div>
                <div>
                  <label className="label">Location</label>
                  <input type="text" value={newEducation.location} onChange={e => setNewEducation(p => ({ ...p, location: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">Graduation Date</label>
                  <input type="text" value={newEducation.graduation_date} onChange={e => setNewEducation(p => ({ ...p, graduation_date: e.target.value }))} className="input" placeholder="e.g., May 2020" />
                </div>
                <div>
                  <label className="label">GPA (Optional)</label>
                  <input type="text" value={newEducation.gpa} onChange={e => setNewEducation(p => ({ ...p, gpa: e.target.value }))} className="input" />
                </div>
              </div>
              <button type="submit" className="btn btn-primary">Add Education</button>
            </form>
          </div>
        </div>
      )}

      {/* Certifications Tab */}
      {activeTab === 'certifications' && (
        <div className="space-y-4">
          {/* Credly Profile Link - displayed at the top */}
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="label">Credly Profile Link</label>
                <input 
                  type="url" 
                  name="credly_profile_link" 
                  value={basicInfo.credly_profile_link || ''} 
                  onChange={handleBasicInfoChange} 
                  className="input" 
                  placeholder="https://www.credly.com/users/yourusername"
                />
                <p className="text-xs text-gray-500 mt-1">This link will appear at the top of your Certifications section on the resume</p>
              </div>
              <button onClick={handleSaveBasicInfo} disabled={saving} className="btn btn-primary ml-4 self-end">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Info banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-700">
              <strong>Note:</strong> Skills will be automatically generated by AI based on your experience and job requirements. You can optionally add a Credly link for verified credentials.
            </p>
          </div>

          {profile?.certifications?.map(cert => (
            <div key={cert.id} className="card p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-900">{cert.name}</h3>
                  {cert.issuer && <p className="text-gray-600">{cert.issuer}</p>}
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    {cert.date_obtained && <span>{cert.date_obtained}</span>}
                    {cert.credly_link && (
                      <a href={cert.credly_link} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700 flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Credly
                      </a>
                    )}
                  </div>
                </div>
                <button onClick={() => handleDeleteCertification(cert.id)} className="text-red-500 hover:text-red-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          <div className="card p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Add Certification</h3>
            <form onSubmit={handleAddCertification} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Certification Name *</label>
                  <input type="text" value={newCertification.name} onChange={e => setNewCertification(p => ({ ...p, name: e.target.value }))} className="input" required />
                </div>
                <div>
                  <label className="label">Issuer</label>
                  <input type="text" value={newCertification.issuer} onChange={e => setNewCertification(p => ({ ...p, issuer: e.target.value }))} className="input" placeholder="e.g., AWS, Microsoft, Google" />
                </div>
                <div>
                  <label className="label">Date Obtained</label>
                  <input type="text" value={newCertification.date_obtained} onChange={e => setNewCertification(p => ({ ...p, date_obtained: e.target.value }))} className="input" placeholder="e.g., Jan 2023" />
                </div>
                <div>
                  <label className="label">Credly Link (Optional)</label>
                  <input type="url" value={newCertification.credly_link} onChange={e => setNewCertification(p => ({ ...p, credly_link: e.target.value }))} className="input" placeholder="https://www.credly.com/badges/..." />
                </div>
              </div>
              <button type="submit" className="btn btn-primary">Add Certification</button>
            </form>
          </div>
        </div>
      )}

      {/* Tags Tab */}
      {activeTab === 'tags' && (
        <div className="space-y-4">
          {/* Info banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-700">
              <strong>Note:</strong> Tags are plain text items that will appear in the "Other" section of your resume. Use them for languages, hobbies, interests, or any additional information.
            </p>
          </div>

          {/* Existing Tags */}
          <div className="card p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Your Tags</h3>
            {profile?.tags && profile.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-4">
                {profile.tags.map(tag => (
                  <span key={tag.id} className="inline-flex items-center gap-1 px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm">
                    {tag.tag}
                    <button onClick={() => handleDeleteTag(tag.id)} className="ml-1 text-primary-400 hover:text-red-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm mb-4">No tags added yet.</p>
            )}

            {/* Add Tag Form */}
            <form onSubmit={handleAddTag} className="flex gap-2">
              <input
                type="text"
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                className="input flex-1"
                placeholder="e.g., Fluent in Spanish, Open Source Contributor, Marathon Runner"
              />
              <button type="submit" className="btn btn-primary" disabled={!newTag.trim()}>
                Add Tag
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
