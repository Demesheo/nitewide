import { useId, useRef } from 'react';
import { CalendarDays, X } from 'lucide-react';

export function DiscoveryDateSearch({ value, onChange }) {
  const id = useId();
  const inputRef = useRef(null);
  function openDatePicker() {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Keep the platform's native picker and its user-activation requirement.
    // Browsers without showPicker still receive a focused, editable date input.
    if (typeof input.showPicker === 'function') {
      try { input.showPicker(); } catch { /* The real date input remains usable. */ }
    }
  }
  return <div className="discovery-date-search">
    <div className="search-field date-field">
      <CalendarDays aria-hidden="true"/>
      <span><label htmlFor={id}><b>{value ? 'WHEN?' : 'UPCOMING'}</b></label>
        <span className={`discovery-date-value${value ? ' has-date' : ''}`}>
          <input ref={inputRef} id={id} aria-label="Event date" name="date" type="date" value={value} data-discovery-control
            onInput={(event) => onChange(event.currentTarget.value)} onChange={(event) => onChange(event.target.value)} onBlur={(event) => onChange(event.currentTarget.value)}/>
          {value && <button type="button" className="discovery-date-reset" aria-label="Reset to upcoming" data-discovery-control onClick={() => onChange('')}><X size={14} aria-hidden="true"/></button>}
        </span>
      </span>
    </div>
    <button type="button" className="discovery-field-action discovery-calendar-button" aria-label="Open date picker" title="Open date picker" data-discovery-control onClick={openDatePicker}><CalendarDays size={18} aria-hidden="true"/></button>
  </div>;
}
