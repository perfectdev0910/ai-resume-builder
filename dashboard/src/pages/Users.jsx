import { useState, useEffect } from 'react';
import { usersAPI, applicationsAPI } from '../utils/api';
import { format } from 'date-fns';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function Users() {
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('users');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [registerForm, setRegisterForm] = useState({
    email: '',
    password: '',
    full_name: '',
    phone_number: '',
    role: 'user'
  });
  const [registerLoading, setRegisterLoading] = useState(false);
  
  // Stats and filter state
  const [adminStats, setAdminStats] = useState(null);
  const [period, setPeriod] = useState('all');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [filteredApplications, setFilteredApplications] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    fetchStats();
    fetchFilteredApplications();
  }, [period, selectedUserId]);

  const fetchData = async () => {
    try {
      const [usersRes, appsRes, profilesRes] = await Promise.all([
        usersAPI.getAllUsers(),
        applicationsAPI.getAllAdmin(),
        usersAPI.getAllProfiles()
      ]);
      setUsers(usersRes.data.users);
      setApplications(appsRes.data.applications);
      setProfiles(profilesRes.data.profiles);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setMessage({ type: 'error', text: 'Failed to load data' });
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const params = { period };
      if (selectedUserId) params.userId = selectedUserId;
      const res = await usersAPI.getAdminStats(params);
      setAdminStats(res.data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchFilteredApplications = async () => {
    try {
      const params = { period, limit: 50 };
      if (selectedUserId) params.userId = selectedUserId;
      const res = await usersAPI.getAdminApplications(params);
      setFilteredApplications(res.data.applications);
    } catch (error) {
      console.error('Failed to fetch filtered applications:', error);
    }
  };

  const handleApproveUser = async (userId) => {
    try {
      await usersAPI.approveUser(userId);
      setUsers(prev => prev.map(u => 
        u.id === userId ? { ...u, status: 'active' } : u
      ));
      setMessage({ type: 'success', text: 'User approved successfully' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to approve user' });
    }
  };

  const handleRejectUser = async (userId) => {
    if (!confirm('Are you sure you want to reject this user?')) return;
    try {
      await usersAPI.rejectUser(userId);
      setUsers(prev => prev.map(u => 
        u.id === userId ? { ...u, status: 'rejected' } : u
      ));
      setMessage({ type: 'success', text: 'User rejected' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to reject user' });
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await usersAPI.updateUserRole(userId, newRole);
      setUsers(prev => prev.map(u => 
        u.id === userId ? { ...u, role: newRole } : u
      ));
      setMessage({ type: 'success', text: 'User role updated' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update role' });
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm('Are you sure you want to delete this user? This will also delete all their applications.')) return;
    try {
      await usersAPI.deleteUser(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
      setProfiles(prev => prev.filter(p => p.user.id !== userId));
      setApplications(prev => prev.filter(a => a.userId !== userId));
      setMessage({ type: 'success', text: 'User deleted successfully' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to delete user' });
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setRegisterLoading(true);
    try {
      const res = await usersAPI.adminRegisterUser(registerForm);
      setUsers(prev => [res.data.user, ...prev]);
      setMessage({ type: 'success', text: 'User registered successfully' });
      setShowRegisterModal(false);
      setRegisterForm({ email: '', password: '', full_name: '', phone_number: '', role: 'user' });
      // Refresh profiles
      const profilesRes = await usersAPI.getAllProfiles();
      setProfiles(profilesRes.data.profiles);
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to register user' });
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleViewProfile = (profile) => {
    setSelectedProfile(profile);
    setShowProfileModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-500 mt-1">Manage users, view all profiles and application history</p>
        </div>
        <button
          onClick={() => setShowRegisterModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Register New User
        </button>
      </div>

      {/* Message */}
      {message.text && (
        <div className={`p-3 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="card p-6">
          <div className="text-3xl font-bold text-gray-900">{users.length}</div>
          <div className="text-gray-500">Total Users</div>
        </div>
        <div className="card p-6">
          <div className="text-3xl font-bold text-yellow-600">{users.filter(u => u.status === 'pending').length}</div>
          <div className="text-gray-500">Pending Approval</div>
        </div>
        <div className="card p-6">
          <div className="text-3xl font-bold text-gray-900">{applications.length}</div>
          <div className="text-gray-500">Total Applications</div>
        </div>
        <div className="card p-6">
          <div className="text-3xl font-bold text-gray-900">
            {users.filter(u => u.role === 'admin').length}
          </div>
          <div className="text-gray-500">Admins</div>
        </div>
        <div className="card p-6">
          <div className="text-3xl font-bold text-gray-900">
            {profiles.filter(p => p.employmentHistory.length > 0).length}
          </div>
          <div className="text-gray-500">Complete Profiles</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Users ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'analytics'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            📊 Analytics
          </button>
          <button
            onClick={() => setActiveTab('profiles')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'profiles'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All Profiles ({profiles.length})
          </button>
          <button
            onClick={() => setActiveTab('applications')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'applications'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All Applications ({applications.length})
          </button>
        </nav>
      </div>

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="card p-4 flex flex-wrap gap-4 items-center">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="input"
              >
                <option value="all">All Time</option>
                <option value="daily">Today</option>
                <option value="weekly">This Week</option>
                <option value="monthly">This Month</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Filter by User</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="input"
              >
                <option value="">All Users</option>
                {users.filter(u => u.role !== 'admin').map(user => (
                  <option key={user.id} value={user.id}>{user.full_name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1"></div>
            <div className="text-right">
              <div className="text-3xl font-bold text-primary-600">{adminStats?.totalApplications || 0}</div>
              <div className="text-sm text-gray-500">Applications ({period === 'all' ? 'All Time' : period})</div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Daily Activity Chart */}
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Application Activity</h3>
              {adminStats?.dailyStats?.length > 0 ? (
                <Line
                  data={{
                    labels: adminStats.dailyStats.map(d => format(new Date(d.date), 'MMM d')).reverse(),
                    datasets: [{
                      label: 'Applications',
                      data: adminStats.dailyStats.map(d => d.count).reverse(),
                      fill: true,
                      borderColor: '#667eea',
                      backgroundColor: 'rgba(102, 126, 234, 0.1)',
                      tension: 0.4
                    }]
                  }}
                  options={{
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true } }
                  }}
                />
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-400">
                  No data for selected period
                </div>
              )}
            </div>

            {/* Weekly Trend */}
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Weekly Trend</h3>
              {adminStats?.weeklyTrend?.length > 0 ? (
                <Bar
                  data={{
                    labels: adminStats.weeklyTrend.map(d => d.day_name),
                    datasets: [{
                      label: 'Applications',
                      data: adminStats.weeklyTrend.map(d => d.count),
                      backgroundColor: '#667eea'
                    }]
                  }}
                  options={{
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true } }
                  }}
                />
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-400">
                  No data for this week
                </div>
              )}
            </div>

            {/* Applications by User */}
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Applications by User</h3>
              {adminStats?.userStats?.filter(u => u.application_count > 0).length > 0 ? (
                <Bar
                  data={{
                    labels: adminStats.userStats.filter(u => u.application_count > 0).slice(0, 10).map(u => u.full_name),
                    datasets: [{
                      label: 'Applications',
                      data: adminStats.userStats.filter(u => u.application_count > 0).slice(0, 10).map(u => u.application_count),
                      backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#30cfd0', '#a8ff78']
                    }]
                  }}
                  options={{
                    responsive: true,
                    indexAxis: 'y',
                    plugins: { legend: { display: false } },
                    scales: { x: { beginAtZero: true } }
                  }}
                />
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-400">
                  No application data
                </div>
              )}
            </div>

            {/* Top Companies */}
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Companies</h3>
              {adminStats?.companyStats?.length > 0 ? (
                <Doughnut
                  data={{
                    labels: adminStats.companyStats.map(c => c.company_name),
                    datasets: [{
                      data: adminStats.companyStats.map(c => c.count),
                      backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#30cfd0', '#a8ff78']
                    }]
                  }}
                  options={{
                    responsive: true,
                    plugins: { legend: { position: 'right' } }
                  }}
                />
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-400">
                  No company data
                </div>
              )}
            </div>
          </div>

          {/* Filtered Applications Table */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Recent Applications</h3>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job Title</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Applied At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredApplications.length > 0 ? filteredApplications.map(app => (
                  <tr key={app.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{app.userName}</div>
                      <div className="text-sm text-gray-500">{app.userEmail}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-900">{app.jobTitle || '-'}</td>
                    <td className="px-6 py-4 text-gray-900">{app.companyName || '-'}</td>
                    <td className="px-6 py-4 text-gray-500">
                      {app.appliedAt ? format(new Date(app.appliedAt), 'MMM d, yyyy h:mm a') : '-'}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="4" className="px-6 py-8 text-center text-gray-400">
                      No applications found for the selected filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                        <span className="text-primary-600 font-semibold">
                          {user.full_name?.charAt(0)?.toUpperCase() || 'U'}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{user.full_name}</div>
                        <div className="text-sm text-gray-500">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {user.phone_number || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      user.status === 'active' ? 'bg-green-100 text-green-700' :
                      user.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                      user.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {user.status || 'active'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      className="text-sm border border-gray-300 rounded px-2 py-1"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(user.created_at), 'MMM d, yyyy')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    <div className="flex gap-2 justify-end">
                      {user.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleApproveUser(user.id)}
                            className="text-green-600 hover:text-green-700 font-medium"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleRejectUser(user.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {user.status !== 'pending' && (
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Profiles Tab */}
      {activeTab === 'profiles' && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Experience</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Education</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Certifications</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Applications</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {profiles.map(profile => (
                <tr key={profile.user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                        <span className="text-primary-600 font-semibold">
                          {profile.user.full_name?.charAt(0)?.toUpperCase() || 'U'}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{profile.user.full_name}</div>
                        <div className="text-sm text-gray-500">{profile.user.email}</div>
                        {profile.user.linkedin_profile && (
                          <a href={profile.user.linkedin_profile} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
                            LinkedIn
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{profile.employmentHistory.length} positions</div>
                    {profile.employmentHistory[0] && (
                      <div className="text-xs text-gray-500">{profile.employmentHistory[0].company}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{profile.education.length} degrees</div>
                    {profile.education[0] && (
                      <div className="text-xs text-gray-500">{profile.education[0].institution}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-900">{profile.certifications.length}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">
                      {profile.applicationCount} applications
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    <button
                      onClick={() => handleViewProfile(profile)}
                      className="text-primary-600 hover:text-primary-700"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {profiles.length === 0 && (
            <div className="p-12 text-center text-gray-400">
              No profiles found
            </div>
          )}
        </div>
      )}

      {/* Applications Tab */}
      {activeTab === 'applications' && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {applications.map(app => (
                <tr key={app.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="font-medium text-gray-900">{app.userName}</div>
                      <div className="text-sm text-gray-500">{app.userEmail}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{app.jobTitle || 'Unknown'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {app.companyName || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(app.appliedAt), 'MMM d, yyyy h:mm a')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      app.status === 'generated' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {app.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {applications.length === 0 && (
            <div className="p-12 text-center text-gray-400">
              No applications found
            </div>
          )}
        </div>
      )}

      {/* Register Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Register New User</h2>
                <button
                  onClick={() => setShowRegisterModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <form onSubmit={handleRegisterSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={registerForm.full_name}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, full_name: e.target.value }))}
                  className="input"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={registerForm.email}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, email: e.target.value }))}
                  className="input"
                  placeholder="john@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                <input
                  type="password"
                  required
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                  className="input"
                  placeholder="••••••••"
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={registerForm.phone_number}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, phone_number: e.target.value }))}
                  className="input"
                  placeholder="+1 234 567 8900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={registerForm.role}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, role: e.target.value }))}
                  className="input"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registerLoading}
                  className="btn-primary flex-1"
                >
                  {registerLoading ? 'Registering...' : 'Register User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Profile Detail Modal */}
      {showProfileModal && selectedProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white p-6 border-b border-gray-200 z-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-primary-600 font-bold text-xl">
                      {selectedProfile.user.full_name?.charAt(0)?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">{selectedProfile.user.full_name}</h2>
                    <p className="text-gray-500">{selectedProfile.user.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Contact Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {selectedProfile.user.phone_number && (
                  <div>
                    <div className="text-xs text-gray-500 uppercase">Phone</div>
                    <div className="text-sm text-gray-900">{selectedProfile.user.phone_number}</div>
                  </div>
                )}
                {selectedProfile.user.address && (
                  <div>
                    <div className="text-xs text-gray-500 uppercase">Address</div>
                    <div className="text-sm text-gray-900">{selectedProfile.user.address}</div>
                  </div>
                )}
                {selectedProfile.user.linkedin_profile && (
                  <div>
                    <div className="text-xs text-gray-500 uppercase">LinkedIn</div>
                    <a href={selectedProfile.user.linkedin_profile} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-500 hover:underline">
                      View Profile
                    </a>
                  </div>
                )}
                {selectedProfile.user.github_link && (
                  <div>
                    <div className="text-xs text-gray-500 uppercase">GitHub</div>
                    <a href={selectedProfile.user.github_link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-500 hover:underline">
                      View Profile
                    </a>
                  </div>
                )}
              </div>

              {/* Employment History */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Employment History ({selectedProfile.employmentHistory.length})</h3>
                {selectedProfile.employmentHistory.length > 0 ? (
                  <div className="space-y-3">
                    {selectedProfile.employmentHistory.map((job, idx) => (
                      <div key={idx} className="bg-gray-50 rounded-lg p-4">
                        <div className="font-medium text-gray-900">{job.position}</div>
                        <div className="text-sm text-gray-600">{job.company} {job.location && `• ${job.location}`}</div>
                        <div className="text-xs text-gray-500">{job.start_date} - {job.end_date || 'Present'}</div>
                        {job.description && <p className="text-sm text-gray-600 mt-2">{job.description}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No employment history added</p>
                )}
              </div>

              {/* Education */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Education ({selectedProfile.education.length})</h3>
                {selectedProfile.education.length > 0 ? (
                  <div className="space-y-3">
                    {selectedProfile.education.map((edu, idx) => (
                      <div key={idx} className="bg-gray-50 rounded-lg p-4">
                        <div className="font-medium text-gray-900">{edu.degree}</div>
                        <div className="text-sm text-gray-600">{edu.institution} {edu.location && `• ${edu.location}`}</div>
                        <div className="text-xs text-gray-500">{edu.graduation_date && `Graduated: ${edu.graduation_date}`} {edu.gpa && `• GPA: ${edu.gpa}`}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No education added</p>
                )}
              </div>

              {/* Certifications */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Certifications ({selectedProfile.certifications.length})</h3>
                {selectedProfile.certifications.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedProfile.certifications.map((cert, idx) => (
                      <span key={idx} className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-full text-sm">
                        {cert.name} {cert.issuer && `(${cert.issuer})`}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No certifications added</p>
                )}
              </div>

              {/* Skills */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Skills ({selectedProfile.skills.length})</h3>
                {selectedProfile.skills.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedProfile.skills.map((skill, idx) => (
                      <span key={idx} className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-sm">
                        {skill.skill_name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No skills added</p>
                )}
              </div>

              {/* Tags */}
              {selectedProfile.tags.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedProfile.tags.map((tag, idx) => (
                      <span key={idx} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-sm">
                        {tag.tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{selectedProfile.applicationCount}</div>
                    <div className="text-xs text-gray-500">Applications</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{selectedProfile.user.experience_years || 0}</div>
                    <div className="text-xs text-gray-500">Years Experience</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{selectedProfile.user.role}</div>
                    <div className="text-xs text-gray-500">Role</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
