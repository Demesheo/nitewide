import { CheckCircle2, ChevronLeft, ChevronRight, MapPin, Ticket } from 'lucide-react';
import { Button } from './ui/button';
import { EventArtwork } from './event-artwork';
import { eventAddress, eventDate, eventTime } from '../lib/presentation';
import { eventVenueName } from '../lib/event-venue';
import { mapsUrlForLocation } from '../lib/maps-link';
import { money } from '../lib/discovery';

const statusLabel = { pending: 'Pending review', confirmed: 'Approved', rejected: 'Declined', checked_in: 'Checked in', no_show: 'Not attended' };

export function AdmissionPassView({ ticket, index, onIndex, cached = false }) {
  const count = ticket.tickets.length;
  const entry = ticket.tickets[index] || null;
  const mapsUrl = mapsUrlForLocation(ticket.event.location);
  return <section className="ticket-view">
    <div className="purchase-ticket-heading">
      <EventArtwork event={ticket.event} className="booking-flyer" />
      <div><p className="eyebrow">{ticket.demo ? 'DEMO PURCHASE' : 'YOUR NIGHT'}</p><h3>{ticket.event.title}</h3><p>{eventDate(ticket.event)} · {eventTime(ticket.event)}</p><p>{eventVenueName(ticket.event)}</p><p aria-label="Event address">{eventAddress(ticket.event.location)}</p>{mapsUrl && <a className="ticket-maps-link" href={mapsUrl} target="_blank" rel="noopener noreferrer"><MapPin size={15} /> Open in Maps</a>}</div>
    </div>
    {cached && <p className="pass-offline-note" role="status">Previously loaded pass. Its current admission status could not be verified. Reconnect for the latest status; venue staff verify entry when scanning.</p>}
    <div className="ticket-list-summary" aria-live="polite"><strong>{ticket.tickets.filter((item) => item.status === 'checked_in').length} of {count} checked in{cached ? ' · Last known' : ''}</strong><span>{cached ? 'Reconnect to update admission status' : entry?.qrImage ? count > 1 ? 'Show one pass at a time at the door · Status updates automatically' : 'Show your QR code at the door · Status updates automatically' : ticket.kind === 'guestlist' && entry?.status === 'pending' ? 'Host approval is required before a QR pass is available' : 'No scannable pass is currently available'}</span></div>
    {count > 1 && <div className="pass-pager" aria-label="Choose admission pass">
      <Button variant="outline" size="icon" aria-label="Previous pass" disabled={index === 0} onClick={() => onIndex(index - 1)}><ChevronLeft size={18} /></Button>
      <strong>Pass {index + 1} of {count}</strong>
      <Button variant="outline" size="icon" aria-label="Next pass" disabled={index >= count - 1} onClick={() => onIndex(index + 1)}><ChevronRight size={18} /></Button>
    </div>}
    {entry && <article className={`admission-pass ${entry.status}`} aria-label={`${ticket.kind === 'guestlist' ? 'Guest list entry' : `Ticket ${index + 1}`}: ${statusLabel[entry.status] || entry.status}`}>
      <div className="pass-code">{entry.qrImage ? <img src={entry.qrImage} alt={`QR code for ${ticket.kind === 'guestlist' ? 'guest list entry' : `ticket ${index + 1}`}, ${entry.offering}`} /> : <div className="pass-no-code"><Ticket /><span>{entry.status === 'checked_in' ? 'Admitted' : 'QR unavailable'}</span></div>}</div>
      <div className="pass-info"><p className="eyebrow">{ticket.kind === 'guestlist' ? 'GUEST LIST ENTRY' : `TICKET ${index + 1} OF ${count}`}</p><h4>{entry.offering}</h4><span className="pass-status">{entry.status === 'checked_in' ? <><CheckCircle2 size={16} /> Checked in</> : ['valid', 'confirmed'].includes(entry.status) ? (entry.qrImage ? cached ? 'Previously ready for entry' : 'Ready for entry' : 'Pass unavailable') : statusLabel[entry.status] || entry.status.replace('_', ' ')}</span><p>{entry.checkedInAt ? `Admitted ${new Date(entry.checkedInAt).toLocaleString('en-US', { timeZone: ticket.event.location?.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ticket.kind === 'guestlist' ? `${ticket.partySize} ${ticket.partySize === 1 ? 'guest' : 'guests'}${entry.qrImage ? ' · One code for your party' : ''}` : 'One admission · Keep this code private'}</p><small>{ticket.demo ? 'Local demo only · No payment collected' : entry.status === 'checked_in' ? 'Entry confirmed. This code cannot be used again.' : !entry.qrImage ? ticket.kind === 'guestlist' && entry.status === 'pending' ? 'A scannable pass will appear after approval if the event is active.' : 'This pass is not currently scannable. Reconnect for the latest status.' : cached ? 'Venue staff will verify this previously loaded code when scanning.' : ticket.kind === 'guestlist' ? 'Arrive together. This code checks in your entire approved party.' : 'Show this code at the door.'}</small><details className="pass-id"><summary>Pass ID</summary><code>{entry.id}</code></details></div>
    </article>}
    {!count && <p className="account-empty">{ticket.kind === 'guestlist' ? 'This request does not have a pass yet. Approval is required before entry.' : 'No tickets are currently assigned to you for this purchase.'}</p>}
    {ticket.kind !== 'guestlist' && <details className="booking-receipt purchase-receipt"><summary>Purchase receipt · {money(ticket.totalCents, ticket.currency)}</summary><p>Tickets & packages: {money(ticket.subtotalCents, ticket.currency)}<br />Service fee: {money(ticket.totalCents - ticket.subtotalCents, ticket.currency)}</p><small>Order {ticket.id}</small></details>}
  </section>;
}
