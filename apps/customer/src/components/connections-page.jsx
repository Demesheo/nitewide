import { useEffect, useState } from 'react';
import { Users, RefreshCw, Link } from 'lucide-react';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { EventCard } from './event-card';
import { LoadingIndicator } from './loading-indicator';
import { ConnectionFilter } from './connection-filter';
import { api } from '../lib/api';
import { connectionCity, connectionEvents, connectionLink, selectedConnection } from '../lib/connections';

export function ConnectionsPage({ session, history, saved, onSave, onReferral, onRefresh }) {
  const [entries, setEntries] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [people, setPeople] = useState(null), [city, setCity] = useState('all'), [query, setQuery] = useState('');
  const [choices, setChoices] = useState({}), [limit, setLimit] = useState(9), [opening, setOpening] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setEntries([]);
    api('/customer/connections', { token: session.accessToken, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setEntries(data); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session.accessToken, refresh]);
  useEffect(() => { setLimit(9); }, [people, city, query]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer); }, [message]);
  const groups = connectionEvents(entries, { people, city, query });
  const upcoming = connectionEvents(entries);
  const cities = [...new Set(upcoming.map(({ event }) => connectionCity(event)))].sort();
  async function open(entry) {
    if (opening) return;
    setOpening(entry.event.id); setError('');
    try { await onReferral(entry); }
    catch (err) { setError(err.message); }
    finally { setOpening(''); }
  }
  async function share(entry) {
    try { await navigator.clipboard.writeText(connectionLink(entry, window.location.origin)); setMessage(`Copied ${entry.referrer.name}'s event link.`); }
    catch { setError('Could not copy this link. Please try again.'); }
  }
  return <main className="connections-page booked-page wrap" id="connections">
    <div className="booked-page-heading"><p className="eyebrow">FAMILIAR FACES. NEW NIGHTS.</p><h1>Connections.</h1><p>Find where your people are next. Book with them again.</p></div>
    <div className="connections-toolbar">
      <ConnectionFilter people={history.people} selected={people} onApply={setPeople} upcoming={upcoming} loading={loading} />
      <label className="connection-search"><span className="sr-only">Search connections and events</span><input type="search" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {cities.length > 1 && <Select value={city} onValueChange={setCity}><SelectTrigger aria-label="Connection event city"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All cities</SelectItem>{cities.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>}
      {(people !== null || city !== 'all' || query) && <Button variant="ghost" onClick={() => { setPeople(null); setCity('all'); setQuery(''); }}>Clear filters</Button>}
      <Button variant="ghost" onClick={() => { setRefresh((value) => value + 1); onRefresh(); }} aria-label="Refresh connections" disabled={loading}><RefreshCw size={16} /></Button>
    </div>
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p role="status" className="connections-message">{message}</p>}
    {loading ? <LoadingIndicator>Finding your connections’ next events…</LoadingIndicator> : <>
      <div className="connections-heading"><h2>Book with them again</h2><span>{groups.length} upcoming {groups.length === 1 ? 'event' : 'events'}</span></div>
      {!groups.length && !error && <div className="account-empty"><Users /><h3>{history.people.length ? 'No upcoming matches just yet.' : 'Your connections will appear here.'}</h3><p>{history.people.length ? 'Your people stay here between events. Try another person or city, or check back for their next night.' : 'Only active referrers and hosts are shown. New nights will appear when they have events to share.'}</p></div>}
      <div className="event-grid">{groups.slice(0, limit).map((group) => {
        const entry = selectedConnection(group, choices[group.event.id]);
        return <EventCard key={group.event.id} event={group.event} saved={saved.includes(group.event.id)} onSave={() => onSave(group.event)} onOpen={() => open(entry)} actionLabel={opening === group.event.id ? 'Opening…' : `Book with ${entry.referrer.name.split(' ')[0]}`}>
          <div className="connection-referral">
            {group.referrals.length > 1 ? <Select value={entry.referrer.id} onValueChange={(value) => setChoices((current) => ({ ...current, [group.event.id]: value }))}><SelectTrigger aria-label={`Book ${group.event.title} through`}><SelectValue /></SelectTrigger><SelectContent>{group.referrals.map((option) => <SelectItem key={option.referrer.id} value={option.referrer.id}>{option.referrer.name}</SelectItem>)}</SelectContent></Select> : <strong>With {entry.referrer.name}</strong>}
            <p>Your booking or guestlist request credits this connection. Guestlists require approval.</p>
            <Button variant="ghost" onClick={() => share(entry)} aria-label={`Copy ${entry.referrer.name}'s referral link for ${group.event.title}`}><Link size={14} /> Share their link</Button>
          </div>
        </EventCard>;
      })}</div>
      {groups.length > limit && <Button className="load-more" variant="outline" onClick={() => setLimit((value) => value + 9)}>More nights with your connections</Button>}
    </>}
  </main>;
}
