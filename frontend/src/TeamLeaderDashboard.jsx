import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API } from './config';
import { useToast, apiError } from './Toast';
import { isBlank } from './validation';
import NotFound from './NotFound';

const TeamLeaderDashboard = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const internId = localStorage.getItem('internId');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState('Dashboard');

  const [assignForm, setAssignForm] = useState({ internId: '', title: '', description: '', project: '', dueDate: '' });
  const [assignErrors, setAssignErrors] = useState({});

  // Meeting form: scope 'team' invites everyone, 'members' a chosen subset.
  const [meetForm, setMeetForm] = useState({ title: '', scope: 'team', teamId: '', memberIds: [], scheduledAt: '', link: '', notes: '' });
  const [meetErrors, setMeetErrors] = useState({});

  const load = async (background = false) => {
    try {
      const res = await axios.get(`${API}/api/team-leader/${internId}/dashboard`);
      setData(res.data);
    } catch (err) {
      if (background) return;
      if (err.response?.status === 404) {
        // No longer a team leader (demoted / removed) — fall back to login.
        setNotFound(true);
        localStorage.removeItem('internId');
        localStorage.removeItem('internName');
        localStorage.removeItem('isTeamLeader');
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
    const id = setInterval(() => load(true), 10000);
    return () => clearInterval(id);
  }, []);

  const assignTask = async (e) => {
    e.preventDefault();
    const errs = {};
    if (isBlank(assignForm.internId)) errs.internId = 'Choose a member to assign.';
    if (isBlank(assignForm.title)) errs.title = 'Task title is required.';
    setAssignErrors(errs);
    if (Object.keys(errs).length) { toast.error('Please fix the highlighted fields.'); return; }
    try {
      await axios.post(`${API}/api/tasks`, { ...assignForm, assignedBy: internId });
      setAssignForm({ internId: '', title: '', description: '', project: '', dueDate: '' });
      setAssignErrors({});
      toast.success('Task assigned.');
      load();
    } catch (err) {
      toast.error(apiError(err, 'Could not assign task.'));
    }
  };

  const setViceLeader = async (teamId, viceLeaderId) => {
    try {
      await axios.patch(`${API}/api/teams/${teamId}`, { viceLeaderId });
      toast.success('Vice Team Leader updated.');
      load();
    } catch (err) {
      toast.error(apiError(err, 'Could not update vice leader.'));
    }
  };

  const scheduleMeeting = async (e) => {
    e.preventDefault();
    const errs = {};
    if (isBlank(meetForm.title)) errs.title = 'Meeting title is required.';
    if (meetForm.scope === 'team' && isBlank(meetForm.teamId)) errs.teamId = 'Choose a team.';
    if (meetForm.scope === 'members' && meetForm.memberIds.length === 0) errs.memberIds = 'Select at least one member.';
    if (isBlank(meetForm.scheduledAt)) errs.scheduledAt = 'Pick a date & time.';
    else {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      if (new Date(meetForm.scheduledAt) < startOfToday) errs.scheduledAt = 'Pick today or a later day.';
    }
    setMeetErrors(errs);
    if (Object.keys(errs).length) { toast.error('Please fix the highlighted fields.'); return; }
    try {
      await axios.post(`${API}/api/meetings`, {
        title: meetForm.title,
        scope: meetForm.scope,
        teamId: meetForm.scope === 'team' ? meetForm.teamId : undefined,
        memberIds: meetForm.scope === 'members' ? meetForm.memberIds : undefined,
        scheduledAt: meetForm.scheduledAt,
        link: meetForm.link,
        notes: meetForm.notes,
        createdBy: internId,
      });
      setMeetForm({ title: '', scope: 'team', teamId: '', memberIds: [], scheduledAt: '', link: '', notes: '' });
      setMeetErrors({});
      toast.success('Meeting scheduled — invites emailed.');
      load();
    } catch (err) {
      toast.error(apiError(err, 'Could not schedule meeting.'));
    }
  };

  const logout = () => {
    localStorage.removeItem('internId');
    localStorage.removeItem('internName');
    localStorage.removeItem('isTeamLeader');
    navigate('/login');
  };

  if (notFound) {
    return (
      <NotFound
        title="Team leader access ended"
        message="You're no longer registered as a team leader — your role may have changed. Please sign in again."
        actionLabel="Back to login"
        actionTo="/login"
      />
    );
  }
  if (loading) return <div className="loading">Loading your dashboard…</div>;
  if (error) return <div className="loading">{error}</div>;
  if (!data) return null;

  const { leader, ledTeams = [], members = [], leaderProjects = [], memberTasks = [], meetings = [], stats = {} } = data;

  const toggleMeetMember = (id) => {
    setMeetForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(id) ? f.memberIds.filter((m) => m !== id) : [...f.memberIds, id],
    }));
  };

  const TABS = [
    { key: 'Dashboard', icon: 'dashboard', sub: 'Your team at a glance — members, projects and workload.' },
    { key: 'Projects', icon: 'folder_open', sub: 'Projects assigned to you to deliver with your team.' },
    { key: 'Tasks', icon: 'assignment', sub: 'Assign project work to members by their role.' },
    { key: 'Meetings', icon: 'event', sub: 'Schedule meetings with your whole team or specific members.' },
    { key: 'Members', icon: 'groups', sub: 'Your team members and their roles.' },
  ];
  const active = TABS.find((t) => t.key === tab) || TABS[0];

  const now = new Date();
  const isOverdue = (d) => d && new Date(d) < now;

  const statCards = [
    { label: 'Total members', value: stats.totalMembers || 0, icon: 'groups' },
    { label: 'Projects', value: stats.totalProjects || 0, icon: 'folder_open' },
    { label: 'Tasks assigned', value: stats.totalMemberTasks || 0, icon: 'assignment' },
    { label: 'Pending', value: stats.pendingMemberTasks || 0, icon: 'schedule' },
    { label: 'Completed', value: stats.completedMemberTasks || 0, icon: 'task_alt' },
  ];

  // Quick lookup: member name/role by intern ID, for labelling tasks.
  const memberById = {};
  members.forEach((m) => { memberById[m.internId] = m; });

  const upcomingMeetings = meetings.filter((m) => m.status !== 'completed');

  const dashboardPanel = (
    <>
      <section className="panel">
        <h3>Your teams</h3>
        {ledTeams.length === 0 && <p className="muted">You don't lead any team yet. An admin can assign you one.</p>}
        <div className="card-list">
          {ledTeams.map((tm) => (
            <div className="mini-card column" key={tm._id}>
              <strong>{tm.name}</strong>
              {tm.description && <p className="muted small">{tm.description}</p>}
              <div className="team-leader-row" style={{ marginTop: '0.25rem', marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '1rem', color: '#666' }}>stars</span>
                <span className="muted small">Vice Leader:</span>
                <select value={tm.viceLeaderId || ''} onChange={(e) => setViceLeader(tm._id, e.target.value)} style={{ padding: '0.1rem', fontSize: '0.8rem' }}>
                  <option value="">Unassigned</option>
                  {(tm.memberDetails || []).filter(m => m.internId !== leader.internId).map((i) => <option key={i.internId} value={i.internId}>{i.name}</option>)}
                </select>
              </div>
              <div className="member-chips">
                {(tm.memberDetails || []).filter((m) => m.internId !== leader.internId).map((m) => {
                  const isVice = m.internId === tm.viceLeaderId;
                  let cls = 'member-chip';
                  if (isVice) cls += ' is-vice-leader';
                  return (
                    <span className={cls} key={m.internId}>
                      {m.name}{m.role ? ` · ${m.role}` : ''}
                      {isVice ? ' ⭐' : ''}
                    </span>
                  );
                })}
                {(tm.memberDetails || []).filter((m) => m.internId !== leader.internId).length === 0 &&
                  <span className="muted small">No members yet.</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>Upcoming meetings</h3>
        {upcomingMeetings.length === 0 && <p className="muted">No meetings scheduled.</p>}
        <div className="card-list">
          {upcomingMeetings.slice(0, 5).map((m) => (
            <div className="mini-card" key={m._id}>
              <div>
                <strong>{m.title}</strong>
                <div className="muted small">{new Date(m.scheduledAt).toLocaleString()}</div>
              </div>
              {m.link && (
                <a className="btn-mini meet-btn" href={m.link} target="_blank" rel="noreferrer">
                  <span className="material-symbols-outlined">videocam</span>Join
                </a>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );

  const projectsPanel = (
    <section className="panel">
      <h3>My projects ({leaderProjects.length})</h3>
      {leaderProjects.length === 0 && <p className="muted">No projects assigned to you yet. An admin can assign projects you'll deliver with your team.</p>}
      <div className="card-list">
        {leaderProjects.map((p) => (
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

  const newTasks = memberTasks.filter((t) => t.status === 'todo');
  const ongoing = memberTasks.filter((t) => t.status === 'in-progress');
  const done = memberTasks.filter((t) => t.status === 'done');

  const tasksPanel = (
    <>
      <section className="panel">
        <form className="assign-form" onSubmit={assignTask} noValidate>
          <h4>Assign a task to a member</h4>
          <select className={assignErrors.internId ? 'input-error' : ''} value={assignForm.internId}
            onChange={(e) => setAssignForm({ ...assignForm, internId: e.target.value })}>
            <option value="">Assign to member…</option>
            {members.map((m) => (
              <option key={m.internId} value={m.internId}>{m.name}{m.role ? ` (${m.role})` : ''}</option>
            ))}
          </select>
          {assignErrors.internId && <span className="field-error">{assignErrors.internId}</span>}
          <input className={assignErrors.title ? 'input-error' : ''} placeholder="Task title" value={assignForm.title}
            onChange={(e) => setAssignForm({ ...assignForm, title: e.target.value })} />
          {assignErrors.title && <span className="field-error">{assignErrors.title}</span>}
          <textarea placeholder="Description" value={assignForm.description}
            onChange={(e) => setAssignForm({ ...assignForm, description: e.target.value })} />
          <select value={assignForm.project} onChange={(e) => setAssignForm({ ...assignForm, project: e.target.value })}>
            <option value="">Project…</option>
            {leaderProjects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
          <label className="field-label">Due date</label>
          <input type="date" value={assignForm.dueDate}
            onChange={(e) => setAssignForm({ ...assignForm, dueDate: e.target.value })} />
          <button type="submit" disabled={members.length === 0}>
            {members.length === 0 ? 'Add members to your team first' : 'Assign task'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h3>Member tasks</h3>
        <div className="task-board">
          {[
            { key: 'todo', label: 'New', list: newTasks },
            { key: 'in-progress', label: 'Ongoing', list: ongoing },
            { key: 'done', label: 'Completed', list: done },
          ].map((col) => (
            <div className="task-col" key={col.key}>
              <h4>{col.label} ({col.list.length})</h4>
              {col.list.length === 0 && <p className="muted small">—</p>}
              {col.list.map((t) => {
                const who = memberById[t.internId];
                return (
                  <div className="task-item" key={t._id}>
                    <strong>{t.title}</strong>
                    {t.description && <p className="muted small">{t.description}</p>}
                    <div className="muted small">
                      {who ? who.name : t.internId}{who?.role ? ` · ${who.role}` : ''}
                      {t.project?.name ? ` · ${t.project.name}` : ''}
                      {t.dueDate ? ` · ${isOverdue(t.dueDate) && t.status !== 'done' ? 'overdue ' : 'due '}${new Date(t.dueDate).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </>
  );

  const meetingsPanel = (
    <>
      <section className="panel">
        <form className="assign-form" onSubmit={scheduleMeeting} noValidate>
          <h4>Schedule a meeting</h4>
          <input className={meetErrors.title ? 'input-error' : ''} placeholder="Meeting title" value={meetForm.title}
            onChange={(e) => setMeetForm({ ...meetForm, title: e.target.value })} />
          {meetErrors.title && <span className="field-error">{meetErrors.title}</span>}

          <label className="field-label">Who is this meeting with?</label>
          <select value={meetForm.scope}
            onChange={(e) => setMeetForm({ ...meetForm, scope: e.target.value, memberIds: [] })}>
            <option value="team">My entire team</option>
            <option value="members">Specific members</option>
          </select>

          {meetForm.scope === 'team' && (
            <>
              <select className={meetErrors.teamId ? 'input-error' : ''} value={meetForm.teamId}
                onChange={(e) => setMeetForm({ ...meetForm, teamId: e.target.value })}>
                <option value="">Choose a team…</option>
                {ledTeams.map((tm) => <option key={tm._id} value={tm._id}>{tm.name}</option>)}
              </select>
              {meetErrors.teamId && <span className="field-error">{meetErrors.teamId}</span>}
            </>
          )}

          {meetForm.scope === 'members' && (
            <>
              <span className="field-hint">
                Select members ({meetForm.memberIds.length} selected)
              </span>
              <div className="checkbox-list">
                {members.length === 0 && <span className="muted small">No members in your team yet.</span>}
                {members.map((m) => (
                  <label key={m.internId} className="checkbox-row">
                    <input type="checkbox" checked={meetForm.memberIds.includes(m.internId)}
                      onChange={() => toggleMeetMember(m.internId)} />
                    <span>{m.name} <span className="muted small">· {m.role || '—'}</span></span>
                  </label>
                ))}
              </div>
              {meetErrors.memberIds && <span className="field-error">{meetErrors.memberIds}</span>}
            </>
          )}

          <label className="field-label">Date &amp; time</label>
          <input className={meetErrors.scheduledAt ? 'input-error' : ''} type="datetime-local" value={meetForm.scheduledAt}
            onChange={(e) => setMeetForm({ ...meetForm, scheduledAt: e.target.value })} />
          {meetErrors.scheduledAt && <span className="field-error">{meetErrors.scheduledAt}</span>}
          <input placeholder="Google Meet / video link (optional)" value={meetForm.link}
            onChange={(e) => setMeetForm({ ...meetForm, link: e.target.value })} />
          <textarea placeholder="Notes (optional)" value={meetForm.notes}
            onChange={(e) => setMeetForm({ ...meetForm, notes: e.target.value })} />
          <button type="submit">Schedule meeting</button>
        </form>
      </section>

      <section className="panel">
        <h3>Upcoming meetings</h3>
        {upcomingMeetings.length === 0 && <p className="muted">No meetings scheduled.</p>}
        <div className="card-list">
          {upcomingMeetings.map((m) => (
            <div className="mini-card column" key={m._id}>
              <strong>{m.title}</strong>
              <div className="muted small">{new Date(m.scheduledAt).toLocaleString()}</div>
              <div className="member-chips">
                {(m.attendees || []).length > 0
                  ? m.attendees.map((a) => <span className="member-chip" key={a.internId || a.email}>{a.name}</span>)
                  : (m.attendeeName ? <span className="member-chip">{m.attendeeName}</span> : null)}
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
    </>
  );

  const membersPanel = (
    <section className="panel">
      <h3>Team members ({members.length})</h3>
      {members.length === 0 && <p className="muted">No members yet. An admin can add members to the team you lead.</p>}
      <div className="card-list">
        {members.map((m) => {
          const theirTasks = memberTasks.filter((t) => t.internId === m.internId);
          const theirDone = theirTasks.filter((t) => t.status === 'done').length;
          return (
            <div className="mini-card column" key={m.internId}>
              <div className="mini-card-head">
                <strong>{m.name}</strong>
                <span className="status-pill" style={{ background: '#7b2fb5' }}>{m.role || 'Member'}</span>
              </div>
              <div className="muted small">{m.internId}{m.email ? ` · ${m.email}` : ''}</div>
              <div className="muted small">{theirDone}/{theirTasks.length} tasks done</div>
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">GS</span>
          <div className="brand-text">
            <span className="brand-name">GSPL</span>
            <span className="brand-sub">Team Leader Portal</span>
          </div>
        </div>

        <nav className="side-nav">
          <span className="side-nav-label">Menu</span>
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'side-link active' : 'side-link'}
              onClick={() => setTab(t.key)}
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
            <h1>{tab === 'Dashboard' ? `Hi, ${leader.name.split(' ')[0]} 👋` : active.key}</h1>
            <p className="muted">{active.sub}</p>
          </div>
          <div className="topbar-meta">
            <span className="material-symbols-outlined">military_tech</span>
            Team Leader · {leader.internId}
          </div>
        </header>

        {tab === 'Dashboard' && (
          <div className="stat-row">
            {statCards.map((s) => (
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
          {tab === 'Dashboard' && dashboardPanel}
          {tab === 'Projects' && projectsPanel}
          {tab === 'Tasks' && tasksPanel}
          {tab === 'Meetings' && meetingsPanel}
          {tab === 'Members' && membersPanel}
        </div>
      </main>
    </div>
  );
};

export default TeamLeaderDashboard;
