// Local filesystem storage for resume uploads.
//
// Files live under the `uploads/` directory next to the server. The exported
// API intentionally mirrors the previous Google Cloud Storage wrapper so callers
// stay unchanged: an "object name" is a slash-separated path (e.g.
// "resumes/jane-abc/cv.pdf") stored as real subdirectories under uploads/.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, 'uploads');

// Resolve an object name to an absolute path inside UPLOAD_ROOT, guarding
// against path traversal (e.g. "../../etc/passwd").
function resolveObject(objectName) {
  const full = path.resolve(UPLOAD_ROOT, objectName);
  if (full !== UPLOAD_ROOT && !full.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error('Invalid object path.');
  }
  return full;
}

// Write a buffer to `objectName`, creating parent dirs. Returns the object name.
async function uploadBuffer(objectName, buffer /*, contentType */) {
  const full = resolveObject(objectName);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, buffer);
  return objectName;
}

// Move/rename an object (no-op if the source is missing or unchanged).
async function moveObject(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const from = resolveObject(oldName);
  const to = resolveObject(newName);
  if (!fs.existsSync(from)) return;
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.rename(from, to);
}

// Recursively delete everything under a prefix (an applicant's folder).
async function deletePrefix(prefix) {
  if (!prefix) return;
  const full = resolveObject(prefix);
  await fsp.rm(full, { recursive: true, force: true });
}

// Build a URL the browser can fetch the file from. With local storage this is a
// relative path served by express.static at /uploads; each path segment is
// encoded so spaces and other characters survive the redirect.
async function signedUrl(objectName /*, ttlMinutes */) {
  const encoded = String(objectName).split('/').map(encodeURIComponent).join('/');
  return `/uploads/${encoded}`;
}

module.exports = { uploadBuffer, moveObject, deletePrefix, signedUrl, UPLOAD_ROOT };
