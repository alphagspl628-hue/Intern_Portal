// One-off setup: create the PocketBase collections that mirror the old Mongoose
// models. Run once with `npm run setup:pb` after creating the superuser.
//
//   POCKETBASE_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD must be set (see .env).

require('dotenv').config();

const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const { PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD } = process.env;

// An autodate `created` field gives us the legacy submittedAt/createdAt timestamp.
const createdField = { name: 'created', type: 'autodate', onCreate: true, onUpdate: false };
const updatedField = { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true };

async function main() {
  const { default: PocketBase } = await import('pocketbase');
  const pb = new PocketBase(POCKETBASE_URL);
  pb.autoCancellation(false);
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);

  const ids = {}; // collection name -> id, for wiring relation fields

  // Create a base collection if it doesn't already exist; record its id.
  async function ensure(name, fields) {
    try {
      const existing = await pb.collections.getOne(name);
      ids[name] = existing.id;
      console.log(`• ${name} already exists — skipping`);
      return existing;
    } catch (_) {
      const created = await pb.collections.create({
        name,
        type: 'base',
        fields: [...fields, createdField, updatedField],
        // Only the trusted Express superuser touches these collections.
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      });
      ids[name] = created.id;
      console.log(`✓ created ${name}`);
      return created;
    }
  }

  const text = (name, required = false) => ({ name, type: 'text', required });
  const select = (name, values) => ({ name, type: 'select', maxSelect: 1, values });
  const relation = (name, target) => ({
    name, type: 'relation', required: false, maxSelect: 1,
    collectionId: ids[target], cascadeDelete: false,
  });

  // Order matters: relation targets must exist first.
  await ensure('projects', [
    text('name', true), text('description'),
    select('status', ['active', 'completed', 'on-hold']),
    { name: 'deadline', type: 'date' },
    { name: 'assignedInterns', type: 'json' },
  ]);

  await ensure('teams', [
    text('name', true), text('description'),
    text('leaderId'),
    { name: 'members', type: 'json' },
  ]);

  await ensure('jobroles', [
    text('title', true), text('department'), text('description'),
    { name: 'openings', type: 'number' },
  ]);

  await ensure('applications', [
    text('name', true), text('email', true), text('phone'), text('college'),
    text('graduationYear'), text('role'), text('resumePath'), text('uploadFolder'),
    select('status', ['pending', 'reviewing', 'interview', 'approved', 'rejected']),
    text('internId'),
    relation('assignedProject', 'projects'),
    { name: 'approvedAt', type: 'date' },
    { name: 'isTeamLeader', type: 'bool' },
  ]);

  await ensure('tasks', [
    text('title', true), text('description'),
    relation('project', 'projects'),
    text('internId'), text('assignedBy'),
    select('status', ['todo', 'in-progress', 'done']),
    { name: 'dueDate', type: 'date' },
  ]);

  await ensure('meetings', [
    text('title', true),
    relation('application', 'applications'),
    text('attendeeName'), text('attendeeEmail'),
    { name: 'attendees', type: 'json' },
    relation('team', 'teams'),
    select('scope', ['individual', 'team', 'members']),
    { name: 'scheduledAt', type: 'date' },
    text('link'), text('notes'),
    select('status', ['scheduled', 'completed']),
    text('createdBy'),
  ]);

  console.log('\nDone. Collections:', Object.keys(ids).join(', '));
}

main().catch((err) => {
  console.error('Setup failed:', err?.response || err);
  process.exit(1);
});
