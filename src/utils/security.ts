/**
 * HTML escape to prevent XSS attacks
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * CORS whitelist
 */
const ALLOWED_ORIGINS = [
  'https://wall.md',
  'https://www.wall.md',
  'https://wall.zhixian.io',
  'http://localhost:8787',
  'http://127.0.0.1:8787'
];

/**
 * Get allowed origin for CORS
 */
export function getAllowedOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return ALLOWED_ORIGINS[0];

  // Exact match
  if (ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }

  // Dev: allow localhost any port
  if (requestOrigin.startsWith('http://localhost:') ||
      requestOrigin.startsWith('http://127.0.0.1:')) {
    return requestOrigin;
  }

  // Deny others
  return ALLOWED_ORIGINS[0];
}
