import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { eventDateLabel, money } from '@/lib/business';
import { reportQuery, downloadBusinessReport } from '@/lib/report-client';
import { eventReportTime } from '@/lib/report-time';
import { usePagedResource } from '@/hooks/usePagedResource';
import { SalesMixPie } from './SalesMixPie';
import { ServerPager } from './ServerPager';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { LoadingState } from './LoadingState';
import { BusinessTeamPerformance } from './BusinessTeamPerformance';
import { SalesMixRankBars } from './SalesMixRankBars';
import { ReportTableSurface } from './ReportTableSurface';
import { AnalyticsReportHeader } from './AnalyticsReportHeader';

const names = { regions: 'regions', venues: 'venues', events: 'events', offerings: 'offerings', team: 'people', customers: 'customers' };
const columns = {
  regions: [['label', 'Region'], ['events', 'Events'], ['orders', 'Paid orders'], ['salesCents', 'Sales value'], ['customers', 'Customers'], ['units', 'Units'], ['checkedIn', 'Check-ins / expected'], ['averageOrderCents', 'Avg. order']],
  venues: [['label', 'Venue / creator'], ['events', 'Events'], ['orders', 'Paid orders'], ['salesCents', 'Sales value'], ['customers', 'Customers'], ['units', 'Units'], ['checkedIn', 'Check-ins / expected'], ['averageOrderCents', 'Avg. order']],
  events: [['label', 'Event'], ['orders', 'Paid orders'], ['salesCents', 'Sales value'], ['customers', 'Customers'], ['units', 'Units'], ['checkedIn', 'Check-ins / expected'], ['averageOrderCents', 'Avg. order']],
  offerings: [['label', 'Offering'], ['kind', 'Kind'], ['units', 'Units'], ['orders', 'Orders'], ['salesCents', 'Sales']],
  team: [['label', 'Person / channel'], ['role', 'Channel'], ['orders', 'Orders'], ['customers', 'Customers'], ['salesCents', 'Sales'], ['commissionCents', 'Commission']],
  customers: [['label', 'Customer'], ['orders', 'Orders'], ['salesCents', 'Sales']],
};

function cell(row, key, selectedVenueTimezone) {
  const value = row[key];
  if (key === 'checkedIn') return `${row.checkedIn || 0} / ${(row.admissions || 0) + (row.guestlistPlaces || 0)}`;
  if (key === 'averageOrderCents') return money(row.orders ? Math.round(row.salesCents / row.orders) : 0);
  if (key.endsWith('Cents')) return value == null ? '—' : money(value);
  if (key === 'startsAt') return eventReportTime(row, selectedVenueTimezone);
  if (typeof value === 'number') return value.toLocaleString();
  return value ?? '—';
}

export function BusinessReportTable({ kind, session, query, onUnauthorized, onEvent, onRegion, onVenue, refreshToken = 0,
  onOffering, initialPage = 1, onPageChange, pageSize = 10, onPageSizeChange, sort = 'sales_desc', onSortChange, selectedVenueTimezone, toolbar }) {
  const target = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const page = usePagedResource(query == null ? null : `/business/reports/${kind}?${query}`, session, { pageSize, initialPage, onPageChange, onUnauthorized, refreshToken });
  const columnSort = { label: 'name', salesCents: 'sales', orders: 'orders', startsAt: 'starts', events: 'events', customers: 'customers', units: 'units', checkedIn: 'checkins', averageOrderCents: 'average' };
  const header = ([key, label]) => {
    const field = columnSort[key];
    const active = field && sort.startsWith(`${field}_`);
    const next = active ? `${field}_${sort.endsWith('_desc') ? 'asc' : 'desc'}`
      : `${field}_${['sales', 'orders', 'starts'].includes(field) ? 'desc' : 'asc'}`;
    return <th key={key} scope="col">{field && onSortChange ? <button type="button" className="analytics-sort" aria-label={`Sort by ${label}`} onClick={() => onSortChange(next)}>
      {label}<span aria-hidden="true">{active ? sort.endsWith('_desc') ? ' ↓' : ' ↑' : ' ↕'}</span></button> : label}</th>;
  };
  const drill = (row) => kind === 'regions' ? onRegion?.(row.label) : kind === 'venues' ? onVenue?.(row.id)
    : kind === 'offerings' ? onOffering?.(row.kind, row.label) : onEvent?.(row.eventId, row.label, row.startsAt, row.venueTimezone);
  const expandable = ['events', 'regions', 'venues'].includes(kind) || (kind === 'offerings' && Boolean(onOffering));
  const exportRows = async () => {
    if (!query || exporting) return;
    const params = new URLSearchParams(query);
    params.set('exportTable', kind);
    setExporting(true); setExportError('');
    try { await downloadBusinessReport(session, params.toString()); }
    catch (error) { if (error.status === 401) onUnauthorized?.(); else if (error.name !== 'AbortError') setExportError(error.message); }
    finally { setExporting(false); }
  };
  return <section className="rounded-xl border border-border bg-card report-table-panel" ref={target} aria-busy={query != null && page.loading}>
    <AnalyticsReportHeader title={kind === 'team' ? 'Team performance and direct sales' : kind === 'offerings' ? 'Tickets and packages' : kind === 'customers' ? 'Customers' : kind === 'regions' ? 'Regions' : kind === 'venues' ? 'Venues & creators' : 'Events'}
      description={kind === 'customers' ? 'Use customer details only for order operations.' : expandable ? 'Select a row to see the next level.' : 'Paid sales in this selection.'}
      action={<Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!query || exporting} onClick={exportRows}><ArrowDownToLine size={15}/>{exporting ? 'Preparing…' : 'Export CSV'}</Button>}/>
    {exportError && <div className="error mx-5" role="alert">{exportError}</div>}
    {toolbar}
    {query != null && page.loading && <LoadingState>{page.result ? 'Updating report…' : 'Loading report…'}</LoadingState>}
    {query != null && page.error && <div className="error" role="alert">{page.error}<Button variant="outline" onClick={page.retry}>Try again</Button></div>}
    {query != null && page.result && <><ReportTableSurface label={`${kind} report`}><thead><tr>{columns[kind].map(header)}</tr></thead>
      <tbody>{page.result.items.map((row) => <tr key={row.id} className={expandable ? 'cursor-pointer hover:bg-accent/50' : ''} onClick={expandable ? () => drill(row) : undefined}>{columns[kind].map(([key]) => <td key={key} data-label={columns[kind].find(([name]) => name === key)?.[1]}>{key === 'label' ? <>{expandable ? <button type="button" className="analytics-drill" onClick={(event) => { event.stopPropagation(); drill(row); }}>{row.label}<ChevronRight size={13}/></button> : <strong>{row.label}</strong>}{row.email && <small className="block text-muted-foreground">{row.email}</small>}{kind === 'venues' && <small className="block text-muted-foreground">{row.organizationId ? 'Venue' : 'Independent creator'}</small>}{kind === 'events' && <><small className="block text-muted-foreground">{row.status}</small><small className="block text-muted-foreground">{eventReportTime(row, selectedVenueTimezone)}</small></>}</> : cell(row, key, selectedVenueTimezone)}</td>)}
      </tr>)}</tbody></ReportTableSurface>
      {!page.result.items.length && !page.loading && <p className="empty-inline">No {names[kind]} in this selection.</p>}
      <ServerPager result={page.result} page={page.page} onPageChange={page.setPage} disabled={page.loading} label={names[kind]} targetRef={target}
        alwaysVisible onPageSizeChange={onPageSizeChange}/></>}
  </section>;
}

