import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { LoadingIndicator } from './loading-indicator';
import { api } from '../lib/api';
import { connectionEvents } from '../lib/connections';

// Event-scoped lookup avoids the main Connections feed's 100-event limit.
export function EventConnectionPicker({ session, eventId, referral, busy, onSelect }) {
  const [entries, setEntries] = useState([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    api(`/customer/connections?eventId=${encodeURIComponent(eventId)}`, { token: session.accessToken, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setEntries(connectionEvents(data).find((group) => group.event.id === eventId)?.referrals || []); })
      .catch(() => { if (!controller.signal.aborted) setError('Couldn’t load your connections.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session.accessToken, eventId, retry]);
  if (loading) return <LoadingIndicator>Finding your connections for this event…</LoadingIndicator>;
  if (error) return <div className="event-connection-picker"><p role="alert">{error}</p><Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>Retry connections</Button></div>;
  if (!entries.length) return null;
  const currentCode = referral?.eventId === eventId ? referral.code : null;
  const current = entries.find((entry) => entry.code === currentCode);
  return <div className="event-connection-picker">
    <span id="event-connection-label">Book with</span>
    <Select value={current?.referrer.id || (currentCode ? 'current-link' : 'direct')} disabled={busy} onValueChange={(value) => onSelect(value === 'direct' ? null : entries.find((entry) => entry.referrer.id === value))}>
      <SelectTrigger aria-labelledby="event-connection-label"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="direct">Book directly</SelectItem>
        {currentCode && !current && <SelectItem value="current-link">{referral.referrerName} · Current link</SelectItem>}
        {entries.map((entry) => <SelectItem key={entry.referrer.id} value={entry.referrer.id}>{entry.referrer.name}</SelectItem>)}
      </SelectContent>
    </Select>
    {busy ? <LoadingIndicator>Applying your connection…</LoadingIndicator> : <p>Choose who gets credit for your booking or guestlist request.</p>}
  </div>;
}
