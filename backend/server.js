require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');

const { initPb, getPb, normalize } = require('./pb');
const { uploadBuffer, moveObject, deletePrefix, signedUrl, UPLOAD_ROOT } = require('./storage');

const app = express();
app.use(cors());
app.use(express.json());

// Serve uploaded resumes (local filesystem storage) at /uploads.
app.use('/uploads', express.static(UPLOAD_ROOT));

// Resume files are parsed into memory, then written to local disk by storage.js,
// so we use multer's memory storage rather than writing the multipart body twice.
const upload = multer({ storage: multer.memoryStorage() });

// Note: macOS reserves port 5000 for AirPlay Receiver, so we default to 5001.
const PORT = process.env.PORT || 5001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';


console.log("EMAIL_USER:", process.env.EMAIL_USER);
console.log("EMAIL_PASS LENGTH:", process.env.EMAIL_PASS?.length);

// Nodemailer Transporter Configuration
const dns = require('dns');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },

  lookup: (hostname, options, callback) => {
    dns.lookup(hostname, { family: 4 }, callback);
  },

  connectionTimeout: 10000
});

app.get("/verify-mail", async (req, res) => {
  try {
    const nodemailer = require("nodemailer");

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    transporter.verify((err, success) => {
      console.log("VERIFY RESULT:");
      console.log(err || success);

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message,
          code: err.code
        });
      }

      return res.json({
        success: true,
        message: "SMTP connection successful"
      });
    });

  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

