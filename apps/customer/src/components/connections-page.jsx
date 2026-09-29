import { useEffect, useState } from 'react';
import { Users, RefreshCw, Link } from 'lucide-react';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { EventCard } from './event-card';
import { LoadingIndicator } from './loading-indicator';
import { ConnectionFilter } from './connection-filter';
import { api } from '../lib/api';
import { connectionEvents, connectionLink, selectedConnection } from '../lib/connections';

export function ConnectionsPage({ session, history, saved, onSave, onReferral, onRefresh, onVisible }) {
  const [entries, setEntries] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [people, setPeople] = useState(null), [city, setCity] = useState(''), [query, setQuery] = useState(''), [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false), [total, setTotal] = useState(0);
  const [choices, setChoices] = useState({}), [opening, setOpening] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { const timer = setTimeout(() => setSubmittedQuery(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { setPage(1); setEntries([]); }, [people, city, submittedQuery]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (city.trim()) params.set('city', city.trim());
    if (submittedQuery) params.set('query', submittedQuery);
    if (people?.length) params.set('personIds', people.join(','));
    api(`/customer/connections?${params}`, { token: session.accessToken, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setEntries((current) => page === 1 ? result.items : [...current, ...result.items]);
        setTotal(result.total); setHasMore(result.hasMore);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session.accessToken, page, people?.join(','), city, submittedQuery, refresh]);
  useEffect(() => { onVisible?.(entries.map((entry) => entry.event)); return () => onVisible?.([]); }, [entries, onVisible]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer); }, [message]);
  const groups = connectionEvents(entries);
  async function open(entry) {
    if (opening) return;
    setOpening(entry.event.id); setError('');
    try { await onReferral(entry); }
    catch (cause) { setError(cause.message); }
    finally { setOpening(''); }
  }
  async function share(entry) {
    try { await navigator.clipboard.writeText(connectionLink(entry, window.location.origin)); setMessage(`Copied ${entry.referrer.name}'s event link.`); }
    catch { setError('Could not copy this link. Please try again.'); }
  }
  return <main className="connections-page booked-page wrap" id="connections">
    <div className="booked-page-heading"><p className="eyebrow">FAMILIAR FACES. NEW NIGHTS.</p><h1>Connections.</h1><p>Find where your people are next. Book with them again.</p></div>
    <div className="connections-toolbar">
      <ConnectionFilter session={session} selected={people} onApply={setPeople} />
      <label className="connection-search"><span className="sr-only">Search connections and events</span><input type="search" placeholder="Search events or people" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="connection-city"><span className="sr-only">Connection event city</span><input type="search" placeholder="City" value={city} onChange={(event) => setCity(event.target.value)} /></label>
      {(people !== null || city || query) && <Button variant="ghost" onClick={() => { setPeople(null); setCity(''); setQuery(''); }}>Clear filters</Button>}
      <Button variant="ghost" onClick={() => { setRefresh((value) => value + 1); onRefresh(); }} aria-label="Refresh connections" disabled={loading}><RefreshCw size={16} /></Button>
    </div>
    {error && <p className="account-error" role="alert">{error} <button onClick={() => setRefresh((value) => value + 1)}>Try again</button></p>}
    {message && <p role="status" className="connections-message">{message}</p>}
    {loading && !entries.length ? <LoadingIndicator>Finding your connections’ next events…</LoadingIndicator> : <>
      <div className="connections-heading"><h2>Book with them again</h2><span>{total} matching {total === 1 ? 'connection' : 'connections'} across upcoming events</span></div>
      {!groups.length && !error && !hasMore && <div className="account-empty"><Users /><h3>{history?.eligible ? 'No upcoming matches just yet.' : 'Your connections will appear here.'}</h3><p>Try another person, city, or search. Your connection history stays available between events.</p></div>}
      <div className="event-grid">{groups.map((group) => {
        const entry = selectedConnection(group, choices[group.event.id]);
        return <EventCard key={group.event.id} event={group.event} saved={saved.includes(group.event.id)} onSave={() => onSave(group.event)} onOpen={() => open(entry)} actionLabel={opening === group.event.id ? 'Opening…' : `Book with ${entry.referrer.name.split(' ')[0]}`}>
          <div className="connection-referral">
            {group.referrals.length > 1 ? <Select value={entry.referrer.id} onValueChange={(value) => setChoices((current) => ({ ...current, [group.event.id]: value }))}><SelectTrigger aria-label={`Book ${group.event.title} through`}><SelectValue /></SelectTrigger><SelectContent>{group.referrals.map((option) => <SelectItem key={option.referrer.id} value={option.referrer.id}>{option.referrer.name}</SelectItem>)}</SelectContent></Select> : <strong>With {entry.referrer.name}</strong>}
            <p>Your booking or guestlist request credits this connection. Guestlists require approval.</p>
            <Button variant="ghost" onClick={() => share(entry)} aria-label={`Copy ${entry.referrer.name}'s referral link for ${group.event.title}`}><Link size={14} /> Share their link</Button>
          </div>
        </EventCard>;
      })}</div>
      {loading && entries.length > 0 && <LoadingIndicator>Loading more connections…</LoadingIndicator>}
      {hasMore && <Button className="load-more" variant="outline" disabled={loading} onClick={() => setPage((value) => value + 1)}>More nights with your connections</Button>}
    </>}
  </main>;
}
