import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Search } from 'lucide-react';

// A search draft never changes the applied query until Search or Enter.
export default function SubmittedSearch({ id, label, value = '', onSearch, placeholder = '', disabled = false, resetToken, inputLabel = label, icon = false, hideLabel = false, description }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, resetToken]);
  const submit = () => onSearch(draft.trim());
  return <div role="search" aria-label={label} className={`submitted-search${icon ? ' submitted-search-with-icon' : ''}`}>
    <label htmlFor={id}><span className={hideLabel ? 'sr-only' : undefined}>{label}</span>{icon && <Search size={18} aria-hidden="true"/>}<Input id={id} aria-label={inputLabel} aria-describedby={description ? `${id}-description` : undefined} disabled={disabled} maxLength={120} value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submit(); } }}/></label>
    <Button type="button" disabled={disabled} onClick={submit}>Search</Button>
    {description && <span id={`${id}-description`} className="sr-only">{description}</span>}
  </div>;
}
