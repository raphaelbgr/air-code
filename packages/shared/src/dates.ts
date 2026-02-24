/**
 * Central date utility for Claude Code Air.
 *
 * Convention:
 * - Server stores dates in UTC via SQLite `datetime('now')` → "YYYY-MM-DD HH:MM:SS"
 * - API transmits dates as ISO 8601 strings (UTC)
 * - Clients parse and display in the user's local timezone
 */

/**
 * Return the current UTC time as an ISO 8601 string.
 * Use this on the server when creating timestamps outside of SQLite.
 */
export function serverNow(): string {
  return new Date().toISOString();
}

/**
 * Parse a server-provided date string into a Date object.
 * Handles both ISO 8601 ("2025-01-24T15:30:00Z") and
 * SQLite datetime ("2025-01-24 15:30:00") formats — the latter
 * is treated as UTC since that's what `datetime('now')` produces.
 */
export function parseServerDate(dateStr: string): Date {
  if (!dateStr) return new Date(0);
  // SQLite datetime('now') produces "YYYY-MM-DD HH:MM:SS" with no TZ indicator.
  // JavaScript would parse that as local time, but it's actually UTC.
  // Normalize: replace space with T and append Z if no timezone info present.
  let normalized = dateStr;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(normalized)) {
    normalized = normalized.replace(' ', 'T');
  }
  if (!/[Z+]/.test(normalized) && !/T\d{2}:\d{2}:\d{2}[+-]/.test(normalized)) {
    normalized += 'Z';
  }
  return new Date(normalized);
}

/**
 * Format a server date as a relative time string: "just now", "2m ago", "3h ago", etc.
 * Displays in the user's local timezone context.
 */
export function formatRelative(dateStr: string): string {
  if (!dateStr) return '';
  const date = parseServerDate(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return formatDate(dateStr);
}

/**
 * Format a server date as a locale-aware date+time string.
 * e.g. "Jan 24, 2025, 12:30 PM" (varies by locale)
 */
export function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = parseServerDate(dateStr);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a server date as a locale-aware date string.
 * e.g. "Jan 24, 2025" (varies by locale)
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = parseServerDate(dateStr);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
