const scopes = new Map();
const identities = new Map();
let nextIdentity = 0;

export const reportAudience = (audience) => audience === 'admin' ? 'admin' : 'business';
export const reportSessionKey = (session) => session?.accessToken
  ? JSON.stringify([session.accessToken, session.user?.id ?? null]) : null;
export const exportAbortError = () => new DOMException('Report download cancelled.', 'AbortError');
export function checkExportSignal(signal) { if (signal?.aborted) throw exportAbortError(); }

// IDs dispatched to the workspace contain no session credentials or user data.
export function reportExportIdentity(session, audience = 'business') {
  const prefix = reportAudience(audience), key = reportSessionKey(session);
  if (!key) return null;
  const scope = scopes.get(prefix);
  if (scope) return scope.key === key ? scope.identity : null;
  let identity = identities.get(prefix);
  if (identity?.key !== key) {
    identity = { key, id: `report-session-${++nextIdentity}` };
    identities.set(prefix, identity);
  }
  return identity.id;
}

export function setReportExportSession(session, audience = 'business') {
  const prefix = reportAudience(audience), key = reportSessionKey(session);
  const previous = scopes.get(prefix);
  if (previous?.key === key) return previous;
  const scope = { key, identity: key ? `report-session-${++nextIdentity}` : null, controllers: new Set() };
  scopes.set(prefix, scope);
  identities.delete(prefix);
  previous?.controllers.forEach((controller) => controller.abort());
  return scope;
}

export function releaseReportExportSession(scope, audience = 'business') {
  scope.controllers.forEach((controller) => controller.abort());
  const prefix = reportAudience(audience);
  if (scopes.get(prefix) === scope) scopes.delete(prefix);
}

export function beginReportExport(session, { audience = 'business', signal } = {}) {
  checkExportSignal(signal);
  const prefix = reportAudience(audience), scope = scopes.get(prefix);
  if (!reportSessionKey(session) || (scope && scope.key !== reportSessionKey(session))) throw exportAbortError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  scope?.controllers.add(controller);
  return {
    signal: controller.signal, identity: reportExportIdentity(session, prefix),
    finish() { signal?.removeEventListener('abort', abort); scope?.controllers.delete(controller); },
  };
}

// Fetch, body readers and browser pickers may ignore a signal. Reject promptly
// and check again before starting any subsequent request or file operation.
export async function awaitExport(value, signal) {
  checkExportSignal(signal);
  if (!signal) return value;
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(exportAbortError());
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([value, cancelled]);
    checkExportSignal(signal);
    return result;
  } finally { signal.removeEventListener('abort', abort); }
}

export function exportDelay(ms, signal) {
  checkExportSignal(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(exportAbortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
