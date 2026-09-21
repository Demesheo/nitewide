const API = import.meta.env.VITE_API_URL || '/api';
const KEY = 'nitewide.admin.session';
export const readSession = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
export const clearSession = () => sessionStorage.removeItem(KEY);
export async function api(path, options = {}) {
  const session = readSession();
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401) clearSession(); throw new Error(payload.error?.message || 'Unable to complete the request'); }
  return payload.data;
}
export async function signIn(email, password) { const session = await api('/auth/sign-in', { method: 'POST', body: JSON.stringify({ email, password }) }); sessionStorage.setItem(KEY, JSON.stringify(session)); return session; }
export async function verifySession() { const identity = await api('/auth/me'); const current = readSession(); const next = { ...current, ...identity }; sessionStorage.setItem(KEY, JSON.stringify(next)); return next; }
