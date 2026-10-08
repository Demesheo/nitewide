import { reportSessionKey, setReportExportSession } from './report-export-session.js';

export const SESSION_KEY = "nitewide.business.session";
function storedSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } }
export const matchesStoredSession = (session) => reportSessionKey(storedSession()) === reportSessionKey(session);
export function writeSession(session, expected) {
  if (expected !== undefined && !matchesStoredSession(expected)) return false;
  if (session?.accessToken) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
  setReportExportSession(session);
  return true;
}
export function readSession() {
  try {
    const s = storedSession();
    return s?.accessToken && new Date(s.expiresAt) > new Date() ? s : null;
  } catch {
    return null;
  }
}
export async function api(path, session, options = {}) {
  const response = await fetch(
    `${import.meta.env.VITE_API_URL || "/api"}${path}`,
    {
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(session?.accessToken
          ? { Authorization: `Bearer ${session.accessToken}` }
          : {}),
        ...options.headers,
      },
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const details = payload?.error?.details;
    const fields = details?.fieldErrors
      ? Object.entries(details.fieldErrors)
          .map(([field, messages]) => `${field}: ${messages.join(", ")}`)
          .join("; ")
      : "";
    const error = new Error(
      fields ||
        payload?.error?.message ||
        "Unable to reach Nitewide. Please try again.",
    );
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = details;
    if (error.status === 403 && error.code === 'BUSINESS_ACCESS_REQUIRED' && session?.accessToken && path.startsWith('/business/') && typeof window !== 'undefined') {
      window.dispatchEvent(new window.CustomEvent('nitewide:business-access-required', { detail: { accessToken: session.accessToken } }));
    }
    throw error;
  }
  return payload.data;
}
export function mediaSrc(url) {
  const base = import.meta.env.VITE_API_URL;
  return base && /^https?:\/\//.test(base) ? new URL(url, base).href : url;
}
