import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
import './venue-workspace/venues.css';
import SubmittedSearch from './SubmittedSearch';

export default function AsyncVenuePicker({ organizationId, session, request = api, audience = 'business', value, onSelect, disabled = false, label = 'Saved venue' }) {
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [state, setState] = useState({ loading: true }); const [selected, setSelected] = useState(null); const [lookupError, setLookupError] = useState(''); const [refresh, setRefresh] = useState(0);
  const basePath = audience === 'admin' ? '/admin/businesses' : '/business/organizations';
  useEffect(() => { setSearch(''); setPage(1); setSelected(null); setLookupError(''); }, [organizationId]);
  useEffect(() => {
    if (!organizationId) return;
    let active = true; const controller = new AbortController();
    setState({ loading: true });
    const timer = setTimeout(() => request(`${basePath}/${organizationId}/venues?${new URLSearchParams({ search, page: String(page), pageSize: '25' })}`, session, { signal: controller.signal }).then((data) => { if (active) setState({ data }); }).catch((error) => { if (active && error.name !== 'AbortError') setState({ error: error.message }); }), search ? 200 : 0);
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [organizationId, request, session, basePath, search, page, refresh]);
  useEffect(() => {
    if (!organizationId || !value) { setSelected(null); setLookupError(''); return; }
    let active = true; const controller = new AbortController();
    setLookupError('');
    request(`${basePath}/${organizationId}/venues/${value}`, session, { signal: controller.signal }).then((data) => { if (active) setSelected(data); }).catch((error) => { if (active && error.name !== 'AbortError') setLookupError(error.message); });
    return () => { active = false; controller.abort(); };
  }, [organizationId, value, request, session, basePath, refresh]);
  return <div className="venue-person-picker async-venue-picker"><SubmittedSearch id="event-saved-venue-search" label="Search business venues" disabled={disabled} value={search} resetToken={organizationId} placeholder="Search by venue name or address" onSearch={(value) => { setSearch(value); setPage(1); }}/>
    <label htmlFor="event-saved-venue">{label}<select id="event-saved-venue" aria-label={label} value={value || ''} disabled={disabled || !organizationId} onChange={(event) => { const row = state.data?.items.find((item) => item.id === event.target.value); if (row) { setSelected(row); onSelect(row); } }}><option value="">Choose a venue</option>{value && !state.data?.items.some((item) => item.id === value) && <option value={value}>{selected?.id === value ? selected.name : lookupError ? 'Selected venue unavailable' : 'Loading selected venue…'}</option>}{state.data?.items.map((venue) => <option key={venue.id} value={venue.id}>{venue.name} · {[venue.city, venue.region].filter(Boolean).join(', ')}</option>)}</select></label>
    {state.loading && <small role="status">Loading venues…</small>}{(state.error || lookupError) && <div className="error" role="alert">{state.error || lookupError}<Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)}>Retry venues</Button></div>}
    {state.data && <div className="venue-picker-pager"><Button type="button" variant="outline" disabled={disabled || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous venues</Button><small>{state.data.total} matching venues · Page {page}</small><Button type="button" variant="outline" disabled={disabled || !state.data.hasMore} onClick={() => setPage((value) => value + 1)}>Next venues</Button></div>}
  </div>;
}
