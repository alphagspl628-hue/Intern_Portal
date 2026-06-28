import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Navigate, useNavigate } from 'react-router-dom';
import { API } from './config';
import { useToast, apiError } from './Toast';
import { isBlank } from './validation';

// Resumes now live in Google Cloud Storage; the backend redirects this to a
// short-lived signed URL.
const resumeUrl = (app) => `${API}/api/applications/${app._id}/resume`;

// Build a "New Google Meet" tab URL (the admin's Google account creates a real link).
const NEW_MEET_URL = 'https://meet.google.com/new';

// Build an "Add to Google Calendar" link that pre-fills the event + the Meet link
// and invites the applicant by email.
const gcalUrl = (m) => {
  const start = new Date(m.scheduledAt);
  const end = new Date(start.getTime() + 30 * 60000);
  const fmt = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.title || 'Meeting',
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `${m.notes || ''}${m.link ? `\n\nJoin Google Meet: ${m.link}` : ''}`.trim(),
  });
  if (m.attendeeEmail) params.set('add', m.attendeeEmail);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

const STATUS_COLORS = {
  pending: '#b5852f',
  reviewing: '#2f6fb5',
  interview: '#7b2fb5',
  approved: '#2f9e5b',
  rejected: '#b53b2f',
  // Project lifecycle
  active: '#2f6fb5',
  completed: '#2f9e5b',
  'on-hold': '#b5852f',
};

