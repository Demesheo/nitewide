import { useRef, useState } from 'react';
import { money } from '@/lib/business';
import { usePagedResource } from '@/hooks/usePagedResource';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Empty } from './controls';
import { SalesMixPie } from './SalesMixPie';
import { LoadingState } from './LoadingState';
import { ServerPager } from './ServerPager';
import { EventAttendees } from './EventDetail';
import { EventTable } from './EventTable';

export function EventSales({ data, session, onUnauthorized, refreshToken = 0 }) {
  const { event, summary, scope } = data;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState('salesCents');
  const [descending, setDescending] = useState(true);
  const [purchaseSort, setPurchaseSort] = useState('salesCents');
  const [purchaseDescending, setPurchaseDescending] = useState(true);
  const attendeeRef = useRef(null);
  const purchaseRef = useRef(null);
  const attendeePath = `/business/events/${event.id}/attendees?search=${encodeURIComponent(search)}&sortKey=${sort}&descending=${descending}`;
  const attendees = usePagedResource(attendeePath, session, { onUnauthorized, refreshToken, pageSize: 10 });
  const detail = usePagedResource(selected ? `/business/events/${event.id}/attendees/${selected.id}?sortKey=${purchaseSort}&descending=${purchaseDescending}` : null, session, { onUnauthorized, pageSize: 10 });
  const ownOnly = scope === 'own';
  return <div className="event-sales-content">
    <div className="event-chart-grid"><section className="panel"><span className="eyebrow">WHAT SELLS</span><h3>{ownOnly ? 'Your sales by ticket & package' : 'Sales by ticket & package'}</h3>{summary.salesCents ? <SalesMixPie slices={data.tiers.filter((tier) => tier.salesCents > 0)}/> : <Empty title="Sales start here">Your ticket and package mix will appear after the first purchase.</Empty>}</section>
      {!ownOnly && <section className="panel"><span className="eyebrow">WHO BRINGS THE CROWD</span><h3>Sales by referral channel</h3>{summary.salesCents ? <SalesMixPie slices={data.channels.map((channel) => ({ ...channel, id: channel.name }))}/> : <Empty title="No sales yet">Direct and referred purchases will appear here.</Empty>}</section>}
    </div>
    <div ref={attendeeRef}>
      {attendees.loading && <LoadingState>Loading attendees…</LoadingState>}
      {attendees.error && <div className="error" role="alert">{attendees.error}<Button variant="outline" onClick={attendees.retry}>Try again</Button></div>}
      <EventAttendees customers={attendees.result?.items || []} onSelect={(person) => { setPurchaseSort('salesCents'); setPurchaseDescending(true); setSelected(person); }} remote={{ search, onSearch: setSearch, sort, descending, onSort: (key, down) => { setSort(key); setDescending(down); } }}
        footer={<ServerPager result={attendees.result} page={attendees.page} onPageChange={attendees.setPage} disabled={attendees.loading} label="attendees" targetRef={attendeeRef}/>}/>
    </div>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="event-customer-dialog"><DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{selected?.email}</DialogDescription></DialogHeader>
      {selected && <><div className="event-financials"><div><span>Event spending</span><strong>{money(selected.salesCents)}</strong></div><div><span>Guestlist status</span><strong>{detail.result?.guestlistStatuses?.map((value) => value.replaceAll('_',' ')).join(', ') || 'No request'}</strong></div></div>
        {detail.loading && <LoadingState>Loading attendee purchases…</LoadingState>}
        {detail.error && <div className="error" role="alert">{detail.error}<Button variant="outline" onClick={detail.retry}>Try again</Button></div>}
        <div className="event-customer-purchases"><EventTable searchable={false} rows={detail.result?.purchases?.items || []} remote={{ sort: purchaseSort, descending: purchaseDescending, onSort: (key, down) => { setPurchaseSort(key); setPurchaseDescending(down); } }} empty="No purchases for this event" columns={[{key:'name',label:'Purchased'},{key:'quantity',label:'Quantity',numeric:true},{key:'salesCents',label:'Amount',numeric:true,render:(item) => money(item.salesCents)},{key:'referredBy',label:'Source'}]}/></div>
        <ServerPager result={detail.result?.purchases} page={detail.page} onPageChange={detail.setPage} disabled={detail.loading} label="items"/>
      </>}
    </DialogContent></Dialog>
  </div>;
}