// Coerce a date/datetime value into the full ISO form PocketBase's `date` field
// accepts. The meeting forms send a datetime-local value like "2026-07-01T14:30"
// (no seconds, no timezone), which PocketBase silently rejects and stores as an
// empty string — leaving every dashboard showing "Invalid Date". Parsing it (as
// local wall-clock time) and re-emitting ISO makes it round-trip correctly.
function toPbDate(value) {
  if (value === undefined || value === null || value === '') return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// Turn an arbitrary string into a safe object-name fragment.
function slugify(str) {
  return String(str || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'applicant';
}

// ---------------------------------------------------------------------------
// PocketBase helpers
// ---------------------------------------------------------------------------

// getOne that returns null instead of throwing on a 404.
async function findById(pb, coll, id, opts) {
  try {
    return await pb.collection(coll).getOne(id, opts || {});
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

// Count records matching a filter.
async function count(pb, coll, filter) {
  const r = await pb.collection(coll).getList(1, 1, { filter });
  return r.totalItems;
}

// Resolve a list of intern IDs into { internId, name, role, email, appId } objects.
async function resolveInterns(pb, internIds) {
  if (!internIds || internIds.length === 0) return [];
  const uniq = [...new Set(internIds)];
  const filter = uniq.map((id) => pb.filter('internId = {:v}', { v: id })).join(' || ');
  const apps = await pb.collection('applications').getFullList({ filter });
  const byId = {};
  apps.forEach((a) => {
    byId[a.internId] = { internId: a.internId, name: a.name, role: a.role, email: a.email, appId: a.id };
  });
  return internIds.map((id) => byId[id] || { internId: id, name: id, role: '', email: '', appId: null });
}

// Attach resolved leader + members to a (normalized) team object.
async function decorateTeam(pb, team) {
  const members = await resolveInterns(pb, team.members || []);
  const leader = team.leaderId ? (await resolveInterns(pb, [team.leaderId]))[0] : null;
  const viceLeader = team.viceLeaderId ? (await resolveInterns(pb, [team.viceLeaderId]))[0] : null;
  return { ...team, leader, viceLeader, memberDetails: members };
}

// Add an intern to a project's roster (the PocketBase equivalent of $addToSet).
async function addInternToProject(pb, projectId, internId) {
  const p = await findById(pb, 'projects', projectId);
  if (!p) return;
  const arr = p.assignedInterns || [];
  if (!arr.includes(internId)) {
    await pb.collection('projects').update(projectId, { assignedInterns: [...arr, internId] });
  }
}

// Generate the next intern ID for the current year, e.g. GSPL-INT-2026-0001.
// The sequence number is the lowest one not currently in use, so IDs freed by
// removed interns are reused. TL-prefixed IDs are ignored (they don't match).
async function generateInternId(pb) {
  const year = new Date().getFullYear();
  const prefix = `GSPL-INT-${year}-`;
  const re = new RegExp(`^${prefix}\\d{4}$`);
  const existing = await pb.collection('applications').getFullList({
    filter: pb.filter('internId ~ {:p}', { p: prefix }),
  });
  const used = new Set(
    existing.filter((a) => re.test(a.internId)).map((a) => parseInt(a.internId.slice(prefix.length), 10))
  );
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

// Rename an intern's ID across every collection that references it, and move
// their resume file on disk. Used when promoting/demoting a team leader.
async function renameInternIdEverywhere(pb, oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;

  const apps = await pb.collection('applications').getFullList({ filter: pb.filter('internId = {:v}', { v: oldId }) });
  const application = apps[0];

  // Tasks assigned to, or assigned by, this intern.
  for (const t of await pb.collection('tasks').getFullList({ filter: pb.filter('internId = {:v}', { v: oldId }) })) {
    await pb.collection('tasks').update(t.id, { internId: newId });
  }
  for (const t of await pb.collection('tasks').getFullList({ filter: pb.filter('assignedBy = {:v}', { v: oldId }) })) {
    await pb.collection('tasks').update(t.id, { assignedBy: newId });
  }

  // Project rosters (JSON array of intern IDs).
  for (const p of await pb.collection('projects').getFullList()) {
    const arr = p.assignedInterns || [];
    if (arr.includes(oldId)) {
      await pb.collection('projects').update(p.id, { assignedInterns: arr.map((x) => (x === oldId ? newId : x)) });
    }
  }

  // Team membership + leadership.
  for (const tm of await pb.collection('teams').getFullList()) {
    const patch = {};
    const arr = tm.members || [];
    if (arr.includes(oldId)) patch.members = arr.map((x) => (x === oldId ? newId : x));
    if (tm.leaderId === oldId) patch.leaderId = newId;
    if (tm.viceLeaderId === oldId) patch.viceLeaderId = newId;
    if (Object.keys(patch).length) await pb.collection('teams').update(tm.id, patch);
  }

  // Meetings: the leader who created them, and any attendee entries.
  for (const m of await pb.collection('meetings').getFullList({ filter: pb.filter('createdBy = {:v}', { v: oldId }) })) {
    await pb.collection('meetings').update(m.id, { createdBy: newId });
  }
  for (const m of await pb.collection('meetings').getFullList()) {
    const att = m.attendees || [];
    if (att.some((a) => a.internId === oldId)) {
      await pb.collection('meetings').update(m.id, {
        attendees: att.map((a) => (a.internId === oldId ? { ...a, internId: newId } : a)),
      });
    }
  }

  // Move the resume file on disk and re-point the stored path.
  if (application) {
    const patch = { internId: newId };
    if (application.resumePath && application.resumePath.includes(`resumes/${oldId}/`)) {
      const newPath = application.resumePath.replace(`resumes/${oldId}/`, `resumes/${newId}/`);
      try { await moveObject(application.resumePath, newPath); } catch (e) { console.error('Resume move failed:', e.message); }
      patch.resumePath = newPath;
      patch.uploadFolder = `resumes/${newId}`;
    }
    await pb.collection('applications').update(application.id, patch);
  }
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

// POST an application
app.post('/api/applications', upload.fields([{ name: 'resume', maxCount: 1 }]), async (req, res) => {
  try {
    const pb = await getPb();
    const { name, email, phone, college, graduationYear, role } = req.body;

    const file = req.files?.resume?.[0];
    if (!file) return res.status(400).json({ error: 'Resume document is required.' });

    // Each applicant's resume lives under its own folder on disk.
    const folder = `${slugify(name)}-${Date.now().toString(36)}`;
    const objectName = `resumes/${folder}/${file.originalname}`;
    await uploadBuffer(objectName, file.buffer, file.mimetype);

    const record = await pb.collection('applications').create({
      name, email, phone, college, graduationYear, role,
      resumePath: objectName,
      uploadFolder: `resumes/${folder}`,
      status: 'pending',
      isTeamLeader: false,
    });

    const mailOptions = {
      from: '"GSPL Team" <alphagspl628@gmail.com>',
      to: email,
      subject: `Your application to GSPL — Received`,
      html: `
        <div style="font-family: sans-serif; color: #333;">
          <p>Hi ${name},</p>
          <p>Thank you for applying for the <strong>${role} Internship</strong> at <strong>GSPL.</strong> We're glad you're interested in joining our team, and we're pleased to confirm that your application and resume have been received.</p>
          <p>Our team is now reviewing applications and will be in touch within 2–3 business days regarding next steps. If your profile is a strong fit, we'll reach out to schedule an interview.</p>
          <p>In the meantime, feel free to reply to this email if you have any questions.</p>
          <strong><p>Warm regards,<br>The GSPL Team</p></strong>
        </div>
      `
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) console.error('Error sending confirmation email:', error);
      else console.log('Confirmation email sent successfully:', info.response);
    });

    res.status(201).json({ message: 'Application submitted successfully!', application: normalize(record) });
  } catch (error) {
    console.error('Error submitting application:', error);
    res.status(500).json({ error: 'Server error during submission.' });
  }
});

// GET all applications
app.get('/api/applications', async (req, res) => {
  try {
    const pb = await getPb();
    const records = await pb.collection('applications').getFullList({ sort: '-created', expand: 'assignedProject' });
    res.status(200).json(records.map(normalize));
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: 'Server error fetching applications.' });
  }
});

// Update an application's status (reviewing / interview / rejected)
app.patch('/api/applications/:id/status', async (req, res) => {
  try {
    const pb = await getPb();
    const { status } = req.body;
    const existing = await findById(pb, 'applications', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Application not found.' });
    const record = await pb.collection('applications').update(req.params.id, { status });
    res.status(200).json(normalize(record));
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ error: 'Server error updating status.' });
  }
});

// Approve / select an applicant as an intern — generates a unique intern ID
app.post('/api/applications/:id/approve', async (req, res) => {
  try {
    const pb = await getPb();
    const { projectId } = req.body;
    const application = await findById(pb, 'applications', req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const patch = { status: 'approved', approvedAt: new Date().toISOString() };
    const internId = application.internId || await generateInternId(pb);
    patch.internId = internId;

    // Move the resume under the intern ID prefix so files are easy to identify.
    if (application.resumePath && !application.resumePath.includes(`resumes/${internId}/`)) {
      const filename = application.resumePath.split('/').pop();
      const newPath = `resumes/${internId}/${filename}`;
      try { await moveObject(application.resumePath, newPath); } catch (e) { console.error('Could not move resume:', e.message); }
      patch.resumePath = newPath;
      patch.uploadFolder = `resumes/${internId}`;
    }

    let project = null;
    if (projectId) {
      patch.assignedProject = projectId;
      await addInternToProject(pb, projectId, internId);
      project = await findById(pb, 'projects', projectId);
    }

    await pb.collection('applications').update(application.id, patch);

    const mailOptions = {
      from: '"GSPL Team" <alphagspl628@gmail.com>',
      to: application.email,
      subject: `Congratulations — You've been selected at GSPL!`,
      html: `
        <div style="font-family: sans-serif; color: #333;">
          <p>Hi ${application.name},</p>
          <p>We're thrilled to offer you an internship at <strong>GSPL</strong>! Welcome aboard.</p>
          <p>Your unique Intern ID is: <strong style="font-size:1.2rem; color:#ae2f34;">${internId}</strong></p>
          ${project ? `<p>You've been assigned to the project: <strong>${project.name}</strong>.</p>` : ''}
          <p>Log in to your Intern Dashboard using your <strong>email</strong> and the <strong>Intern ID</strong> above to view your projects, tasks, and deadlines.</p>
          <strong><p>Warm regards,<br>The GSPL Team</p></strong>
        </div>
      `
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) console.error('Error sending approval email:', error);
      else console.log('Approval email sent:', info.response);
    });

    const populated = await pb.collection('applications').getOne(application.id, { expand: 'assignedProject' });
    res.status(200).json(normalize(populated));
  } catch (error) {
    console.error('Error approving applicant:', error);
    res.status(500).json({ error: 'Server error approving applicant.' });
  }
});

async function handleLeaderRemoval(pb, oldLeaderId) {
  const ledTeams = await pb.collection('teams').getFullList({ filter: pb.filter('leaderId = {:v}', { v: oldLeaderId }) });
  
  for (const tm of ledTeams) {
    let newLeaderId = '';
    
    if (tm.viceLeaderId) {
      const vtlApp = (await pb.collection('applications').getFullList({ filter: pb.filter('internId = {:v}', { v: tm.viceLeaderId }) }))[0];
      if (vtlApp) {
        const promotedId = `TL-${tm.viceLeaderId}`;
        
        if (!vtlApp.isTeamLeader && !tm.viceLeaderId.startsWith('TL-')) {
          await renameInternIdEverywhere(pb, tm.viceLeaderId, promotedId);
        }
        await pb.collection('applications').update(vtlApp.id, { isTeamLeader: true });
        newLeaderId = promotedId;
        
        const members = await resolveInterns(pb, tm.members || []);
        members.forEach(m => {
          if (!m.email) return;
          transporter.sendMail({
            from: '"GSPL Team" <alphagspl628@gmail.com>',
            to: m.email,
            subject: `Leadership Change — ${tm.name}`,
            html: `<div style="font-family: sans-serif; color: #333;"><p>Hi ${m.name},</p><p>The previous Team Leader for <strong>${tm.name}</strong> has left or been removed.</p><p><strong>${vtlApp.name}</strong> (the Vice Team Leader) has automatically been promoted to be your new Team Leader.</p><strong><p>Warm regards,<br>The GSPL Team</p></strong></div>`
          }, (error) => { if (error) console.error(error); });
        });
      }
    } else {
      const members = await resolveInterns(pb, tm.members || []);
      members.forEach(m => {
        if (!m.email) return;
        transporter.sendMail({
          from: '"GSPL Team" <alphagspl628@gmail.com>',
          to: m.email,
          subject: `Leadership Change — ${tm.name}`,
          html: `<div style="font-family: sans-serif; color: #333;"><p>Hi ${m.name},</p><p>The previous Team Leader for <strong>${tm.name}</strong> has left or been removed. Your team currently does not have a Team Leader.</p><strong><p>Warm regards,<br>The GSPL Team</p></strong></div>`
        }, (error) => { if (error) console.error(error); });
      });
    }
    
    await pb.collection('teams').update(tm.id, { leaderId: newLeaderId, viceLeaderId: '' });
  }
}

// Delete an applicant / remove an intern. Cleans up their files, tasks,
// meetings, project rosters and team memberships. The intern ID is freed.
app.delete('/api/applications/:id', async (req, res) => {
  try {
    const pb = await getPb();
    const application = await findById(pb, 'applications', req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    if (application.uploadFolder) {
      try { await deletePrefix(application.uploadFolder); } catch (e) { console.error('Could not remove resume objects:', e.message); }
    }

    if (application.internId) {
      const id = application.internId;
      for (const t of await pb.collection('tasks').getFullList({ filter: pb.filter('internId = {:v}', { v: id }) })) {
        await pb.collection('tasks').delete(t.id);
      }
      for (const p of await pb.collection('projects').getFullList()) {
        const arr = p.assignedInterns || [];
        if (arr.includes(id)) {
          await pb.collection('projects').update(p.id, { assignedInterns: arr.filter((x) => x !== id) });
        }
      }
      for (const tm of await pb.collection('teams').getFullList()) {
        const patch = {};
        const arr = tm.members || [];
        if (arr.includes(id)) patch.members = arr.filter((x) => x !== id);
        if (tm.viceLeaderId === id) patch.viceLeaderId = '';
        if (Object.keys(patch).length) await pb.collection('teams').update(tm.id, patch);
      }
      
      // If they were a team leader, handle VTL promotion
      await handleLeaderRemoval(pb, id);
    }

    for (const m of await pb.collection('meetings').getFullList({ filter: pb.filter('application = {:aid}', { aid: application.id }) })) {
      await pb.collection('meetings').delete(m.id);
    }
    await pb.collection('applications').delete(application.id);

    res.status(200).json({ message: 'Applicant removed.' });
  } catch (error) {
    console.error('Error deleting applicant:', error);
    res.status(500).json({ error: 'Server error deleting applicant.' });
  }
});

// Promote an approved intern to team leader. Prefixes their intern ID with
// "TL-" (cascading the change everywhere) and emails them their new ID.
app.post('/api/applications/:id/promote-leader', async (req, res) => {
  try {
    const pb = await getPb();
    const application = await findById(pb, 'applications', req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    if (application.status !== 'approved' || !application.internId) {
      return res.status(400).json({ error: 'Only approved interns can be promoted.' });
    }

    // Idempotent: if already a leader / already prefixed, just ensure the flag.
    if (!application.isTeamLeader && !application.internId.startsWith('TL-')) {
      await renameInternIdEverywhere(pb, application.internId, `TL-${application.internId}`);
    }
    await pb.collection('applications').update(application.id, { isTeamLeader: true });
    const updated = await pb.collection('applications').getOne(application.id);

    const mailOptions = {
      from: '"GSPL Team" <alphagspl628@gmail.com>',
      to: updated.email,
      subject: `You've been selected as a Team Leader at GSPL!`,
      html: `
        <div style="font-family: sans-serif; color: #333;">
          <p>Hi ${updated.name},</p>
          <p>Congratulations! You've been selected as a <strong>Team Leader</strong> at <strong>GSPL</strong>.</p>
          <p>As part of this new role, your Intern ID has been updated to:</p>
          <p><strong style="font-size:1.2rem; color:#ae2f34;">${updated.internId}</strong></p>
          <p>From now on, please use this new ID (along with your email) to log in. You'll land on your new <strong>Team Leader dashboard</strong>, where you can manage your team's projects, tasks, meetings and members.</p>
          <strong><p>Warm regards,<br>The GSPL Team</p></strong>
        </div>
      `
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) console.error('Error sending promotion email:', error);
      else console.log('Promotion email sent:', info.response);
    });

    res.status(200).json(normalize(updated));
  } catch (error) {
    console.error('Error promoting team leader:', error);
    res.status(500).json({ error: 'Server error promoting team leader.' });
  }
});

