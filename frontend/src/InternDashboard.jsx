import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API } from './config';
import { useToast, apiError } from './Toast';
import NotFound from './NotFound';

const InternDashboard = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const internId = localStorage.getItem('internId');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState('Dashboard');
  const [menuOpen, setMenuOpen] = useState(false);

  const load = async (background = false) => {
    try {
      const res = await axios.get(`${API}/api/intern/${internId}/dashboard`);
      setData(res.data);
    } catch (err) {
      if (background) return; // stay silent on background refresh failures
      // A 404 means the intern account no longer exists (e.g. it was removed
      // by an admin) — show a dedicated not-found page and clear the stale session.
      if (err.response?.status === 404) {
        setNotFound(true);
        localStorage.removeItem('internId');
        localStorage.removeItem('internName');
      } else {
        setError('Could not load your dashboard.');
        toast.error(apiError(err, 'Could not load your dashboard.'));
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!internId) {
      navigate('/login');
      return;
    }
    load();
    // Auto-sync: quietly refresh so newly assigned tasks, projects and meetings
    // appear without the intern needing to reload the page.
    const id = setInterval(() => load(true), 10000);
    return () => clearInterval(id);
  }, []);

  const updateTask = async (id, status) => {
    try {
      await axios.patch(`${API}/api/tasks/${id}`, { status });
      toast.success(status === 'done' ? 'Task marked done.' : 'Task updated.');
      load();
    } catch (err) {
      toast.error(apiError(err, 'Could not update the task.'));
    }
  };

  const logout = () => {
    localStorage.removeItem('internId');
    localStorage.removeItem('internName');
    navigate('/login');
  };

  if (notFound) {
    return (
      <NotFound
        title="Account not found"
        message="Your intern account no longer exists — it may have been removed by an admin. Please sign in again or contact your team."
        actionLabel="Back to login"
        actionTo="/login"
      />
    );
  }
  if (loading) return <div className="loading">Loading your dashboard…</div>;
  if (error) return <div className="loading">{error}</div>;
  if (!data) return null;

  const { intern, projects, tasks, meetings, memberTeams = [] } = data;
  const newTasks = tasks.filter((t) => t.status === 'todo');
  const ongoing = tasks.filter((t) => t.status === 'in-progress');
  const done = tasks.filter((t) => t.status === 'done');

  const now = new Date();
  const soon = new Date();
  soon.setDate(now.getDate() + 7);
  const dues = tasks
    .filter((t) => t.status !== 'done' && t.dueDate)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const isOverdue = (d) => d && new Date(d) < now;

  const TABS = [
    { key: 'Dashboard', icon: 'dashboard', sub: 'Your overview, deadlines and progress at a glance.' },
    { key: 'Projects', icon: 'folder_open', sub: 'Projects you are currently assigned to.' },
    { key: 'Tasks', icon: 'assignment', sub: 'Track and move your tasks across the board.' },
    { key: 'Team', icon: 'groups', sub: 'Your team and the work you lead.' },
    { key: 'Meetings', icon: 'event', sub: 'Your scheduled interviews and meetings.' },
  ];
  const active = TABS.find((t) => t.key === tab) || TABS[0];

  const stats = [
    { label: 'Projects', value: projects.length, icon: 'folder_open' },
    { label: 'Ongoing tasks', value: ongoing.length, icon: 'autorenew' },
    { label: 'New tasks', value: newTasks.length, icon: 'fiber_new' },
    { label: 'Pending dues', value: dues.length, icon: 'schedule' },
  ];

  const duesPanel = (
    <section className="panel">
      <h3>Upcoming dues</h3>
      {dues.length === 0 && <p className="muted">Nothing due. You're all caught up! 🎉</p>}
      <div className="card-list">
        {dues.map((t) => (
          <div className={`mini-card ${isOverdue(t.dueDate) ? 'overdue' : ''}`} key={t._id}>
            <div>
              <strong>{t.title}</strong>
              <div className="muted small">{t.project?.name || '—'}</div>
            </div>
            <div className="due-tag">
              {isOverdue(t.dueDate) ? 'Overdue · ' : 'Due '}
              {new Date(t.dueDate).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const projectsPanel = (
    <section className="panel">
      <h3>My projects</h3>
      {projects.length === 0 && <p className="muted">No projects assigned yet.</p>}
      <div className="card-list">
        {projects.map((p) => (
          <div className="mini-card column" key={p._id}>
            <div className="mini-card-head">
              <strong>{p.name}</strong>
              <span className="status-pill" style={{ background: '#2f6fb5' }}>{p.status}</span>
            </div>
            {p.description && <p className="muted small">{p.description}</p>}
            <div className="progress-bar"><span style={{ width: `${p.progress}%` }} /></div>
            <div className="muted small">
              {p.progress}% · {p.doneTasks}/{p.totalTasks} tasks
              {p.deadline ? ` · due ${new Date(p.deadline).toLocaleDateString()}` : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const memberTeamsPanel = memberTeams.length > 0 && (
    <section className="panel">
      <h3>My team</h3>
      <div className="card-list">
        {memberTeams.map((tm) => (
          <div className="mini-card column" key={tm._id}>
            <div className="mini-card-head">
              <strong>{tm.name}</strong>
              {tm.leader && <span className="status-pill" style={{ background: '#7b2fb5' }}>Leader: {tm.leader.name}</span>}
            </div>
            {tm.description && <p className="muted small">{tm.description}</p>}
            <div className="member-chips">
              {(tm.memberDetails || []).map((m) => (
                <span className={`member-chip ${m.internId === tm.leaderId ? 'is-leader' : ''}`} key={m.internId}>
                  {m.name}{m.role ? ` · ${m.role}` : ''}{m.internId === tm.leaderId ? ' 👑' : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const tasksPanel = (
    <section className="panel">
      <h3>My tasks</h3>
      <div className="task-board">
        {[
          { key: 'todo', label: 'New', list: newTasks, next: 'in-progress', nextLabel: 'Start' },
          { key: 'in-progress', label: 'Ongoing', list: ongoing, next: 'done', nextLabel: 'Mark done' },
          { key: 'done', label: 'Completed', list: done, next: null },
        ].map((col) => (
          <div className="task-col" key={col.key}>
            <h4>{col.label} ({col.list.length})</h4>
            {col.list.length === 0 && <p className="muted small">—</p>}
            {col.list.map((t) => (
              <div className="task-item" key={t._id}>
                <strong>{t.title}</strong>
                {t.description && <p className="muted small">{t.description}</p>}
                <div className="muted small">{t.project?.name || ''}{t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString()}` : ''}</div>
                {col.next && (
                  <button className="btn-mini approve" onClick={() => updateTask(t._id, col.next)}>{col.nextLabel}</button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );

  // Completed meetings drop off the list once the admin marks them done.
  const upcomingMeetings = meetings.filter((m) => m.status !== 'completed');
  const meetingsPanel = (
    <section className="panel">
      <h3>My meetings</h3>
      {upcomingMeetings.length === 0 && <p className="muted">No meetings scheduled.</p>}
      <div className="card-list">
        {upcomingMeetings.map((m) => (
          <div className="mini-card column" key={m._id}>
            <strong>{m.title}</strong>
            <div className="muted small">
              {m.attendeeName ? `${m.attendeeName} · ` : ''}{new Date(m.scheduledAt).toLocaleString()}
            </div>
            {m.link && (
              <div className="meeting-actions">
                <a className="btn-mini meet-btn" href={m.link} target="_blank" rel="noreferrer">
                  <span className="material-symbols-outlined">videocam</span>Join Meet
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div className="admin-shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-lockup">
            <span className="brand-mark">GS</span>
            <div className="brand-text">
              <span className="brand-name">Genius Softtech</span>
              <span className="brand-sub">Intern Portal</span>
            </div>
          </div>
          <button className="hamburger" onClick={() => setMenuOpen(!menuOpen)}>
            <span className="material-symbols-outlined">{menuOpen ? 'close' : 'menu'}</span>
          </button>
        </div>

        <nav className="side-nav">
          <span className="side-nav-label">Menu</span>
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'side-link active' : 'side-link'}
              onClick={() => { setTab(t.key); setMenuOpen(false); }}
            >
              <span className="material-symbols-outlined">{t.icon}</span>
              <span>{t.key}</span>
            </button>
          ))}
        </nav>

        <button className="side-logout" onClick={logout}>
          <span className="material-symbols-outlined">logout</span>
          <span>Log out</span>
        </button>
      </aside>

      <main className="admin-main">
        <header className="topbar">
          <div>
            <h1>{tab === 'Dashboard' ? `Hi, ${intern.name.split(' ')[0]} 👋` : active.key}</h1>
            <p className="muted">{active.sub}</p>
          </div>
          <div className="topbar-meta">
            <span className="material-symbols-outlined">badge</span>
            {intern.role} Intern · {intern.internId}
          </div>
        </header>

        {tab === 'Dashboard' && (
          <div className="stat-row">
            {stats.map((s) => (
              <div className="stat-card" key={s.label}>
                <span className="stat-icon material-symbols-outlined">{s.icon}</span>
                <div>
                  <div className="stat-value">{s.value}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="tab-content">
          {tab === 'Dashboard' && (<>{duesPanel}{projectsPanel}</>)}
          {tab === 'Projects' && projectsPanel}
          {tab === 'Tasks' && tasksPanel}
          {tab === 'Team' && (
            <>
              {memberTeamsPanel}
              {memberTeams.length === 0 && (
                <p className="muted panel">You're not part of a team yet. Your admin can add you to one.</p>
              )}
            </>
          )}
          {tab === 'Meetings' && meetingsPanel}
        </div>
      </main>
    </div>
  );
};

export default InternDashboard;
