import { ArrowRight, MapPin, Ticket } from 'lucide-react';
import { EventArtwork } from './event-artwork';
import { eventDate, eventTime } from '../lib/presentation';
import { money } from '../lib/discovery';
import { LoadingIndicator } from './loading-indicator';
import { isPremiumHost } from '../lib/premium-host';
import { eventVenueName } from '../lib/event-venue';

const guestStatuses = { pending: 'Awaiting approval', confirmed: 'Approved', rejected: 'Declined', checked_in: 'Checked in', cancelled: 'Cancelled', no_show: 'Not attended' };

export function NightCard({ entry, kind, busy, onOpen }) {
  const guestlist = kind === 'guestlist';
  const admissions = guestlist ? [] : entry.items.flatMap((item) => item.tickets);
  const count = guestlist ? entry.partySize : admissions.length;
  const scanned = guestlist ? (entry.status === 'checked_in' ? entry.partySize : 0) : admissions.filter((item) => item.status === 'checked_in').length;
  const items = guestlist ? [{ id: entry.id, quantity: entry.partySize, name: 'Guest list entry' }] : entry.items;
  const action = guestlist ? 'View guest list entry' : 'View tickets';
  const unavailable = guestlist && !['confirmed', 'checked_in'].includes(entry.status);
  return <button type="button" className={`purchase-card${isPremiumHost(entry.event) ? ' premium-host-card' : ''}`} data-ticket-id={entry.id}
    aria-label={`${action} for ${entry.event.title}, ${items.map((item) => `${item.quantity} ${item.name}`).join(', ')}`}
    disabled={Boolean(busy) || unavailable} onClick={() => onOpen(entry.id, kind)}>
    <EventArtwork event={entry.event} className="booking-flyer" loading="lazy" />
    <div className="purchase-card-copy">
      <div className="booking-eyebrow"><span>{guestlist ? 'Guest list entry' : entry.status === 'paid' ? 'Booked' : entry.status}</span>{guestlist && <span>{guestStatuses[entry.status]}</span>}{entry.demo && <span>Demo</span>}</div>
      <h3>{entry.event.title}</h3>
      <p>{eventDate(entry.event)} · {eventTime(entry.event)}</p>
      <p><MapPin size={12} /> {eventVenueName(entry.event, entry.event.location?.city)}</p>
      <div className="purchase-card-items">{items.map((item) => <span key={item.id}>{item.quantity} × {item.name}</span>)}</div>
      <div className="purchase-card-footer"><span><Ticket size={14} /> {count} {guestlist ? (count === 1 ? 'guest' : 'guests') : (count === 1 ? 'ticket' : 'tickets')}{scanned > 0 && <b className="scanned-count"> · {scanned} checked in</b>}</span><strong>{guestlist ? 'Free' : money(entry.totalCents, entry.currency)}</strong></div>
      <span className="purchase-card-action">{busy === entry.id ? <LoadingIndicator>Opening…</LoadingIndicator> : unavailable ? guestStatuses[entry.status] : action}{!unavailable && busy !== entry.id && <ArrowRight size={14} />}</span>
    </div>
  </button>;
}