// Demote a team leader back to a regular intern. Strips the "TL-" prefix
// (cascading everywhere) and clears any team leadership they held.
app.post('/api/applications/:id/demote-leader', async (req, res) => {
  try {
    const pb = await getPb();
    const application = await findById(pb, 'applications', req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    if (application.internId && application.internId.startsWith('TL-')) {
      const newId = application.internId.slice(3); // drop the "TL-" prefix
      await renameInternIdEverywhere(pb, application.internId, newId);
      await handleLeaderRemoval(pb, newId);
      
      // Email the demoted TL
      const mailOptions = {
        from: '"GSPL Team" <alphagspl628@gmail.com>',
        to: application.email,
        subject: `Leadership Change at GSPL`,
        html: `
          <div style="font-family: sans-serif; color: #333;">
            <p>Hi ${application.name},</p>
            <p>You have been removed from your position as a <strong>Team Leader</strong>.</p>
            <p>Your Intern ID has been updated back to: <strong style="font-size:1.2rem; color:#ae2f34;">${newId}</strong></p>
            <p>Please use this ID to log in to your dashboard going forward.</p>
            <strong><p>Warm regards,<br>The GSPL Team</p></strong>
          </div>
        `
      };
      transporter.sendMail(mailOptions, (error) => {
        if (error) console.error('Error sending demotion email:', error);
      });
    }
    await pb.collection('applications').update(application.id, { isTeamLeader: false });
    const updated = await pb.collection('applications').getOne(application.id);

    res.status(200).json(normalize(updated));
  } catch (error) {
    console.error('Error demoting team leader:', error);
    res.status(500).json({ error: 'Server error demoting team leader.' });
  }
});

// ---------------------------------------------------------------------------
// Job Roles
// ---------------------------------------------------------------------------

app.get('/api/roles', async (req, res) => {
  try {
    const pb = await getPb();
    const roles = await pb.collection('jobroles').getFullList({ sort: '-created' });
    res.status(200).json(roles.map(normalize));
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching roles.' });
  }
});

app.post('/api/roles', async (req, res) => {
  try {
    const pb = await getPb();
    const { title, department, description, openings } = req.body;
    if (!title) return res.status(400).json({ error: 'Role title is required.' });
    const role = await pb.collection('jobroles').create({
      title, department: department || '', description: description || '', openings: Number(openings) || 1,
    });
    res.status(201).json(normalize(role));
  } catch (error) {
    res.status(500).json({ error: 'Server error creating role.' });
  }
});

app.patch('/api/roles/:id', async (req, res) => {
  try {
    const pb = await getPb();
    const existing = await findById(pb, 'jobroles', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Role not found.' });
    const role = await pb.collection('jobroles').update(req.params.id, req.body);
    res.status(200).json(normalize(role));
  } catch (error) {
    res.status(500).json({ error: 'Server error updating role.' });
  }
});

app.delete('/api/roles/:id', async (req, res) => {
  try {
    const pb = await getPb();
    await pb.collection('jobroles').delete(req.params.id);
    res.status(200).json({ message: 'Role deleted.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error deleting role.' });
  }
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

app.get('/api/projects', async (req, res) => {
  try {
    const pb = await getPb();
    const records = await pb.collection('projects').getFullList({ sort: '-created' });
    const withProgress = await Promise.all(records.map(async (p) => {
      const total = await count(pb, 'tasks', pb.filter('project = {:id}', { id: p.id }));
      const done = await count(pb, 'tasks', pb.filter('project = {:id} && status = "done"', { id: p.id }));
      const progress = total === 0 ? 0 : Math.round((done / total) * 100);
      return { ...normalize(p), progress, totalTasks: total, doneTasks: done };
    }));
    res.status(200).json(withProgress);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching projects.' });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const pb = await getPb();
    const { name, description, deadline, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required.' });
    const project = await pb.collection('projects').create({
      name, description: description || '', deadline: deadline || '', status: status || 'active', assignedInterns: [],
    });
    res.status(201).json(normalize(project));
  } catch (error) {
    res.status(500).json({ error: 'Server error creating project.' });
  }
});

app.patch('/api/projects/:id', async (req, res) => {
  try {
    const pb = await getPb();
    const existing = await findById(pb, 'projects', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Project not found.' });
    // Never let an edit clobber the roster.
    const { assignedInterns, ...patch } = req.body;
    const project = await pb.collection('projects').update(req.params.id, patch);
    res.status(200).json(normalize(project));
  } catch (error) {
    res.status(500).json({ error: 'Server error updating project.' });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    const pb = await getPb();
    await pb.collection('projects').delete(req.params.id);
    for (const t of await pb.collection('tasks').getFullList({ filter: pb.filter('project = {:id}', { id: req.params.id }) })) {
      await pb.collection('tasks').delete(t.id);
    }
    res.status(200).json({ message: 'Project deleted.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error deleting project.' });
  }
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

app.get('/api/tasks', async (req, res) => {
  try {
    const pb = await getPb();
    const clauses = [];
    if (req.query.internId) clauses.push(pb.filter('internId = {:v}', { v: req.query.internId }));
    if (req.query.projectId) clauses.push(pb.filter('project = {:v}', { v: req.query.projectId }));
    const records = await pb.collection('tasks').getFullList({
      filter: clauses.join(' && '), sort: '-created', expand: 'project',
    });
    res.status(200).json(records.map(normalize));
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching tasks.' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const pb = await getPb();
    const { title, description, project, internId, dueDate, status, assignedBy } = req.body;
    if (!title || !internId) {
      return res.status(400).json({ error: 'Title and internId are required.' });
    }
    const task = await pb.collection('tasks').create({
      title, description: description || '', project: project || '', internId,
      dueDate: dueDate || '', status: status || 'todo', assignedBy: assignedBy || '',
    });
    if (project) await addInternToProject(pb, project, internId);
    const populated = await pb.collection('tasks').getOne(task.id, { expand: 'project' });
    res.status(201).json(normalize(populated));
  } catch (error) {
    res.status(500).json({ error: 'Server error creating task.' });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const pb = await getPb();
    const existing = await findById(pb, 'tasks', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Task not found.' });
    await pb.collection('tasks').update(req.params.id, req.body);
    const task = await pb.collection('tasks').getOne(req.params.id, { expand: 'project' });
    res.status(200).json(normalize(task));
  } catch (error) {
    res.status(500).json({ error: 'Server error updating task.' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const pb = await getPb();
    await pb.collection('tasks').delete(req.params.id);
    res.status(200).json({ message: 'Task deleted.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error deleting task.' });
  }
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

app.get('/api/teams', async (req, res) => {
  try {
    const pb = await getPb();
    const teams = await pb.collection('teams').getFullList({ sort: '-created' });
    const decorated = await Promise.all(teams.map((t) => decorateTeam(pb, normalize(t))));
    res.status(200).json(decorated);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching teams.' });
  }
});

app.post('/api/teams', async (req, res) => {
  try {
    const pb = await getPb();
    const { name, description, leaderId, members } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required.' });
    const memberSet = new Set(members || []);
    if (leaderId) memberSet.add(leaderId); // leader is always part of the team
    const team = await pb.collection('teams').create({
      name, description: description || '', leaderId: leaderId || '', members: [...memberSet],
    });
    res.status(201).json(await decorateTeam(pb, normalize(team)));
  } catch (error) {
    res.status(500).json({ error: 'Server error creating team.' });
  }
});

app.patch('/api/teams/:id', async (req, res) => {
  try {
    const pb = await getPb();
    const existing = await findById(pb, 'teams', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Team not found.' });

    const { name, description, leaderId, viceLeaderId, members } = req.body;
    const update = {};
    let leaderChanged = false;
    let viceLeaderChanged = false;

    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (leaderId !== undefined) {
      update.leaderId = leaderId || '';
      if (update.leaderId !== existing.leaderId) leaderChanged = true;
    }
    if (viceLeaderId !== undefined) {
      update.viceLeaderId = viceLeaderId || '';
      if (update.viceLeaderId !== existing.viceLeaderId) viceLeaderChanged = true;
    }
    if (members !== undefined) {
      const memberSet = new Set(members);
      if (update.leaderId) memberSet.add(update.leaderId);
      else if (leaderId === undefined && existing.leaderId) memberSet.add(existing.leaderId);
      
      if (update.viceLeaderId) memberSet.add(update.viceLeaderId);
      else if (viceLeaderId === undefined && existing.viceLeaderId) memberSet.add(existing.viceLeaderId);
      
      update.members = [...memberSet];
    }
    const team = await pb.collection('teams').update(req.params.id, update);
    const decorated = await decorateTeam(pb, normalize(team));

    if (leaderChanged || viceLeaderChanged) {
      const teamMembers = await resolveInterns(pb, team.members || []);
      const newLeader = leaderChanged && team.leaderId ? (await resolveInterns(pb, [team.leaderId]))[0] : null;
      const newViceLeader = viceLeaderChanged && team.viceLeaderId ? (await resolveInterns(pb, [team.viceLeaderId]))[0] : null;

      teamMembers.forEach(m => {
        if (!m.email) return;
        let html = `<div style="font-family: sans-serif; color: #333;"><p>Hi ${m.name},</p>`;
        html += `<p>There has been a leadership update for your team <strong>${team.name}</strong>:</p><ul>`;
        if (leaderChanged) {
          html += `<li><strong>Team Leader:</strong> ${newLeader ? newLeader.name : 'None'}</li>`;
        }
        if (viceLeaderChanged) {
          html += `<li><strong>Vice Team Leader:</strong> ${newViceLeader ? newViceLeader.name : 'None'}</li>`;
        }
        html += `</ul><p>Please log in to your dashboard to view the latest team structure.</p><strong><p>Warm regards,<br>The GSPL Team</p></strong></div>`;

        transporter.sendMail({
          from: '"GSPL Team" <alphagspl628@gmail.com>',
          to: m.email,
          subject: `Team Leadership Update — ${team.name}`,
          html
        }, (error) => { if (error) console.error('Error sending team leadership email:', error); });
      });
    }

    res.status(200).json(decorated);
  } catch (error) {
    res.status(500).json({ error: 'Server error updating team.' });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    const pb = await getPb();
    await pb.collection('teams').delete(req.params.id);
    res.status(200).json({ message: 'Team deleted.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error deleting team.' });
  }
});

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

app.get('/api/meetings', async (req, res) => {
  try {
    const pb = await getPb();
    const meetings = await pb.collection('meetings').getFullList({ sort: 'scheduledAt', expand: 'application' });
    res.status(200).json(meetings.map(normalize));
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching meetings.' });
  }
});

app.post('/api/meetings', async (req, res) => {
  try {
    const pb = await getPb();
    const { title, applicationId, link, notes, createdBy, scope, teamId, memberIds } = req.body;
    const scheduledAt = toPbDate(req.body.scheduledAt);

    // Two flavours of meeting:
    //  - Team-leader meeting: scope 'team' or 'members', targeting several
    //    members (resolved into the `attendees` array). No single application.
    //  - Admin/individual meeting: tied to one applicant via `applicationId`.
    let meeting;
    let recipients = []; // { name, email } to email the invite to

    if (scope === 'team' || scope === 'members') {
      let memberIdList = memberIds || [];
      if (scope === 'team' && teamId) {
        const team = await findById(pb, 'teams', teamId);
        if (!team) return res.status(404).json({ error: 'Team not found.' });
        memberIdList = (team.members || []).filter((m) => m !== createdBy);
      }
      const attendees = await resolveInterns(pb, memberIdList);
      if (attendees.length === 0) {
        return res.status(400).json({ error: 'Select at least one member for the meeting.' });
      }
      meeting = await pb.collection('meetings').create({
        title,
        application: '',
        attendees: attendees.map((a) => ({ internId: a.internId, name: a.name, email: a.email })),
        team: teamId || '',
        scope,
        scheduledAt,
        link: link || '',
        notes: notes || '',
        status: 'scheduled',
        createdBy: createdBy || '',
      });
      recipients = attendees.filter((a) => a.email).map((a) => ({ name: a.name, email: a.email }));
    } else {
      const application = await findById(pb, 'applications', applicationId);
      if (!application) return res.status(404).json({ error: 'Applicant not found.' });

      meeting = await pb.collection('meetings').create({
        title,
        application: applicationId,
        attendeeName: application.name,
        attendeeEmail: application.email,
        scope: 'individual',
        scheduledAt,
        link: link || '',
        notes: notes || '',
        status: 'scheduled',
        createdBy: createdBy || '',
      });
      recipients = [{ name: application.name, email: application.email }];
    }

    // Email the invite
    const start = new Date(scheduledAt);
    const end = new Date(start.getTime() + 30 * 60000);
    const dateStr = start.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeOpts = { hour: 'numeric', minute: '2-digit', hour12: true };
    const timeStr = `${start.toLocaleTimeString('en-US', timeOpts)} – ${end.toLocaleTimeString('en-US', timeOpts)}`;

    recipients.forEach(({ name, email }) => {
      if (!email) return;
      const mailOptions = {
        from: '"GSPL Team" <alphagspl628@gmail.com>',
        to: email,
        subject: `Meeting scheduled — ${title}`,
        html: `
          <div style="font-family: sans-serif; color: #333;">
            <p>Hi ${name},</p>
            <p>A meeting has been scheduled with the GSPL team:</p>
            <ul>
              <li><strong>${title}</strong></li>
              <li>Date: ${dateStr}</li>
              <li>Time: ${timeStr}</li>
              ${link ? `<li>Google Meet: <a href="${link}">${link}</a></li>` : ''}
            </ul>
            ${link ? `
              <p style="margin:24px 0;">
                <a href="${link}" style="background:#1a73e8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block;">
                  Join Google Meet
                </a>
              </p>
              <p style="font-size:13px;color:#777;">Or copy this link into your browser: ${link}</p>
            ` : ''}
            ${notes ? `<p>${notes}</p>` : ''}
            <strong><p>Warm regards,<br>The GSPL Team</p></strong>
          </div>
        `
      };
      transporter.sendMail(mailOptions, (error) => {
        if (error) console.error('Error sending meeting email:', error);
      });
    });

    const populated = await pb.collection('meetings').getOne(meeting.id, { expand: 'application' });
    res.status(201).json(normalize(populated));
  } catch (error) {
    console.error('Error scheduling meeting:', error);
    res.status(500).json({ error: 'Server error scheduling meeting.' });
  }
});

app.patch('/api/meetings/:id', async (req, res) => {
  try {
    const pb = await getPb();
    const existing = await findById(pb, 'meetings', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Meeting not found.' });

    const { title, applicationId, scheduledAt, link, notes, status } = req.body;
    const update = {};
    if (title !== undefined) update.title = title;
    if (scheduledAt !== undefined) update.scheduledAt = toPbDate(scheduledAt);
    if (link !== undefined) update.link = link;
    if (notes !== undefined) update.notes = notes;
    if (status !== undefined) update.status = status;
    if (applicationId) {
      const application = await findById(pb, 'applications', applicationId);
      if (!application) return res.status(404).json({ error: 'Applicant not found.' });
      update.application = applicationId;
      update.attendeeName = application.name;
      update.attendeeEmail = application.email;
    }
    await pb.collection('meetings').update(req.params.id, update);
    const meeting = await pb.collection('meetings').getOne(req.params.id, { expand: 'application' });
    res.status(200).json(normalize(meeting));
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({ error: 'Server error updating meeting.' });
  }
});

app.delete('/api/meetings/:id', async (req, res) => {
  try {
    const pb = await getPb();
    await pb.collection('meetings').delete(req.params.id);
    res.status(200).json({ message: 'Meeting deleted.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error deleting meeting.' });
  }
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

// Redirect to the served URL for an applicant's resume file.
app.get('/api/applications/:id/resume', async (req, res) => {
  try {
    const pb = await getPb();
    const application = await findById(pb, 'applications', req.params.id);
    if (!application || !application.resumePath) return res.status(404).json({ error: 'Resume not found.' });
    const url = await signedUrl(application.resumePath);
    res.redirect(url);
  } catch (error) {
    console.error('Error generating resume URL:', error);
    res.status(500).json({ error: 'Server error fetching resume.' });
  }
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Admin login — simple shared password gate
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.status(200).json({ ok: true, token: 'admin' });
  }
  return res.status(401).json({ error: 'Invalid admin password.' });
});

// Intern login — email + the unique intern ID generated on approval
app.post('/api/intern/login', async (req, res) => {
  try {
    const pb = await getPb();
    const { email, internId } = req.body;
    const matches = await pb.collection('applications').getFullList({
      filter: pb.filter('email = {:e} && internId = {:i} && status = "approved"', {
        e: (email || '').trim(), i: (internId || '').trim(),
      }),
    });
    const application = matches[0];
    if (!application) {
      return res.status(401).json({ error: 'Invalid credentials, or you have not been selected yet.' });
    }
    res.status(200).json({
      ok: true,
      internId: application.internId,
      name: application.name,
      isTeamLeader: !!application.isTeamLeader,
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Intern dashboard data
app.get('/api/intern/:internId/dashboard', async (req, res) => {
  try {
    const pb = await getPb();
    const { internId } = req.params;
    const interns = await pb.collection('applications').getFullList({
      filter: pb.filter('internId = {:v} && status = "approved"', { v: internId }), expand: 'assignedProject',
    });
    const intern = interns[0];
    if (!intern) return res.status(404).json({ error: 'Intern not found.' });

    const taskRecords = await pb.collection('tasks').getFullList({
      filter: pb.filter('internId = {:v}', { v: internId }), sort: 'dueDate,-created', expand: 'project',
    });

    const allProjectRecords = await pb.collection('projects').getFullList({ sort: '-created' });
    const projectRecords = allProjectRecords.filter((p) => (p.assignedInterns || []).includes(internId));
    const projectsWithProgress = await Promise.all(projectRecords.map(async (p) => {
      const total = await count(pb, 'tasks', pb.filter('project = {:id} && internId = {:i}', { id: p.id, i: internId }));
      const done = await count(pb, 'tasks', pb.filter('project = {:id} && internId = {:i} && status = "done"', { id: p.id, i: internId }));
      const progress = total === 0 ? 0 : Math.round((done / total) * 100);
      return { ...normalize(p), progress, totalTasks: total, doneTasks: done };
    }));

    // Include meetings the intern owns (individual interview), created, or is an
    // attendee of (team/member meetings store participants in the `attendees`
    // JSON array, which can't be matched by a PocketBase filter — so filter in JS).
    const allMeetingRecords = await pb.collection('meetings').getFullList({ sort: 'scheduledAt', expand: 'application' });
    const meetingRecords = allMeetingRecords.filter((m) =>
      m.application === intern.id ||
      m.createdBy === internId ||
      (m.attendees || []).some((a) => a.internId === internId)
    );

    const teamRecords = await pb.collection('teams').getFullList({ sort: '-created' });
    const ledTeams = await Promise.all(
      teamRecords.filter((t) => t.leaderId === internId).map((t) => decorateTeam(pb, normalize(t)))
    );
    const memberTeams = await Promise.all(
      teamRecords.filter((t) => (t.members || []).includes(internId) && t.leaderId !== internId).map((t) => decorateTeam(pb, normalize(t)))
    );

    const allProjects = allProjectRecords.map((p) => ({ _id: p.id, name: p.name, status: p.status }));

    res.status(200).json({
      intern: {
        name: intern.name,
        email: intern.email,
        internId: intern.internId,
        role: intern.role,
        approvedAt: intern.approvedAt,
        isTeamLeader: ledTeams.length > 0,
      },
      projects: projectsWithProgress,
      tasks: taskRecords.map(normalize),
      meetings: meetingRecords.map(normalize),
      ledTeams,
      memberTeams,
      allProjects,
    });
  } catch (error) {
    console.error('Error fetching intern dashboard:', error);
    res.status(500).json({ error: 'Server error fetching intern dashboard.' });
  }
});

// Team-leader dashboard data — members, the leader's projects, the work they've
// assigned to members, their meetings, and headline stats.
app.get('/api/team-leader/:internId/dashboard', async (req, res) => {
  try {
    const pb = await getPb();
    const { internId } = req.params;
    const leaders = await pb.collection('applications').getFullList({
      filter: pb.filter('internId = {:v} && status = "approved"', { v: internId }),
    });
    const leader = leaders[0];
    if (!leader || !leader.isTeamLeader) return res.status(404).json({ error: 'Team leader not found.' });

    const teamRecords = await pb.collection('teams').getFullList({ sort: '-created' });
    const ledTeams = await Promise.all(
      teamRecords.filter((t) => t.leaderId === internId).map((t) => decorateTeam(pb, normalize(t)))
    );

    // Unique members across all led teams (the leader themselves excluded).
    const members = [];
    const seen = new Set();
    ledTeams.forEach((tm) => (tm.memberDetails || []).forEach((m) => {
      if (m.internId !== internId && !seen.has(m.internId)) {
        seen.add(m.internId);
        members.push(m);
      }
    }));
    const memberIds = members.map((m) => m.internId);

    const allProjectRecords = await pb.collection('projects').getFullList({ sort: '-created' });
    const leaderProjectRecords = allProjectRecords.filter((p) => (p.assignedInterns || []).includes(internId));
    const leaderProjects = await Promise.all(leaderProjectRecords.map(async (p) => {
      const total = await count(pb, 'tasks', pb.filter('project = {:id}', { id: p.id }));
      const done = await count(pb, 'tasks', pb.filter('project = {:id} && status = "done"', { id: p.id }));
      const progress = total === 0 ? 0 : Math.round((done / total) * 100);
      return { ...normalize(p), progress, totalTasks: total, doneTasks: done };
    }));

    let memberTasks = [];
    if (memberIds.length) {
      const filter = memberIds.map((id) => pb.filter('internId = {:v}', { v: id })).join(' || ');
      const recs = await pb.collection('tasks').getFullList({ filter, sort: 'dueDate,-created', expand: 'project' });
      memberTasks = recs.map(normalize);
    }

    const allMeetings = await pb.collection('meetings').getFullList({ sort: 'scheduledAt', expand: 'application' });
    const meetings = allMeetings
      .filter((m) => m.createdBy === internId || (m.attendees || []).some((a) => a.internId === internId))
      .map(normalize);

    const completedMemberTasks = memberTasks.filter((t) => t.status === 'done').length;

    res.status(200).json({
      leader: { name: leader.name, email: leader.email, internId: leader.internId, role: leader.role },
      ledTeams,
      members,
      leaderProjects,
      memberTasks,
      meetings,
      stats: {
        totalMembers: members.length,
        totalProjects: leaderProjects.length,
        totalMemberTasks: memberTasks.length,
        completedMemberTasks,
        pendingMemberTasks: memberTasks.length - completedMemberTasks,
      },
    });
  } catch (error) {
    console.error('Error fetching team-leader dashboard:', error);
    res.status(500).json({ error: 'Server error fetching team-leader dashboard.' });
  }
});

// Initialise the PocketBase client, then start listening. We don't block startup
// on it — getPb() lazily (re)authenticates per request if this first attempt fails.
initPb()
  .then(() => console.log('PocketBase connected successfully'))
  .catch((err) => console.error('PocketBase init error (will retry per request):', err?.message || err));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
