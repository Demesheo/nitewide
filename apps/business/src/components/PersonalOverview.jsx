import { ArrowRight, CircleDollarSign, Ticket, Users, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EventTable } from './EventTable';
import { money } from '@/lib/business';

export function PersonalOverview({ data, onEvents, onAnalytics, onGuestlists }) {
  const { report } = data;
  const summary = report.summary;
  const dates = new Map(data.events.map((event) => [event.id, event.startsAt]));
  const events = report.events.filter((event) => event.orders > 0).map((event) => ({ ...event, startsAt: dates.get(event.id) }));
  return <div className="personal-workspace">
    <div className="metric-grid">
      <div className="metric"><div><span>Your referred sales</span><CircleDollarSign size={18}/></div><strong>{money(summary.salesCents)}</strong><small>Ticket and package value before fees</small></div>
      <div className="metric"><div><span>Your paid orders</span><Ticket size={18}/></div><strong>{summary.orders.toLocaleString()}</strong><small>Purchases credited to your links and codes</small></div>
      <div className="metric"><div><span>Your commission</span><Wallet size={18}/></div><strong>{money(summary.commissionCents)}</strong><small>Recorded earnings · not payout status</small></div>
      <div className="metric"><div><span>Your active events</span><Users size={18}/></div><strong>{data.events.filter((event) => new Date(event.endsAt) >= new Date()).length}</strong><small>Events you can access</small></div>
    </div>
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">YOUR ACTIVITY</span><h2>Sales by event</h2><p>Only purchases credited to you appear here. Open an event for your customers, referral code, and guestlist.</p></div><Button variant="outline" onClick={onAnalytics}>View analytics <ArrowRight size={16}/></Button></div>
      <EventTable rows={events} defaultSort="salesCents" defaultDescending empty="No referred sales yet" emptyDescription="Your events are available under My events. Credited purchases will appear here." onSelect={(event)=>onEvents(event.id)} columns={[
        {key:'name',label:'Event',render:(event)=><><strong>{event.name}</strong>{event.startsAt && <small className="block text-muted-foreground">{new Date(event.startsAt).toLocaleDateString()}</small>}</>},
        {key:'orders',label:'Paid orders',numeric:true},
        {key:'salesCents',label:'Referred sales',numeric:true,render:(event)=>money(event.salesCents)},
      ]}/>
    </section>
    <div className="personal-actions"><Button variant="outline" onClick={()=>onEvents()}>View my events</Button><Button variant="outline" onClick={onGuestlists}>Review my guestlists</Button></div>
  </div>;
}
