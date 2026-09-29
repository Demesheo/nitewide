import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { LoadingIndicator } from './loading-indicator';
import { api } from '../lib/api';
import { connectionEvents } from '../lib/connections';

export function EventConnectionPicker({ session, eventId, referral, busy, onSelect }) {
  const [entries, setEntries] = useState([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false);
  useEffect(() => { setEntries([]); setPage(1); setHasMore(false); }, [eventId, session.accessToken]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    api(`/customer/connections?eventId=${encodeURIComponent(eventId)}&page=${page}&pageSize=30`, { token: session.accessToken, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setEntries((current) => page === 1 ? data.items : [...current, ...data.items]); setHasMore(data.hasMore); } })
      .catch(() => { if (!controller.signal.aborted) setError('Couldn’t load your connections.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session.accessToken, eventId, page, retry]);
  if (loading && !entries.length) return <LoadingIndicator>Finding your connections for this event…</LoadingIndicator>;
  if (error && !entries.length) return <div className="event-connection-picker"><p role="alert">{error}</p><Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>Retry connections</Button></div>;
  if (!entries.length) return hasMore ? <div className="event-connection-picker"><Button variant="outline" disabled={loading} onClick={() => setPage((value) => value + 1)}>More connections</Button></div> : null;
  const referrals = connectionEvents(entries).find((group) => group.event.id === eventId)?.referrals || [];
  const currentCode = referral?.eventId === eventId ? referral.code : null;
  const current = referrals.find((entry) => entry.code === currentCode);
  return <div className="event-connection-picker">
    <span id="event-connection-label">Book with</span>
    <Select value={current?.referrer.id || (currentCode ? 'current-link' : 'direct')} disabled={busy} onValueChange={(value) => onSelect(value === 'direct' ? null : referrals.find((entry) => entry.referrer.id === value))}>
      <SelectTrigger aria-labelledby="event-connection-label"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="direct">Book directly</SelectItem>
        {currentCode && !current && <SelectItem value="current-link">{referral.referrerName} · Current link</SelectItem>}
        {referrals.map((entry) => <SelectItem key={entry.referrer.id} value={entry.referrer.id}>{entry.referrer.name}</SelectItem>)}
      </SelectContent>
    </Select>
    {busy ? <LoadingIndicator>Applying your connection…</LoadingIndicator> : <p>Choose who gets credit for your booking or guestlist request.</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></p>}
    {hasMore && <Button variant="outline" disabled={loading} onClick={() => setPage((value) => value + 1)}>{loading ? 'Loading…' : 'More connections'}</Button>}
  </div>;
}
