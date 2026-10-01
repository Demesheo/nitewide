import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import SubmittedSearch from '../SubmittedSearch';

export default function PersonPicker({ request, path, value, onChange, audience }) {
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [state, setState] = useState({ loading: true }); const [selected, setSelected] = useState(null); const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    setState({ loading: true });
    const timer = setTimeout(() => request(`${path}?${new URLSearchParams({ search, page: String(page), pageSize: '25' })}`, { signal: controller.signal }).then((data) => { if (active) setState({ data }); }).catch((error) => { if (active && error.name !== 'AbortError') setState({ error: error.message }); }), search ? 200 : 0);
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [request, path, search, page, refresh]);
  return <div className="venue-person-picker"><SubmittedSearch id="venue-person-search" label="Search people" value={search} resetToken={path} onSearch={(value) => { setSearch(value); setPage(1); }}/><small>{audience === 'admin' ? 'Search existing active accounts.' : 'Search this business’s people, or enter an existing account’s exact email.'}</small>
    <label htmlFor="venue-person-choice">Person<select id="venue-person-choice" aria-label="Person" required value={value} onChange={(event) => { const person = state.data?.items.find((item) => (item.userId || item.id) === event.target.value); setSelected(person); onChange(event.target.value); }}><option value="">Choose a person</option>{value && !state.data?.items.some((item) => (item.userId || item.id) === value) && <option value={value}>{selected?.displayName || selected?.name || value}</option>}{state.data?.items.map((person) => <option key={person.userId || person.id} value={person.userId || person.id}>{person.displayName || person.name} · {person.email}</option>)}</select></label>
    {state.loading && <small role="status">Loading people…</small>}{state.error && <div className="error" role="alert">{state.error}<Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)}>Retry</Button></div>}{state.data && <div className="venue-picker-pager"><Button type="button" variant="outline" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous people</Button><small>{state.data.total} matching people · Page {page}</small><Button type="button" variant="outline" disabled={!state.data.hasMore} onClick={() => setPage((value) => value + 1)}>Next people</Button></div>}
  </div>;
}
