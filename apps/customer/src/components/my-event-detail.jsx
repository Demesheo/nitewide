import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, MapPin, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { EventArtwork } from './event-artwork';
import { LoadingIndicator } from './loading-indicator';
import { MyEventActions } from './my-event-actions';
import { api } from '../lib/api';
import { businessLink } from '../lib/business-link';
import { eventAddressLines, eventDate, eventTime } from '../lib/presentation';
import { eventVenueName } from '../lib/event-venue';
import { isMyEventsUnauthorized, myEventBusinessUrl, myEventPhase, myEventsCount, myEventsMoney, validMyEventDetail } from '../lib/my-events';

function Metric({ label, value, note }) {
  return <div className="my-event-metric"><dt>{label}</dt><dd>{value}</dd>{note && <p>{note}</p>}</div>;
}

export function MyEventStats({ detail }) {
  const own = detail.scope === 'own';
  const { summary, personalEarnings } = detail;
  const payouts = personalEarnings.payoutsTracked === true && typeof personalEarnings.receivedPayouts === 'number' ? myEventsMoney(personalEarnings.receivedPayouts) : 'Unavailable';
  const sampleCommission = personalEarnings.demoCommissionCents + personalEarnings.sandboxCommissionCents;
  const tiers = Array.isArray(detail.tiers) ? detail.tiers.filter(tier => tier.units || tier.salesCents).slice(0, 6) : [];
  return <>
    <section className="my-event-stats" aria-labelledby="my-event-stats-heading">
      <div className="my-event-section-heading"><div><p className="eyebrow">THE NIGHT IN NUMBERS</p><h2 id="my-event-stats-heading">{own ? 'Your performance' : 'Event performance'}</h2></div><span className="my-event-scope">{own ? 'Only your attributed activity' : 'Across the event'}</span></div>
      <dl className="my-event-metrics">
        <Metric label={own ? 'Your referred sales' : 'Ticket & package sales'} value={myEventsMoney(summary.salesCents)} note="Before customer fees" />
        <Metric label={own ? 'Your paid orders' : 'Paid orders'} value={myEventsCount(summary.orders)} />
        <Metric label={own ? 'Your ticket admissions' : 'Ticket admissions'} value={myEventsCount(summary.admissions)} />
        <Metric label={own ? 'Your guestlist spots' : 'Guestlist spots'} value={myEventsCount(summary.guestlistPlaces)} note="Confirmed & checked in" />
        <Metric label={own ? 'Your checked-in guests' : 'Checked-in guests'} value={myEventsCount(summary.checkedIn)} />
        {!own && <Metric label="Total event commissions" value={myEventsMoney(summary.commissionCents)} note="Recorded for all referrers" />}
      </dl>
      <p className="my-events-recorded-note">Recorded totals may include demo or sandbox activity and are not a payout or settlement statement.</p>
    </section>
    <section className="my-event-earnings" aria-labelledby="my-event-earnings-heading">
      <div className="my-event-section-heading"><div><p className="eyebrow">CREDITED TO YOU</p><h2 id="my-event-earnings-heading">Your earnings</h2></div></div>
      <dl className="my-event-earnings-metrics">
        <Metric label="Your earned commission" value={myEventsMoney(personalEarnings.earnedCommissionCents)} note="Recorded earnings · not a payout" />
        <Metric label="Payouts received" value={payouts} note={personalEarnings.payoutsTracked ? 'Tracked payouts to you' : 'Not yet tracked'} />
      </dl>
      {sampleCommission > 0 && <p className="my-event-financial-note">Recorded commission includes {myEventsMoney(sampleCommission)} from demo or sandbox orders.</p>}
      {personalEarnings.unverifiedCommissionCents > 0 && <p className="my-event-financial-note">{myEventsMoney(personalEarnings.unverifiedCommissionCents)} is from orders whose payment verification is unavailable.</p>}
    </section>
    {tiers.length > 0 && <section className="my-event-sales-mix" aria-labelledby="my-event-sales-mix-heading"><div className="my-event-section-heading"><h2 id="my-event-sales-mix-heading">{own ? 'Your sales by ticket & package' : 'Sales by ticket & package'}</h2></div><ul>{tiers.map(tier => <li key={tier.id}><span><strong>{tier.name}</strong><small>{myEventsCount(tier.units)} sold</small></span><strong>{myEventsMoney(tier.salesCents)}</strong></li>)}</ul></section>}
  </>;
}

