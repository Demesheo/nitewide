const prefix = 'nitewide.passes:';
const maxAgeMs = 24 * 60 * 60 * 1000;
export function savePassCache(userId, pass, now = Date.now()) {
  if (!userId || !pass?.id || !pass?.event?.endsAt) return;
  if (!pass.tickets?.some((ticket) => ticket.qrImage && ['valid', 'confirmed'].includes(ticket.status))) {
    removePassCache(userId, pass.kind, pass.id);
    return;
  }
  const expiry = Math.min(now + maxAgeMs, new Date(pass.event.endsAt).getTime() + 60 * 60 * 1000);
  if (!Number.isFinite(expiry) || expiry <= now) { removePassCache(userId, pass.kind, pass.id); return; }
  try {
    localStorage.setItem(`${prefix}${userId}:${pass.kind || 'purchase'}:${pass.id}`, JSON.stringify({ pass, expiry }));
  } catch { /* Storage may be disabled. The online pass remains available. */ }
}
export function loadPassCache(userId, kind, id, now = Date.now()) {
  if (!userId || !id) return null;
  const key = `${prefix}${userId}:${kind || 'purchase'}:${id}`;
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value?.expiry > now && value.pass?.id === id) return value.pass;
    localStorage.removeItem(key);
  } catch { /* Corrupt or unavailable storage is ignored. */ }
  return null;
}
export function removePassCache(userId, kind, id) {
  if (!userId || !id) return;
  try { localStorage.removeItem(`${prefix}${userId}:${kind || 'purchase'}:${id}`); }
  catch { /* Storage may be disabled. */ }
}
export function clearPassCache(userId) {
  if (!userId) return;
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${prefix}${userId}:`)) localStorage.removeItem(key);
    }
  } catch { /* Private browsing may deny storage access. */ }
}
