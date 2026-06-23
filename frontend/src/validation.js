// Lightweight, dependency-free form validation helpers.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[+]?[\d][\d\s\-()]{6,}$/;

export const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
export const isEmail = (v) => EMAIL_RE.test(String(v || '').trim());
export const isPhone = (v) => PHONE_RE.test(String(v || '').trim());

// Returns true when there are no errors in the object.
export const isValid = (errors) => Object.keys(errors).length === 0;

// Validate a graduation year: a 4-digit year within a sensible window.
export function isGradYear(v) {
  const n = Number(String(v || '').trim());
  if (!Number.isInteger(n)) return false;
  const year = new Date().getFullYear();
  return n >= year - 10 && n <= year + 10;
}
