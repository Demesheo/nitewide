import { useEffect, useRef, useState } from 'react';
import { ClipboardCopyError, copyText } from './copy-text.js';
import './clipboard-copy.css';

export function useClipboardCopy(context) {
  const [manual, setManual] = useState(null);
  const current = useRef(context), mounted = useRef(true);
  current.current = context;
  useEffect(() => { setManual(null); }, [context]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function copy(source) {
    setManual(null);
    try { await copyText(source); }
    catch (error) {
      if (error instanceof ClipboardCopyError && mounted.current && current.current === context) setManual({ context, text: error.text });
      throw error;
    }
  }
  return { copy, manualLink: manual && manual.context === context ? manual.text : '' };
}

// Scope private links to the current account/event/guest. Copy never loads
// them; it stays disabled until this authorized prefetch has finished.
export function usePrefetchedLink(context, enabled, load, onError) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const callbacks = useRef({ load, onError });
  callbacks.current = { load, onError };
  const key = `${context}:${revision}`;
  useEffect(() => {
    if (!enabled) { setResult(null); return; }
    const controller = new AbortController();
    const { load: loadLink, onError: reportError } = callbacks.current;
    setResult({ key, loading: true, link: '', error: '' });
    Promise.resolve().then(() => controller.signal.aborted ? null : loadLink(controller.signal)).then(link => {
      if (controller.signal.aborted) return;
      if (typeof link !== 'string' || !link) throw new Error('The link is unavailable. Please try again.');
      if (!controller.signal.aborted) setResult({ key, loading: false, link, error: '' });
    }).catch(error => {
      if (controller.signal.aborted) return;
      setResult({ key, loading: false, link: '', error: error.message });
      reportError?.(error);
    });
    return () => controller.abort();
  }, [key, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [enabled, context]);
  const current = enabled && result?.key === key ? result : null;
  return { link: current?.link || '', loading: enabled && (!current || current.loading), error: current?.error || '', retry: () => setRevision(value => value + 1) };
}

export function ManualCopyLink({ link }) {
  if (!link) return null;
  const select = event => {
    const input = event.currentTarget;
    const selectAll = () => { if (input.isConnected && input.ownerDocument.activeElement === input) { input.select(); input.setSelectionRange(0, link.length); } };
    selectAll();
    // iOS can reset selection during the native tap's default action.
    requestAnimationFrame(selectAll);
  };
  return <div className="clipboard-copy-fallback" role="group" aria-label="Copy link manually">
    <label><span>Copy link manually</span><input type="text" readOnly value={link} inputMode="none" autoComplete="off" spellCheck={false} onFocus={select} onClick={select}/></label>
    <p>Press and hold the link, then choose Copy. On desktop, select it and press Ctrl+C or ⌘C.</p>
  </div>;
}
