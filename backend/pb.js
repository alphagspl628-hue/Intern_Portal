// PocketBase client for the Express layer.
//
// The official `pocketbase` SDK is ESM-only, so under CommonJS we load it with a
// dynamic import() during an async init. Express authenticates as a PocketBase
// superuser and reuses one long-lived client for every request.

let pb = null;

const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

// Initialise + authenticate the shared client. Call once at server startup.
async function initPb() {
  if (pb) return pb;
  const { default: PocketBase } = await import('pocketbase');
  pb = new PocketBase(POCKETBASE_URL);
  // Express fans out many concurrent requests; PocketBase's default
  // auto-cancellation would abort overlapping calls, so disable it.
  pb.autoCancellation(false);
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
  return pb;
}

// Return the client, re-authenticating if the stored token has expired.
async function getPb() {
  if (!pb) await initPb();
  if (!pb.authStore.isValid) {
    await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
  }
  return pb;
}

// PocketBase returns datetimes like "2026-06-19 10:00:00.000Z"; convert the
// space-separated form to a strict ISO string the browser can parse reliably.
function toIso(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(v)) {
    return v.replace(' ', 'T');
  }
  return v;
}

// Reshape a PocketBase record into the legacy Mongoose-style shape the frontend
// expects: `_id` instead of `id`, expanded relations re-nested under their field
// name, ISO dates, and `created` surfaced as `submittedAt`/`createdAt`.
function normalize(record) {
  if (!record) return null;
  if (Array.isArray(record)) return record.map(normalize);

  const out = { ...record };
  out._id = record.id;

  // Re-nest expanded relations (e.g. expand.project -> project).
  if (record.expand && typeof record.expand === 'object') {
    for (const [key, value] of Object.entries(record.expand)) {
      out[key] = normalize(value);
    }
    delete out.expand;
  }

  // Normalise any datetime-looking string fields.
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string') out[key] = toIso(value);
  }

  // Legacy date aliases the frontend sorts/renders on.
  if (record.created) {
    const iso = toIso(record.created);
    if (out.submittedAt === undefined) out.submittedAt = iso;
    if (out.createdAt === undefined) out.createdAt = iso;
  }

  return out;
}

module.exports = { initPb, getPb, normalize };
