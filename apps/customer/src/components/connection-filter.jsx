import { useEffect, useRef, useState } from 'react';
import { Users, ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { api } from '../lib/api';

export function ConnectionFilter({ session, selected, onApply }) {
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState([]);
  const [all, setAll] = useState(true);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [people, setPeople] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setSubmittedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => { setPage(1); setPeople([]); }, [submittedSearch]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (submittedSearch) params.set('search', submittedSearch);
    api(`/customer/connections/people?${params}`, { token: session.accessToken, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPeople((current) => page === 1 ? result.people : [...new Map([...current, ...result.people].map((person) => [person.id, person])).values()]);
        setHasMore(result.hasMore);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, page, submittedSearch, session.accessToken, revision]);
  function changeOpen(value) {
    if (value) { setDraft(selected || []); setAll(selected === null); setSearch(''); setSubmittedSearch(''); setPage(1); setPeople([]); }
    setOpen(value);
  }
  return <>
    <Button ref={trigger} variant="outline" className="connections-filter-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => changeOpen(true)}><Users size={16} /> {selected === null ? 'All connections' : `${selected.length} selected`} <ChevronDown size={14} /></Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="connection-filter-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogHeader><DialogTitle>Choose your connections</DialogTitle><DialogDescription>Search your full connection history, then choose whose events to see.</DialogDescription></DialogHeader>
        <Input aria-label="Search people" placeholder="Search people" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="connection-filter-tools"><span>{all ? 'Showing all connections' : `${draft.length} selected`}</span><Button variant="ghost" onClick={() => { setAll(true); setDraft([]); }}>Show all</Button><Button variant="ghost" onClick={() => { setAll(false); setDraft([]); }}>Clear selection</Button></div>
        {all && <p className="connection-filter-help">Choose a person below to narrow the feed. No people are individually selected while all connections are shown.</p>}
        {draft.length >= 50 && <p role="status">You can choose up to 50 connections at once.</p>}
        {error && <p role="alert" className="account-error">{error} <button onClick={() => setRevision((value) => value + 1)}>Try again</button></p>}
        <div className="connection-filter-list" role="group" aria-label="Connections to include">
          {people.map((person) => <label className="connection-filter-option" key={person.id}>
            <input type="checkbox" checked={draft.includes(person.id)} disabled={!draft.includes(person.id) && draft.length >= 50} onChange={() => { setAll(false); setDraft((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id]); }} aria-label={person.name} />
            <span><strong>{person.name}</strong><small>{person.bookings} {person.bookings === 1 ? 'booking' : 'bookings'} · {person.guestlistEvents} guestlist {person.guestlistEvents === 1 ? 'event' : 'events'}</small></span>
          </label>)}
          {loading && <p>Loading connections…</p>}
          {!loading && !people.length && !error && !hasMore && <p className="connection-filter-empty">No matching connections.</p>}
        </div>
        {hasMore && <Button variant="outline" disabled={loading} onClick={() => setPage((value) => value + 1)}>More connections</Button>}
        <div className="connection-filter-actions"><Button variant="ghost" onClick={() => changeOpen(false)}>Cancel</Button><Button disabled={!all && !draft.length} onClick={() => { onApply(all ? null : draft); setOpen(false); }}>Apply filters</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