// ---------------------------------------------------------------------------
// Applicants tab
// ---------------------------------------------------------------------------
function ApplicantsTab({ applications, projects, reload, onSchedule }) {
  const toast = useToast();
  const [approving, setApproving] = useState(null); // application id
  const [projectChoice, setProjectChoice] = useState('');

  const setStatus = async (id, status) => {
    try {
      await axios.patch(`${API}/api/applications/${id}/status`, { status });
      toast.success(`Status updated to “${status}”.`);
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not update status.'));
    }
  };

  const approve = async (id) => {
    try {
      const res = await axios.post(`${API}/api/applications/${id}/approve`, {
        projectId: projectChoice || undefined,
      });
      setApproving(null);
      setProjectChoice('');
      toast.success(`Approved — Intern ID ${res.data?.internId || 'generated'}.`);
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not approve applicant.'));
    }
  };

  const remove = async (app) => {
    const label = app.internId
      ? `Remove intern ${app.name} (${app.internId})? Their files, tasks and team membership will be deleted and the ID freed for reuse.`
      : `Delete applicant ${app.name}? This also removes their uploaded resume.`;
    if (!window.confirm(label)) return;
    try {
      await axios.delete(`${API}/api/applications/${app._id}`);
      toast.success(`${app.name} removed.`);
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not remove applicant.'));
    }
  };

  return (
    <div>
      <div className="table-container">
        <table className="applications-table">
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Role</th><th>College</th>
              <th>Status</th><th>Intern ID</th><th>CV</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {applications.length === 0 && (
              <tr><td colSpan="8" style={{ textAlign: 'center' }}>No applications yet.</td></tr>
            )}
            {applications.map((app) => (
              <tr key={app._id}>
                <td>{app.name}</td>
                <td>{app.email}</td>
                <td>{app.role}</td>
                <td>{app.college}</td>
                <td>
                  <span className="status-pill" style={{ background: STATUS_COLORS[app.status] || '#888' }}>
                    {app.status}
                  </span>
                </td>
                <td>{app.internId || '—'}</td>
                <td className="docs-links">
                  <a href={resumeUrl(app)} target="_blank" rel="noreferrer" download>Download</a>
                </td>
                <td>
                  <div className="row-actions">
                    {app.status !== 'approved' && (
                      <>
                        <select value={app.status} onChange={(e) => setStatus(app._id, e.target.value)}>
                          <option value="pending">Pending</option>
                          <option value="reviewing">Reviewing</option>
                          <option value="interview">Interview</option>
                          <option value="rejected">Rejected</option>
                        </select>
                        <button className="btn-mini" onClick={() => onSchedule(app)}>
                          <span className="material-symbols-outlined">event</span>Meeting
                        </button>
                        <button className="btn-mini approve" onClick={() => setApproving(app._id)}>
                          <span className="material-symbols-outlined">check</span>Approve
                        </button>
                      </>
                    )}
                    {app.status === 'approved' && (
                      <span className="approved-tag">✓ Intern{app.assignedProject ? ` · ${app.assignedProject.name}` : ''}</span>
                    )}
                    <button className="btn-mini danger" onClick={() => remove(app)} title="Delete applicant">
                      <span className="material-symbols-outlined">delete</span>Delete
                    </button>
                  </div>

                  {approving === app._id && (
                    <div className="inline-approve">
                      <select value={projectChoice} onChange={(e) => setProjectChoice(e.target.value)}>
                        <option value="">Assign a project (optional)</option>
                        {projects.map((p) => (
                          <option key={p._id} value={p._id}>{p.name}</option>
                        ))}
                      </select>
                      <button className="btn-mini approve" onClick={() => approve(app._id)}>Confirm &amp; generate ID</button>
                      <button className="btn-mini" onClick={() => setApproving(null)}>Cancel</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job Roles tab
// ---------------------------------------------------------------------------
function RolesTab({ roles, reload }) {
  const toast = useToast();
  const blank = { title: '', department: '', openings: 1, description: '' };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const openAdd = () => { setForm(blank); setErrors({}); setEditingId(null); setOpen(true); };
  const openEdit = (r) => {
    setForm({ title: r.title || '', department: r.department || '', openings: r.openings || 1, description: r.description || '' });
    setErrors({}); setEditingId(r._id); setOpen(true);
  };
  const closeModal = () => { setOpen(false); setEditingId(null); setErrors({}); };

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (isBlank(form.title)) errs.title = 'Role title is required.';
    if (!form.openings || Number(form.openings) < 1) errs.openings = 'At least 1 opening.';
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error('Please fix the highlighted fields.'); return; }
    try {
      if (editingId) {
        await axios.patch(`${API}/api/roles/${editingId}`, form);
        toast.success('Role updated.');
      } else {
        await axios.post(`${API}/api/roles`, form);
        toast.success('Role added.');
      }
      closeModal();
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not save role.'));
    }
  };
  const remove = async (id) => {
    try {
      await axios.delete(`${API}/api/roles/${id}`);
      toast.success('Role deleted.');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not delete role.'));
    }
  };

  return (
    <div>
      <div className="content-head">
        <button className="btn-primary" onClick={openAdd}>
          <span className="material-symbols-outlined">add</span>Add role
        </button>
      </div>

      <div className="panel">
        <h3>Open roles ({roles.length})</h3>
        {roles.length === 0 && <p className="muted">No roles yet — add one with the “Add role” button. These appear on the public application form.</p>}
        <div className="card-list">
          {roles.map((r) => (
            <div className="mini-card" key={r._id}>
              <div>
                <strong>{r.title}</strong>
                <div className="muted">{r.department || '—'} · {r.openings} opening(s)</div>
                {r.description && <p className="muted small">{r.description}</p>}
              </div>
              <div className="card-actions">
                <button className="btn-mini" onClick={() => openEdit(r)}>
                  <span className="material-symbols-outlined">edit</span>Edit
                </button>
                <button className="btn-mini danger" onClick={() => remove(r._id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <div className="modal-overlay" onClick={closeModal}>
          <form className="panel modal" onClick={(e) => e.stopPropagation()} onSubmit={save} noValidate>
            <div className="modal-head">
              <h3>{editingId ? 'Edit job role' : 'Add a new job role'}</h3>
              <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label htmlFor="role-title">Role title <span className="req">*</span></label>
                <input id="role-title" className={errors.title ? 'input-error' : ''} placeholder="e.g. Backend Intern" value={form.title} autoFocus
                  onChange={(e) => { setForm({ ...form, title: e.target.value }); setErrors({ ...errors, title: undefined }); }} />
                {errors.title && <span className="field-error">{errors.title}</span>}
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="role-dept">Department</label>
                  <input id="role-dept" placeholder="e.g. Engineering" value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor="role-openings">Openings</label>
                  <input id="role-openings" className={errors.openings ? 'input-error' : ''} type="number" min="1" value={form.openings}
                    onChange={(e) => { setForm({ ...form, openings: Number(e.target.value) }); setErrors({ ...errors, openings: undefined }); }} />
                  {errors.openings && <span className="field-error">{errors.openings}</span>}
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="role-desc">Description</label>
                <textarea id="role-desc" placeholder="What this role involves…" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
                <span className="field-hint">Shown to applicants on the public application form.</span>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-mini" onClick={closeModal}>Cancel</button>
              <button type="submit"><span className="material-symbols-outlined">{editingId ? 'save' : 'add'}</span>{editingId ? 'Save changes' : 'Add role'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projects tab
// ---------------------------------------------------------------------------
function ProjectsTab({ projects, reload }) {
  const toast = useToast();
  const blank = { name: '', description: '', deadline: '', status: 'active' };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const openAdd = () => { setForm(blank); setErrors({}); setEditingId(null); setOpen(true); };
  const openEdit = (p) => {
    setForm({
      name: p.name || '', description: p.description || '',
      deadline: p.deadline ? new Date(p.deadline).toISOString().slice(0, 10) : '',
      status: p.status || 'active',
    });
    setErrors({}); setEditingId(p._id); setOpen(true);
  };
  const closeModal = () => { setOpen(false); setEditingId(null); setErrors({}); };

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (isBlank(form.name)) errs.name = 'Project name is required.';
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error('Please fix the highlighted fields.'); return; }
    try {
      if (editingId) {
        await axios.patch(`${API}/api/projects/${editingId}`, form);
        toast.success('Project updated.');
      } else {
        await axios.post(`${API}/api/projects`, form);
        toast.success('Project created.');
      }
      closeModal();
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not save project.'));
    }
  };
  const remove = async (id) => {
    if (!window.confirm('Delete this project and its tasks?')) return;
    try {
      await axios.delete(`${API}/api/projects/${id}`);
      toast.success('Project deleted.');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not delete project.'));
    }
  };
  return (
    <div>
      <div className="content-head">
        <button className="btn-primary" onClick={openAdd}>
          <span className="material-symbols-outlined">add</span>Create project
        </button>
      </div>

      <div className="panel">
        <h3>Projects ({projects.length})</h3>
        {projects.length === 0 && <p className="muted">No projects yet — create one with the “Create project” button.</p>}
        <div className="card-list">
          {projects.map((p) => (
            <div className="mini-card column" key={p._id}>
              <div className="mini-card-head">
                <strong>{p.name}</strong>
                <div className="card-actions">
                  <span className="status-pill" style={{ background: STATUS_COLORS[p.status] || '#2f6fb5' }}>{p.status}</span>
                  <button className="btn-mini" onClick={() => openEdit(p)}>
                    <span className="material-symbols-outlined">edit</span>Edit
                  </button>
                  <button className="btn-mini danger" onClick={() => remove(p._id)}>Delete</button>
                </div>
              </div>
              {p.description && <p className="muted small">{p.description}</p>}
              <div className="progress-bar"><span style={{ width: `${p.progress}%` }} /></div>
              <div className="muted small">
                {p.progress}% · {p.doneTasks}/{p.totalTasks} tasks · {p.assignedInterns?.length || 0} intern(s)
                {p.deadline ? ` · due ${new Date(p.deadline).toLocaleDateString()}` : ''}
              </div>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <div className="modal-overlay" onClick={closeModal}>
          <form className="panel modal" onClick={(e) => e.stopPropagation()} onSubmit={save} noValidate>
            <div className="modal-head">
              <h3>{editingId ? 'Edit project' : 'Create a project'}</h3>
              <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label htmlFor="proj-name">Project name <span className="req">*</span></label>
                <input id="proj-name" className={errors.name ? 'input-error' : ''} placeholder="e.g. Company Website Revamp" value={form.name} autoFocus
                  onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors({ ...errors, name: undefined }); }} />
                {errors.name && <span className="field-error">{errors.name}</span>}
              </div>
              <div className="form-field">
                <label htmlFor="proj-desc">Description</label>
                <textarea id="proj-desc" placeholder="Goals and scope of the project…" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="form-field">
                <label htmlFor="proj-deadline">Deadline</label>
                <input id="proj-deadline" type="date" value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-mini" onClick={closeModal}>Cancel</button>
              <button type="submit"><span className="material-symbols-outlined">{editingId ? 'save' : 'add'}</span>{editingId ? 'Save changes' : 'Create project'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks tab — assign work to interns
// ---------------------------------------------------------------------------
function TasksTab({ tasks, projects, interns, reload }) {
  const toast = useToast();
  const blank = { title: '', description: '', project: '', internId: '', dueDate: '' };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const openAdd = () => { setForm(blank); setErrors({}); setEditingId(null); setOpen(true); };
  const openEdit = (t) => {
    setForm({
      title: t.title || '', description: t.description || '',
      project: t.project?._id || t.project || '', internId: t.internId || '',
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '',
    });
    setErrors({}); setEditingId(t._id); setOpen(true);
  };
  const closeModal = () => { setOpen(false); setEditingId(null); setErrors({}); };

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (isBlank(form.title)) errs.title = 'Task title is required.';
    if (isBlank(form.project)) errs.project = 'Select a project.';
    if (isBlank(form.internId)) errs.internId = 'Select an intern.';
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error('Please fix the highlighted fields.'); return; }
    try {
      if (editingId) {
        await axios.patch(`${API}/api/tasks/${editingId}`, form);
        toast.success('Task updated.');
      } else {
        await axios.post(`${API}/api/tasks`, form);
        toast.success('Task assigned.');
      }
      closeModal();
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not save task.'));
    }
  };
  const setTaskStatus = async (id, status) => {
    try {
      await axios.patch(`${API}/api/tasks/${id}`, { status });
      toast.success('Task updated.');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not update task.'));
    }
  };
  const remove = async (id) => {
    try {
      await axios.delete(`${API}/api/tasks/${id}`);
      toast.success('Task deleted.');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not delete task.'));
    }
  };

  return (
    <div>
      <div className="content-head">
        <button className="btn-primary" onClick={openAdd} disabled={interns.length === 0}>
          <span className="material-symbols-outlined">assignment</span>
          {interns.length === 0 ? 'Approve an intern first' : 'Assign task'}
        </button>
      </div>

      <div className="panel">
        <h3>All tasks ({tasks.length})</h3>
        {tasks.length === 0 && <p className="muted">No tasks assigned yet.</p>}
        <div className="card-list">
          {tasks.map((t) => (
            <div className="mini-card column" key={t._id}>
              <div className="mini-card-head">
                <strong>{t.title}</strong>
                <div className="card-actions">
                  <button className="btn-mini" onClick={() => openEdit(t)}>
                    <span className="material-symbols-outlined">edit</span>Edit
                  </button>
                  <button className="btn-mini danger" onClick={() => remove(t._id)}>Delete</button>
                </div>
              </div>
              <div className="muted small">
                {t.project?.name || '—'} · {t.internId}
                {t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString()}` : ''}
              </div>
              <select value={t.status} onChange={(e) => setTaskStatus(t._id, e.target.value)}>
                <option value="todo">To do</option>
                <option value="in-progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <div className="modal-overlay" onClick={closeModal}>
          <form className="panel modal" onClick={(e) => e.stopPropagation()} onSubmit={save} noValidate>
            <div className="modal-head">
              <h3>{editingId ? 'Edit task' : 'Assign a task'}</h3>
              <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label htmlFor="task-title">Task title <span className="req">*</span></label>
                <input id="task-title" className={errors.title ? 'input-error' : ''} placeholder="e.g. Build the login page" value={form.title} autoFocus
                  onChange={(e) => { setForm({ ...form, title: e.target.value }); setErrors({ ...errors, title: undefined }); }} />
                {errors.title && <span className="field-error">{errors.title}</span>}
              </div>
              <div className="form-field">
                <label htmlFor="task-desc">Description</label>
                <textarea id="task-desc" placeholder="What needs to be done…" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="task-project">Project <span className="req">*</span></label>
                  <select id="task-project" className={errors.project ? 'input-error' : ''} value={form.project}
                    onChange={(e) => { setForm({ ...form, project: e.target.value }); setErrors({ ...errors, project: undefined }); }}>
                    <option value="">Select project…</option>
                    {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                  {errors.project && <span className="field-error">{errors.project}</span>}
                </div>
                <div className="form-field">
                  <label htmlFor="task-intern">Assign to <span className="req">*</span></label>
                  <select id="task-intern" className={errors.internId ? 'input-error' : ''} value={form.internId}
                    onChange={(e) => { setForm({ ...form, internId: e.target.value }); setErrors({ ...errors, internId: undefined }); }}>
                    <option value="">Select intern…</option>
                    {interns.map((i) => <option key={i.internId} value={i.internId}>{i.name} ({i.internId})</option>)}
                  </select>
                  {errors.internId && <span className="field-error">{errors.internId}</span>}
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="task-due">Due date</label>
                <input id="task-due" type="date" value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-mini" onClick={closeModal}>Cancel</button>
              <button type="submit" disabled={interns.length === 0}>
                <span className="material-symbols-outlined">{editingId ? 'save' : 'assignment'}</span>{editingId ? 'Save changes' : 'Assign task'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meetings tab
// ---------------------------------------------------------------------------
function MeetingsTab({ meetings, applications, reload, preselect, clearPreselect }) {
  const blank = { title: '', applicationId: '', scheduledAt: '', link: '', notes: '' };
  const [form, setForm] = useState(blank);

  const toast = useToast();
  const [errors, setErrors] = useState({});
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Format an ISO date for a datetime-local input (keeps local wall-clock time).
  const toLocalInput = (d) => {
    const dt = new Date(d);
    return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  useEffect(() => {
    if (preselect) {
      setForm((f) => ({ ...f, applicationId: preselect._id, title: `Interview with ${preselect.name}` }));
      setEditingId(null);
      setOpen(true);
    }
  }, [preselect]);

  const openAdd = () => { setForm(blank); setErrors({}); setEditingId(null); setOpen(true); };
  const openEdit = (m) => {
    setForm({
      title: m.title || '', applicationId: m.application?._id || m.application || '',
      scheduledAt: m.scheduledAt ? toLocalInput(m.scheduledAt) : '',
      link: m.link || '', notes: m.notes || '',
    });
    setErrors({}); setEditingId(m._id); setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (isBlank(form.title)) errs.title = 'Title is required.';
    if (isBlank(form.applicationId)) errs.applicationId = 'Select an applicant.';
    if (isBlank(form.scheduledAt)) errs.scheduledAt = 'Pick a date & time.';
    else if (!editingId && new Date(form.scheduledAt) < new Date()) errs.scheduledAt = 'Pick a future date & time.';
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error('Please fix the highlighted fields.'); return; }
    try {
      if (editingId) {
        await axios.patch(`${API}/api/meetings/${editingId}`, form);
        toast.success('Meeting updated.');
      } else {
        await axios.post(`${API}/api/meetings`, form);
        toast.success('Meeting scheduled — invite emailed.');
      }
      closeModal();
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not save meeting.'));
    }
  };
  const closeModal = () => { setOpen(false); setErrors({}); setEditingId(null); setForm(blank); clearPreselect(); };
  const remove = async (id) => {
    try {
      await axios.delete(`${API}/api/meetings/${id}`);
      toast.success('Meeting deleted.');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not delete meeting.'));
    }
  };
  const complete = async (id) => {
    try {
      await axios.patch(`${API}/api/meetings/${id}`, { status: 'completed' });
      toast.success('Meeting marked done — removed from upcoming.');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not update meeting.'));
    }
  };

  // Completed meetings drop off the upcoming list entirely.
  const upcoming = meetings.filter((m) => m.status !== 'completed');

  return (
    <div>
      <div className="content-head">
        <button className="btn-primary" onClick={openAdd}>
          <span className="material-symbols-outlined">event</span>Schedule meeting
        </button>
      </div>

      <div className="panel">
        <h3>Upcoming meetings ({upcoming.length})</h3>
        {upcoming.length === 0 && <p className="muted">No meetings scheduled — add one with the “Schedule meeting” button.</p>}
        <div className="card-list">
          {upcoming.map((m) => (
            <div className="mini-card column" key={m._id}>
              <div className="mini-card-head">
                <strong>{m.title}</strong>
                <div className="card-actions">
                  <button className="btn-mini" onClick={() => openEdit(m)}>
                    <span className="material-symbols-outlined">edit</span>Edit
                  </button>
                  <button className="btn-mini danger" onClick={() => remove(m._id)}>Delete</button>
                </div>
              </div>
              <div className="muted small">
                {m.attendeeName} · {new Date(m.scheduledAt).toLocaleString()}
              </div>
              {m.notes && <p className="muted small">{m.notes}</p>}
              <div className="meeting-actions">
                {m.link && (
                  <a className="btn-mini meet-btn" href={m.link} target="_blank" rel="noreferrer">
                    <span className="material-symbols-outlined">videocam</span>Join Meet
                  </a>
                )}
                <a className="btn-mini" href={gcalUrl(m)} target="_blank" rel="noreferrer">
                  <span className="material-symbols-outlined">calendar_add_on</span>Add to Calendar
                </a>
                {m.status !== 'completed' && (
                  <button className="btn-mini approve" onClick={() => complete(m._id)}>
                    <span className="material-symbols-outlined">check</span>Complete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <div className="modal-overlay" onClick={closeModal}>
          <form className="panel modal modal-wide" onClick={(e) => e.stopPropagation()} onSubmit={save} noValidate>
            <div className="modal-head">
              <h3 className="modal-title-icon">
                <span className="material-symbols-outlined">event</span>
                {editingId ? 'Edit meeting' : 'Schedule a meeting'}
              </h3>
              <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label htmlFor="meet-title">Title <span className="req">*</span></label>
                <input id="meet-title" className={errors.title ? 'input-error' : ''} placeholder="e.g. Technical Interview" value={form.title} autoFocus
                  onChange={(e) => { setForm({ ...form, title: e.target.value }); setErrors({ ...errors, title: undefined }); }} />
                {errors.title && <span className="field-error">{errors.title}</span>}
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="meet-applicant">Applicant <span className="req">*</span></label>
                  <select id="meet-applicant" className={errors.applicationId ? 'input-error' : ''} value={form.applicationId}
                    onChange={(e) => { setForm({ ...form, applicationId: e.target.value }); setErrors({ ...errors, applicationId: undefined }); }}>
                    <option value="">Select applicant…</option>
                    {applications.map((a) => <option key={a._id} value={a._id}>{a.name} — {a.email}</option>)}
                  </select>
                  {errors.applicationId && <span className="field-error">{errors.applicationId}</span>}
                </div>
                <div className="form-field">
                  <label htmlFor="meet-when">Date &amp; time <span className="req">*</span></label>
                  <input id="meet-when" className={errors.scheduledAt ? 'input-error' : ''} type="datetime-local" value={form.scheduledAt}
                    onChange={(e) => { setForm({ ...form, scheduledAt: e.target.value }); setErrors({ ...errors, scheduledAt: undefined }); }} />
                  {errors.scheduledAt && <span className="field-error">{errors.scheduledAt}</span>}
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="meet-link">Google Meet / video link</label>
                <div className="meet-row">
                  <input id="meet-link" placeholder="Paste a Google Meet link" value={form.link}
                    onChange={(e) => setForm({ ...form, link: e.target.value })} />
                  <a className="btn-mini meet-btn" href={NEW_MEET_URL} target="_blank" rel="noreferrer"
                    title="Open Google Meet to create a new meeting, then paste the link here">
                    <span className="material-symbols-outlined">videocam</span>New Meet
                  </a>
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="meet-notes">Notes</label>
                <textarea id="meet-notes" placeholder="Anything the applicant should know…" value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-mini" onClick={closeModal}>Cancel</button>
              <button type="submit"><span className="material-symbols-outlined">{editingId ? 'save' : 'mail'}</span>{editingId ? 'Save changes' : 'Schedule & email invite'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interns / Progress tab
// ---------------------------------------------------------------------------
function InternsTab({ interns, tasks, reload }) {
  const toast = useToast();

  const promote = async (app) => {
    if (!window.confirm(`Promote ${app.name} to Team Leader? Their Intern ID will be prefixed with "TL-" (used for login) and they'll be emailed the new ID.`)) return;
    try {
      const res = await axios.post(`${API}/api/applications/${app._id}/promote-leader`);
      toast.success(`${app.name} is now a Team Leader — ID ${res.data?.internId || 'updated'}.`);
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not promote intern.'));
    }
  };
  const demote = async (app) => {
    if (!window.confirm(`Demote ${app.name} back to a regular intern? The "TL-" prefix will be removed from their ID and they'll lose team leadership.`)) return;
    try {
      await axios.post(`${API}/api/applications/${app._id}/demote-leader`);
      toast.success(`${app.name} demoted to intern.`);
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not demote intern.'));
    }
  };

  if (interns.length === 0) return <p className="muted panel">No interns yet. Approve an applicant to generate their Intern ID.</p>;
  return (
    <div className="card-list">
      {interns.map((i) => {
        const myTasks = tasks.filter((t) => t.internId === i.internId);
        const done = myTasks.filter((t) => t.status === 'done').length;
        const progress = myTasks.length ? Math.round((done / myTasks.length) * 100) : 0;
        return (
          <div className="mini-card column" key={i.internId}>
            <div className="mini-card-head">
              <strong>{i.name}{i.isTeamLeader && <span className="leader-badge" style={{ marginLeft: 8 }}><span className="material-symbols-outlined">military_tech</span>Team Leader</span>}</strong>
              <span className="status-pill" style={{ background: '#2f9e5b' }}>{i.internId}</span>
            </div>
            <div className="muted small">{i.role} · {i.email}</div>
            <div className="muted small">Project: {i.assignedProject?.name || '—'}</div>
            <div className="progress-bar"><span style={{ width: `${progress}%` }} /></div>
            <div className="muted small">{progress}% · {done}/{myTasks.length} tasks done</div>
            <div className="card-actions">
              {i.isTeamLeader ? (
                <button className="btn-mini danger" onClick={() => demote(i)}>
                  <span className="material-symbols-outlined">remove_moderator</span>Demote
                </button>
              ) : (
                <button className="btn-mini approve" onClick={() => promote(i)}>
                  <span className="material-symbols-outlined">military_tech</span>Promote to Team Leader
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams tab — form teams and assign a team leader
// ---------------------------------------------------------------------------
function TeamsTab({ teams, interns, reload }) {
  const toast = useToast();
  const blank = { name: '', description: '', leaderId: '', members: [] };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Only promoted team leaders can be assigned to lead a team.
  const leaders = interns.filter((i) => i.isTeamLeader);

  const toggleMember = (id, list, setList) => {
    setList(list.includes(id) ? list.filter((m) => m !== id) : [...list, id]);
  };

  const openAdd = () => { setForm(blank); setErrors({}); setEditingId(null); setOpen(true); };
  const openEdit = (tm) => {
    setForm({
      name: tm.name || '', description: tm.description || '',
      leaderId: tm.leaderId || '', members: tm.members || (tm.memberDetails || []).map((m) => m.internId),
    });
    setErrors({}); setEditingId(tm._id); setOpen(true);
  };
  const closeModal = () => { setOpen(false); setEditingId(null); setErrors({}); };

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (isBlank(form.name)) errs.name = 'Team name is required.';
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error('Please fix the highlighted fields.'); return; }
    try {
      if (editingId) {
        await axios.patch(`${API}/api/teams/${editingId}`, form);
        toast.success('Team updated.');
      } else {
        await axios.post(`${API}/api/teams`, form);
        toast.success('Team created.');
      }
      closeModal();
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not save team.'));
    }
  };
  const remove = async (id) => {
    if (!window.confirm('Delete this team?')) return;
    try {
      await axios.delete(`${API}/api/teams/${id}`);
      toast.success('Team deleted.');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not delete team.'));
    }
  };
  const setLeader = async (id, leaderId) => {
    try {
      await axios.patch(`${API}/api/teams/${id}`, { leaderId });
      toast.success('Team leader updated.');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not update leader.'));
    }
  };
  const setViceLeader = async (id, viceLeaderId) => {
    try {
      await axios.patch(`${API}/api/teams/${id}`, { viceLeaderId });
      toast.success('Vice Team Leader updated.');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not update vice leader.'));
    }
  };

  return (
    <div>
      <div className="content-head">
        <button className="btn-primary" onClick={openAdd}>
          <span className="material-symbols-outlined">group_add</span>Create team
        </button>
      </div>

      <div className="panel">
        <h3>Teams ({teams.length})</h3>
        {teams.length === 0 && <p className="muted">No teams yet. The leader you pick can assign tasks to members from their dashboard.</p>}
        <div className="card-list">
          {teams.map((tm) => (
            <div className="mini-card column" key={tm._id}>
              <div className="mini-card-head">
                <strong>{tm.name}</strong>
                <div className="card-actions">
                  <button className="btn-mini" onClick={() => openEdit(tm)}>
                    <span className="material-symbols-outlined">edit</span>Edit
                  </button>
                  <button className="btn-mini danger" onClick={() => remove(tm._id)}>
                    <span className="material-symbols-outlined">delete</span>Delete
                  </button>
                </div>
              </div>
              {tm.description && <p className="muted small">{tm.description}</p>}
              <div className="team-leader-row">
                <span className="material-symbols-outlined">military_tech</span>
                <span>Leader:</span>
                <select value={tm.leaderId || ''} onChange={(e) => setLeader(tm._id, e.target.value)}>
                  <option value="">Unassigned</option>
                  {leaders.map((i) => <option key={i.internId} value={i.internId}>{i.name}</option>)}
                </select>
              </div>
              <div className="team-leader-row" style={{ marginTop: '0.25rem' }}>
                <span className="material-symbols-outlined">stars</span>
                <span>Vice Leader:</span>
                <select value={tm.viceLeaderId || ''} onChange={(e) => setViceLeader(tm._id, e.target.value)}>
                  <option value="">Unassigned</option>
                  {(tm.memberDetails || []).filter(m => m.internId !== tm.leaderId).map((i) => <option key={i.internId} value={i.internId}>{i.name}</option>)}
                </select>
              </div>
              <div className="member-chips" style={{ marginTop: '0.5rem' }}>
                {(tm.memberDetails || []).length === 0 && <span className="muted small">No members.</span>}
                {(tm.memberDetails || []).map((m) => {
                  const isLeader = m.internId === tm.leaderId;
                  const isVice = m.internId === tm.viceLeaderId;
                  let cls = 'member-chip';
                  if (isLeader) cls += ' is-leader';
                  else if (isVice) cls += ' is-vice-leader';
                  return (
                    <span className={cls} key={m.internId}>
                      {m.name}{m.role ? ` · ${m.role}` : ''}
                      {isLeader ? ' 👑' : ''}
                      {isVice ? ' ⭐' : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <div className="modal-overlay" onClick={closeModal}>
          <form className="panel modal" onClick={(e) => e.stopPropagation()} onSubmit={save} noValidate>
            <div className="modal-head">
              <h3>{editingId ? 'Edit team' : 'Create a team'}</h3>
              <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label htmlFor="team-name">Team name <span className="req">*</span></label>
                <input id="team-name" className={errors.name ? 'input-error' : ''} placeholder="e.g. Web Squad" value={form.name} autoFocus
                  onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors({ ...errors, name: undefined }); }} />
                {errors.name && <span className="field-error">{errors.name}</span>}
              </div>
              <div className="form-field">
                <label htmlFor="team-desc">Description</label>
                <textarea id="team-desc" placeholder="What this team focuses on…" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="form-field">
                <label htmlFor="team-leader">Team leader</label>
                <select id="team-leader" value={form.leaderId}
                  onChange={(e) => setForm({ ...form, leaderId: e.target.value, members: form.members.filter((m) => m !== e.target.value) })}>
                  <option value="">No leader yet</option>
                  {leaders.map((i) => <option key={i.internId} value={i.internId}>{i.name} — {i.role}</option>)}
                </select>
                {leaders.length === 0 && <span className="field-hint">Promote an intern to Team Leader (Interns tab) to assign them here.</span>}
              </div>
              <div className="form-field">
                <label>Members</label>
                {interns.length === 0 && <span className="field-hint">Approve interns first to add members.</span>}
                <span className="field-hint">The team leader is part of the team automatically and is not listed here.</span>
                {interns.length > 0 && (
                  <div className="checkbox-list">
                    {interns.filter((i) => i.internId !== form.leaderId).map((i) => (
                      <label key={i.internId} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={form.members.includes(i.internId)}
                          onChange={() => toggleMember(i.internId, form.members, (m) => setForm({ ...form, members: m }))}
                        />
                        <span>{i.name} <span className="muted small">· {i.role}</span></span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-mini" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" disabled={!form.name}><span className="material-symbols-outlined">group_add</span>Create team</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard / overview tab
// ---------------------------------------------------------------------------
function DashboardTab({ applications, meetings, projects, onGo }) {
  const recent = applications.slice(0, 5);
  const upcoming = meetings
    .filter((m) => m.status !== 'completed')
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .slice(0, 5);

  return (
    <div className="two-col">
      <div className="panel">
        <div className="panel-head">
          <h3>Recent applicants</h3>
          <button className="btn-mini" onClick={() => onGo('Applicants')}>View all</button>
        </div>
        {recent.length === 0 && <p className="muted">No applications yet.</p>}
        <div className="card-list">
          {recent.map((a) => (
            <div className="mini-card" key={a._id}>
              <div>
                <strong>{a.name}</strong>
                <div className="muted small">{a.role || '—'} · {a.college || '—'}</div>
              </div>
              <span className="status-pill" style={{ background: STATUS_COLORS[a.status] || '#888' }}>{a.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Upcoming meetings</h3>
          <button className="btn-mini" onClick={() => onGo('Meetings')}>Schedule</button>
        </div>
        {upcoming.length === 0 && <p className="muted">No meetings scheduled.</p>}
        <div className="card-list">
          {upcoming.map((m) => (
            <div className="mini-card" key={m._id}>
              <div>
                <strong>{m.title}</strong>
                <div className="muted small">{m.attendeeName} · {new Date(m.scheduledAt).toLocaleString()}</div>
              </div>
              {m.link && (
                <a className="btn-mini meet-btn" href={m.link} target="_blank" rel="noreferrer">
                  <span className="material-symbols-outlined">videocam</span>Join
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------
const TABS = [
  { key: 'Dashboard', icon: 'dashboard', sub: 'Overview of applications, interns and activity.' },
  { key: 'Applicants', icon: 'group', sub: 'Review and process internship applications.' },
  { key: 'Job Roles', icon: 'work', sub: 'Manage the open roles shown on the public application form.' },
  { key: 'Projects', icon: 'folder_open', sub: 'Create projects and track their progress.' },
  { key: 'Tasks', icon: 'assignment', sub: 'Assign work to interns and monitor status.' },
  { key: 'Teams', icon: 'groups', sub: 'Organise interns into teams and pick leaders.' },
  { key: 'Meetings', icon: 'event', sub: 'Schedule interviews and email invites.' },
  { key: 'Interns', icon: 'school', sub: 'Monitor active interns and their progress.' },
];

const AdminDashboard = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const authed = !!localStorage.getItem('adminToken');
  const [tab, setTab] = useState('Dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [applications, setApplications] = useState([]);
  const [roles, setRoles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [teams, setTeams] = useState([]);
  const [meetingPreselect, setMeetingPreselect] = useState(null);

  // When true, a failed background refresh stays silent (no toast spam).
  const loadAll = async (background = false) => {
    try {
      const [a, r, p, t, m, tm] = await Promise.all([
        axios.get(`${API}/api/applications`),
        axios.get(`${API}/api/roles`),
        axios.get(`${API}/api/projects`),
        axios.get(`${API}/api/tasks`),
        axios.get(`${API}/api/meetings`),
        axios.get(`${API}/api/teams`),
      ]);
      setApplications(a.data);
      setRoles(r.data);
      setProjects(p.data);
      // The admin only sees work they created — tasks assigned by a team leader
      // (assignedBy set) and meetings scheduled by a leader (createdBy set) are hidden.
      setTasks(t.data.filter((task) => !task.assignedBy));
      setMeetings(m.data.filter((meet) => !meet.createdBy));
      setTeams(tm.data);
    } catch (e) {
      console.error('Error loading dashboard:', e);
      if (!background) toast.error(apiError(e, 'Could not load dashboard data. Is the backend running?'));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authed) return;
    loadAll();
    // Auto-sync: quietly refresh in the background so new applicants, tasks and
    // meetings appear without the admin needing to reload the page.
    const id = setInterval(() => loadAll(true), 10000);
    return () => clearInterval(id);
  }, [authed]);

  const logout = () => {
    localStorage.removeItem('adminToken');
    navigate('/login');
  };

  const interns = applications.filter((a) => a.status === 'approved' && a.internId);

  if (!authed) return <Navigate to="/login" replace />;
  if (loading) return <div className="loading">Loading dashboard…</div>;

  const stats = [
    { label: 'Applicants', value: applications.length, icon: 'group' },
    { label: 'Interns', value: interns.length, icon: 'school' },
    { label: 'Open Roles', value: roles.length, icon: 'work' },
    { label: 'Projects', value: projects.length, icon: 'folder_open' },
    { label: 'Teams', value: teams.length, icon: 'groups' },
  ];

  const active = TABS.find((t) => t.key === tab) || TABS[0];

  return (
    <div className="admin-shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-lockup">
            <span className="brand-mark">GS</span>
            <div className="brand-text">
              <span className="brand-name">GSPL</span>
              <span className="brand-sub">Internship Console</span>
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
            <h1>{active.key}</h1>
            <p className="muted">{active.sub}</p>
          </div>
          <div className="topbar-meta">
            <span className="material-symbols-outlined">calendar_today</span>
            {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
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
        {tab === 'Dashboard' && (
          <DashboardTab
            applications={applications} meetings={meetings} projects={projects}
            onGo={(t) => setTab(t)}
          />
        )}
        {tab === 'Applicants' && (
          <ApplicantsTab
            applications={applications} projects={projects} reload={loadAll}
            onSchedule={(app) => { setMeetingPreselect(app); setTab('Meetings'); }}
          />
        )}
        {tab === 'Job Roles' && <RolesTab roles={roles} reload={loadAll} />}
        {tab === 'Projects' && <ProjectsTab projects={projects} reload={loadAll} />}
        {tab === 'Tasks' && <TasksTab tasks={tasks} projects={projects} interns={interns} reload={loadAll} />}
        {tab === 'Teams' && <TeamsTab teams={teams} interns={interns} reload={loadAll} />}
        {tab === 'Meetings' && (
          <MeetingsTab
            meetings={meetings} applications={applications} reload={loadAll}
            preselect={meetingPreselect} clearPreselect={() => setMeetingPreselect(null)}
          />
        )}
        {tab === 'Interns' && <InternsTab interns={interns} tasks={tasks} reload={loadAll} />}
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
