export class ClipboardCopyError extends Error {
  constructor(text) {
    super('Automatic copying is unavailable. Press and hold the link below, then choose Copy.');
    this.name = 'ClipboardCopyError';
    this.text = text;
  }
}

function plainText(value) {
  if (typeof value !== 'string' || !value) throw new TypeError('No link is available to copy.');
  return value;
}

function legacyCopy(text, document) {
  if (!document?.body || typeof document.execCommand !== 'function') return false;
  const active = document.activeElement;
  const selection = document.getSelection?.();
  const ranges = Array.from({ length: selection?.rangeCount || 0 }, (_, index) => selection.getRangeAt(index).cloneRange());
  const inputSelection = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none';
  // Stay inside an open modal's focus trap rather than moving focus outside it.
  (active?.closest?.('[role="dialog"]') || document.body).appendChild(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand('copy') === true;
  } catch { return false; }
  finally {
    input.remove();
    active?.focus?.({ preventScroll: true });
    if (inputSelection) active.setSelectionRange(...inputSelection);
    if (selection && ranges.length) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

// Only accept prepared text. Fetch/generate links BEFORE enabling Copy, never
// during the tap: Safari requires the clipboard API call in that click stack.
// The browser returns a promise, but starting the write is synchronous.
export function copyText(text, environment = globalThis) {
  try { plainText(text); } catch (error) { return Promise.reject(error); }
  const clipboard = environment.navigator?.clipboard;
  const fallback = () => {
    if (legacyCopy(text, environment.document)) return;
    throw new ClipboardCopyError(text);
  };
  try {
    if (clipboard?.write && environment.ClipboardItem && environment.Blob) {
      const item = new environment.ClipboardItem({ 'text/plain': new environment.Blob([text], { type: 'text/plain' }) });
      return Promise.resolve(clipboard.write([item])).catch(fallback);
    }
    if (clipboard?.writeText) return Promise.resolve(clipboard.writeText(text)).catch(fallback);
  } catch { /* Unsupported/refused browser implementations use the fallback. */ }
  try { fallback(); return Promise.resolve(); }
  catch (error) { return Promise.reject(error); }
}