export function MyEventDetail({ session, eventId, refreshKey = 0, accessChecking = false, onBack, onUnauthorized }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const token = session?.accessToken;
  const requestKey = `${token}:${eventId}:${revision}:${refreshKey}`;
  const detail = snapshot?.token === token && snapshot?.eventId === eventId ? snapshot.data : null;
  const reloadDetail = () => setRevision(value => value + 1);
  useEffect(() => {
    if (!token || !eventId) { setSnapshot(null); setLoading(false); return; }
    if (accessChecking || snapshot?.requestKey === requestKey) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.resolve().then(() => controller.signal.aborted ? undefined : api(`/customer/my-events/${encodeURIComponent(eventId)}`, { token, signal: controller.signal }))
      .then(data => {
        if (controller.signal.aborted) return;
        if (!validMyEventDetail(data) || data.event.id !== eventId) throw new Error('We couldn’t load this event. Please try again.');
        setSnapshot({ token, eventId, data, requestKey });
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        // A permission failure also removes all previously rendered finances.
        if (isMyEventsUnauthorized(cause)) { setSnapshot(null); onUnauthorized?.(cause); }
        else {
          if (cause.status === 404) setSnapshot(null);
          setError(cause.status === 404 ? 'This event is no longer available to your account.' : cause.message || 'We couldn’t load this event. Please try again.');
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId, token, revision, refreshKey, accessChecking, onUnauthorized]);
  const event = detail?.event;
  const phase = event && myEventPhase(event);
  return <div className="my-event-detail">
    <div className="my-event-detail-top"><Button variant="ghost" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" /> All my events</Button>{detail && <Button variant="ghost" aria-label="Refresh event details" disabled={loading} onClick={reloadDetail}><RefreshCw size={17} aria-hidden="true" /></Button>}</div>
    {error && <div className="my-events-error" role="alert"><p>{error}</p><Button variant="outline" onClick={reloadDetail}>Try again</Button></div>}
    {loading && !detail ? <LoadingIndicator>Loading event details…</LoadingIndicator> : detail && <>
      <section className="my-event-hero" aria-labelledby="my-event-title">
        <EventArtwork event={event} className="my-event-detail-flyer" />
        <div className="my-event-hero-copy"><p className="eyebrow">{detail.capabilities.readOnly ? 'EVENT ARCHIVE' : 'EVENT OPERATIONS'}{phase === 'ongoing' ? ' · HAPPENING NOW' : ''}</p><h1 id="my-event-title">{event.title}</h1><p className="my-event-meta"><CalendarDays size={16} aria-hidden="true" /><span>{eventDate(event)} · {eventTime(event)}</span></p><p className="my-event-meta"><MapPin size={16} aria-hidden="true" /><span>{eventVenueName(event)}</span></p><div className="my-event-address">{eventAddressLines(event.location).map(line => <span key={line}>{line}</span>)}</div>{event.organization?.name && <p className="my-event-organization">{event.organization.name}</p>}</div>
        {detail.scope === 'event' && <Button className="my-event-business" variant="outline" asChild><a href={myEventBusinessUrl(businessLink(import.meta.env.VITE_BUSINESS_URL, window.location), eventId, window.location)} target="_blank" rel="noopener noreferrer">Open in Business <ArrowUpRight size={16} aria-hidden="true" /></a></Button>}
        {event.summary && <p className="my-event-description">{event.summary}</p>}
      </section>
      {detail.capabilities.readOnly && <p className="my-event-readonly" role="status">{phase === 'past' ? 'This event has ended.' : phase === 'cancelled' ? 'This event was cancelled.' : 'This event is read-only.'} You can review its stats and guestlists here.</p>}
      <MyEventStats detail={detail} />
      <MyEventActions key={detail.scope} session={session} detail={detail} onChanged={reloadDetail} onUnauthorized={onUnauthorized} />
    </>}
  </div>;
}
