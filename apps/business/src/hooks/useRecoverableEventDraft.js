import { useEffect, useRef, useState } from 'react';

function readDraft(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    return value?.draft && value?.schema === 1 ? value : null;
  } catch { return null; }
}

export function useRecoverableEventDraft({ session, event, identity = null, initialDraft }) {
  const legacyKey = `nitewide:business:draft:${session.user.id}:${identity || event?.id || 'new'}`;
  const key = event ? legacyKey : `${legacyKey}:${initialDraft.organizationId || 'independent'}`;
  const initial = useRef(initialDraft);
  const [draft, setDraft] = useState(initialDraft);
  const [recovery, setRecovery] = useState(() => {
    const saved = readDraft(key) || readDraft(legacyKey);
    // Never restore an unfinished event from another organization into the
    // currently selected workspace. Old copies remain recoverable there.
    return saved && (saved.draft.organizationId || null) === (initialDraft.organizationId || null) ? saved : null;
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current);
  const persistNow = () => {
    if (!dirty) return;
    try {
      sessionStorage.setItem(key, JSON.stringify({ schema: 1, eventVersion: event?.version ?? null,
        updatedAt: new Date().toISOString(), draft }));
    } catch { /* Editing still works if storage is unavailable. */ }
  };
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(persistNow, 250);
    return () => clearTimeout(timer);
  }, [key, draft, dirty, event?.version]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const restore = () => { if (recovery) setDraft(recovery.draft); setRecovery(null); };
  const clear = () => {
    sessionStorage.removeItem(key);
    const legacy = readDraft(legacyKey);
    if (legacy && (legacy.draft.organizationId || null) === (initialDraft.organizationId || null)) sessionStorage.removeItem(legacyKey);
  };
  const discardRecovery = () => { clear(); setRecovery(null); };
  return { draft, setDraft, dirty, recovery, restore, discardRecovery, clear, persistNow };
}
