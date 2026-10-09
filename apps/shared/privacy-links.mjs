import { publicAppLink } from './app-links.mjs';

export function customerHomeLink(configured, location, environment = globalThis) {
  const fallback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    ? `${location.protocol}//${location.hostname}:5173/` : '/';
  const value = publicAppLink('customerUrl', configured || fallback, environment);
  let url;
  try { url = new URL(value, location.origin); }
  catch { return new URL(fallback, location.origin).href; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return new URL(fallback, location.origin).href;
  // Public navigation must never carry an invitation or session.
  url.search = ''; url.hash = '';
  return url.href;
}

export function privacyPolicyLink(configured, location, environment = globalThis) {
  return new URL('/privacy', customerHomeLink(configured, location, environment)).href;
}