export function BusinessReportPanel({ session, days, organizationIds, venueIds, timezone, ownOnly, revision, onUnauthorized, onEvents }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mix, setMix] = useState('offerings');
  const [exporting, setExporting] = useState(false);
  const query = useMemo(() => reportQuery({ days, organizationIds, venueIds, timezone }), [days, organizationIds, venueIds, timezone]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api(`/business/reports/summary?${query}`, session, { signal: controller.signal })
      .then(setSummary)
      .catch((err) => { if (err.name === 'AbortError') return; if (err.status === 401) onUnauthorized(); else setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session, query, revision, retry, onUnauthorized]);
  const slices = mix === 'offerings' ? summary?.offerings?.map((row) => ({ id: `${row.kind}:${row.label}`, name: row.label, salesCents: row.salesCents, units: row.units }))
    : summary?.eventMix?.map((row) => ({ id: row.id, name: row.label, salesCents: row.salesCents,
      orders: row.orders, dateLabel: row.startsAt ? eventDateLabel({ startsAt: row.startsAt, location: { timezone: row.venueTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } }) : null }));
  return <div className="business-report-panel">
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">SALES MIX</span><h2>What drives the room</h2><p>Paid face value, including every filtered sale. Small categories are grouped as Other.</p></div>
      <Button variant="outline" disabled={exporting} onClick={async () => { setExporting(true); setError(''); try { await downloadBusinessReport(session, query); } catch (err) { if (err.name !== 'AbortError') setError(err.message); } finally { setExporting(false); } }}><ArrowDownToLine size={16}/>{exporting ? 'Preparing…' : 'Export full report'}</Button></div>
      {loading && <LoadingState>Loading sales mix…</LoadingState>}
      {error && <div className="error" role="alert">{error}<Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div>}
      <div className="sales-mix-content"><Tabs value={mix} onValueChange={setMix}><TabsList><TabsTrigger value="offerings">Tickets & packages</TabsTrigger><TabsTrigger value="events">Events</TabsTrigger></TabsList></Tabs>
      {slices?.length ? <><SalesMixPie slices={slices}/><SalesMixRankBars rows={slices} totalSales={summary.summary.salesCents}/></> : !loading && <p className="empty-inline">Sales will appear here after your first paid order.</p>}
      {summary && <p className="hint">{ownOnly ? 'Only sales attributed to you.' : `Direct sales ${money(summary.summary.directSalesCents)} · recorded commissions ${money(summary.summary.commissionCents)}.`} Export includes every row, not just this preview.</p>}</div>
    </section>
    <BusinessTeamPerformance session={session} query={query} totalSales={summary?.summary?.salesCents || 0}
      directSalesCents={summary?.summary?.directSalesCents || 0} summaryReady={Boolean(summary)} revision={revision} onUnauthorized={onUnauthorized}
      onEvents={onEvents}/>
  </div>;
}
