import { useEffect, useId, useRef, useState } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';
import { api } from '../lib/api';

function sameFormSubmit(target, form) {
  const control = target?.closest?.('button, input');
  return Boolean(form && control?.form === form && ['submit', 'image'].includes(control.type) && !control.disabled);
}

export function DiscoveryCitySearch({ value, onChange, placeholder, describedBy, onLocate, locating = false, holdMenuOnBlur, dismissRevision = 0 }) {
  const id = useId();
  const listId = `${id}-areas`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState({ key: '', status: 'idle', items: [] });
  const [retry, setRetry] = useState(0);
  const inputRef = useRef(null);
  const pickerRef = useRef(null);
  const optionRefs = useRef([]);
  const openRef = useRef(open);
  openRef.current = open;
  const term = value.trim();
  const currentTerm = useRef(term);
  currentTerm.current = term;
  const visible = suggestions.key === term ? suggestions : { status: 'idle', items: [] };
  const expanded = open && term.length >= 2;
  const active = expanded && visible.items[activeIndex];
  function handleBlur(event) {
    if (holdMenuOnBlur?.current && (!event.relatedTarget || event.relatedTarget.closest?.('[data-discovery-control]'))) return;
    if (!pickerRef.current?.contains(event.relatedTarget) && !sameFormSubmit(event.relatedTarget, inputRef.current?.form)) setOpen(false);
  }
  useEffect(() => { setOpen(false); setActiveIndex(-1); }, [dismissRevision]);
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    // In-flow mobile suggestions must not collapse between pointer-down and
    // click. Safari may blur to null instead of focusing the submit button.
    const retainFocus = (event) => {
      if (openRef.current && sameFormSubmit(event.target, form)) event.preventDefault();
    };
    const dismiss = () => {
      setOpen(false);
      // Release the retained mobile keyboard focus only after activation.
      if (form.ownerDocument.activeElement === inputRef.current) inputRef.current.blur();
    };
    form.addEventListener('pointerdown', retainFocus, true);
    form.addEventListener('mousedown', retainFocus, true);
    form.addEventListener('submit', dismiss);
    form.addEventListener('focusout', handleBlur);
    return () => {
      form.removeEventListener('pointerdown', retainFocus, true);
      form.removeEventListener('mousedown', retainFocus, true);
      form.removeEventListener('submit', dismiss);
      form.removeEventListener('focusout', handleBlur);
    };
  }, []);
  useEffect(() => {
    if (active) optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [active, activeIndex]);
  useEffect(() => {
    setActiveIndex(-1);
    if (!open || term.length < 2) return;
    const controller = new AbortController();
    setSuggestions({ key: term, status: 'loading', items: [] });
    const timer = setTimeout(() => {
      api(`/discovery/areas?${new URLSearchParams({ q: term })}`, { signal: controller.signal })
        .then((page) => {
          if (controller.signal.aborted || currentTerm.current !== term) return;
          const choices = new Map();
          for (const item of page.items || []) {
            if (typeof item.label !== 'string' || item.label.length > 120) continue;
            const identity = item.key || item.label;
            if (!choices.has(identity)) choices.set(identity, item);
          }
          const items = [...choices.values()].slice(0, 5);
          setSuggestions({ key: term, status: 'ready', items, hasMore: Boolean(page.hasMore) });
        })
        .catch(() => { if (!controller.signal.aborted && currentTerm.current === term) setSuggestions({ key: term, status: 'error', items: [] }); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [term, open, retry]);
  function choose(item) { onChange(item.label); setOpen(false); setActiveIndex(-1); }
  function retrySuggestions() { inputRef.current?.focus(); setRetry((revision) => revision + 1); }
  return <div ref={pickerRef} className="discovery-city-search" onBlur={handleBlur}>
    <div className="discovery-city-input">
    <label className="search-field">
      <MapPin aria-hidden="true"/>
      <span><b>WHERE TO?</b><input ref={inputRef} aria-label="City" name="discovery-place-query" type="search" role="combobox" autoComplete="off" spellCheck={false} autoCorrect="off" maxLength={120}
        aria-autocomplete="list" aria-controls={listId} aria-expanded={expanded}
        aria-activedescendant={active ? `${listId}-${activeIndex}` : undefined} aria-describedby={describedBy}
        value={value} placeholder={placeholder} onFocus={() => setOpen(true)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(-1); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) { event.preventDefault(); setOpen(false); setActiveIndex(-1); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            if (visible.items.length) setActiveIndex((index) => event.key === 'ArrowDown' ? (index + 1) % visible.items.length : (index <= 0 ? visible.items.length - 1 : index - 1));
          } else if (event.key === 'Enter' && active) { event.preventDefault(); choose(active); }
        }}/></span>
    </label>
    {onLocate && <button className="discovery-field-action discovery-locate-button" type="button" aria-label="Use current location" title={locating ? 'Finding your city…' : 'Use current location'} aria-busy={locating} disabled={locating}
      onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); onLocate(); }}><LocateFixed size={18} aria-hidden="true"/></button>}
    </div>
    {expanded && <div className="discovery-city-options">
      <div id={listId} role="listbox" aria-label="City suggestions">
        {visible.items.map((item, index) => <button type="button" role="option" tabIndex={-1}
          ref={(element) => { optionRefs.current[index] = element; }}
          id={`${listId}-${index}`} key={item.key || item.label} aria-selected={index === activeIndex}
          onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
          <span>{item.label}</span>
        </button>)}
      </div>
      {visible.status === 'loading' && <p role="status">Finding cities…</p>}
      {visible.status === 'ready' && !visible.items.length && <p>No suggestions yet. Enter a city and state or region.</p>}
      {visible.status === 'ready' && visible.hasMore && <p>Keep typing to narrow these suggestions.</p>}
      {visible.status === 'error' && <p role="status">City suggestions are unavailable. You can enter a qualified city, or <button type="button" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={retrySuggestions}>try again</button>.</p>}
    </div>}
  </div>;
}
