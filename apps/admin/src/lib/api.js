import { reportSessionKey, setReportExportSession } from '../../../business/src/lib/report-export-session.js';

const API = import.meta.env.VITE_API_URL || '/api';
const KEY = 'nitewide.admin.session';
export const readSession = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
export function clearSession(expected = readSession()) {
  if (reportSessionKey(readSession()) !== reportSessionKey(expected)) return false;
  sessionStorage.removeItem(KEY);
  setReportExportSession(null, 'admin');
  return true;
}
export async function api(path, options = {}, session = readSession()) {
  const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...(!multipart ? { 'Content-Type': 'application/json' } : {}), ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401) clearSession(session); const error = new Error(payload.error?.message || 'Unable to complete the request'); error.status = response.status; throw error; }
  return payload.data;
}
export async function signIn(email, password) { const session = await api('/auth/sign-in', { method: 'POST', body: JSON.stringify({ email, password }) }); sessionStorage.setItem(KEY, JSON.stringify(session)); setReportExportSession(session, 'admin'); return session; }
export async function verifySession() {
  const current = readSession();
  const identity = await api('/auth/me');
  if (reportSessionKey(readSession()) !== reportSessionKey(current)) throw new DOMException('Session changed.', 'AbortError');
  const next = { ...current, ...identity };
  sessionStorage.setItem(KEY, JSON.stringify(next));
  setReportExportSession(next, 'admin');
  return next;
}
