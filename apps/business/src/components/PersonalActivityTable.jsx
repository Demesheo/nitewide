import { useRef, useState } from 'react';
import { usePagedResource } from '@/hooks/usePagedResource';
import { money } from '@/lib/business';
import { eventReportTime } from '@/lib/report-time';
import { EventTable } from './EventTable';
import { ServerPager } from './ServerPager';
import { LoadingState } from './LoadingState';
import { Button } from './ui/button';

/** The original personal tables, backed by bounded authorized report pages. */
export function PersonalActivityTable({ kind = 'events', session, query, onUnauthorized, onEvent, revision, columns }) {
  const panel = useRef(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('salesCents');
  const [descending, setDescending] = useState(true);
  const params = new URLSearchParams(query);
  params.set('activityOnly', 'true');
  if (search.trim()) params.set('search', search.trim());
  const sortFields = { name: 'name', orders: 'orders', salesCents: 'sales', customers: 'customers', units: 'units' };
  params.set('sort', `${sortFields[sort]}_${descending ? 'desc' : 'asc'}`);
  const resource = usePagedResource(`/business/reports/${kind}?${params}`, session, { pageSize: 10, refreshToken: revision, onUnauthorized });
  const rows = (resource.result?.items || []).map((row) => ({ ...row, name: row.label }));
  return <div ref={panel}>
    {resource.loading && <LoadingState>Loading your activity…</LoadingState>}
    {resource.error && <p className="error" role="alert">{resource.error}<Button variant="outline" onClick={resource.retry}>Try again</Button></p>}
    <EventTable rows={rows} columns={columns || [
      { key: 'name', label: 'Event', render: (row) => <><strong>{row.name}</strong>{row.startsAt && <small className="block text-muted-foreground">{eventReportTime(row)}</small>}</> },
      { key: 'orders', label: 'Paid orders', numeric: true },
      { key: 'salesCents', label: 'Referred sales', numeric: true, render: (row) => money(row.salesCents) },
    ]} onSelect={kind === 'events' ? (row) => onEvent?.(row.eventId, row.name, row.startsAt, row.venueTimezone) : undefined}
      empty={kind === 'events' ? 'No referred sales yet' : 'No referred customers yet'}
      remote={{ search, onSearch: setSearch, sort, descending, onSort: (key, down) => { setSort(key); setDescending(down); } }}/>
    <ServerPager result={resource.result} page={resource.page} onPageChange={resource.setPage} disabled={resource.loading} targetRef={panel}/>
  </div>;
}
