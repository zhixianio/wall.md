import type { Env } from '../types';

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

/**
 * Verify admin secret for room creation
 * Supports multiple secrets (comma-separated) for key rotation
 */
export function verifyAdminSecret(
  authHeader: string | null,
  env: Env
): boolean {
  if (!authHeader) return false;
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.substring(7).trim();
  if (!token) return false;

  // Check if ADMIN_SECRETS is configured
  if (!env.ADMIN_SECRETS || !env.ADMIN_SECRETS.trim()) {
    console.error("[Security] ADMIN_SECRETS not configured");
    return false;
  }

  // Split by comma and trim each secret, filter out empty strings
  const validSecrets = env.ADMIN_SECRETS
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (validSecrets.length === 0) {
    console.error("[Security] No valid secrets configured");
    return false;
  }

  return validSecrets.includes(token);
}
