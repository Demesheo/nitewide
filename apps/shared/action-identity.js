// Persist only an action fingerprint and identity, never hosted Stripe links.
export function actionIdentity(scope, payload, storage, requirePersistence = false) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { /* Storage may be denied by the browser. */ } }
  const value = JSON.stringify(payload);
  let fingerprint = 2166136261;
  for (let index = 0; index < value.length; index += 1) fingerprint = Math.imul(fingerprint ^ value.charCodeAt(index), 16777619);
  const key = `nitewide.action.${scope}`;
  const hash = requirePersistence ? value : (fingerprint >>> 0).toString(16);
  try {
    const existing = JSON.parse(storage.getItem(key));
    if (existing?.fingerprint === hash && existing?.idempotencyKey) return existing.idempotencyKey;
  } catch { /* A blocked storage provider still permits an in-memory retry. */ }
  const idempotencyKey = crypto.randomUUID();
  try {
    storage.setItem(key, JSON.stringify({ fingerprint: hash, idempotencyKey }));
    if (requirePersistence && JSON.parse(storage.getItem(key))?.idempotencyKey !== idempotencyKey) throw new Error('Persistence unavailable');
  } catch {
    if (requirePersistence) throw new Error('Your browser cannot save this payment’s retry identity. Enable browser storage before creating a commission payment.');
  }
  return idempotencyKey;
}

export function forgetAction(scope, storage) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { /* optional storage */ } }
  try { storage.removeItem(`nitewide.action.${scope}`); } catch { /* optional storage */ }
}
