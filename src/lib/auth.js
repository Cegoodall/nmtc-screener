/**
 * Simple shared-password auth for /admin and /dashboard.
 * Password is compared against VITE_ADMIN_PASSWORD env var.
 * Session stored in sessionStorage — clears on tab close.
 *
 * Note: client-side password auth is lightweight protection suitable for
 * internal tools. For stronger security, use Supabase Auth or Vercel's
 * built-in password protection.
 */

const SESSION_KEY = "nmtc_admin_auth";
const CORRECT_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

export function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

export function login(password) {
  if (!CORRECT_PASSWORD) {
    // No password configured — allow access (dev mode)
    sessionStorage.setItem(SESSION_KEY, "1");
    return true;
  }
  if (password === CORRECT_PASSWORD) {
    sessionStorage.setItem(SESSION_KEY, "1");
    return true;
  }
  return false;
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}
