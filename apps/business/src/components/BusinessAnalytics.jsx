import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/business';
import { reportQuery } from '@/lib/report-client';
import { eventReportTime } from '@/lib/report-time';
import { readWorkspaceLocation, writeWorkspaceLocation } from '@/lib/workspace-navigation';
import { BusinessReportTable } from './BusinessReportTables';
import { AnalyticsReportNavigation } from './AnalyticsReportNavigation';
import { BusinessTeamPerformance } from './BusinessTeamPerformance';
import { MultiSelect } from './MultiSelect';
import { Visuals } from './Analytics';
import { LoadingState } from './LoadingState';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { PersonalActivityTable } from './PersonalActivityTable';

const tableChoices = [['regions', 'Regions'], ['venues', 'Venues'], ['events', 'Events'], ['offerings', 'Tickets & packages'], ['team', 'Team & direct sales'], ['customers', 'Customers']];
const sortChoices = [['sales_desc', 'Sales high–low'], ['sales_asc', 'Sales low–high'], ['name_asc', 'Name A–Z'], ['name_desc', 'Name Z–A'],
  ['orders_desc', 'Orders high–low'], ['orders_asc', 'Orders low–high']];

const sortFieldsByTable = {
  regions: ['sales', 'name', 'orders', 'events', 'customers', 'units', 'checkins', 'average'],
  venues: ['sales', 'name', 'orders', 'events', 'customers', 'units', 'checkins', 'average'],
  events: ['sales', 'name', 'orders', 'starts', 'customers', 'units', 'checkins', 'average'],
  offerings: ['sales', 'name', 'orders', 'units'], customers: ['sales', 'name', 'orders', 'units'],
  team: ['sales', 'name', 'role', 'orders', 'guestlist', 'commission', 'contribution'],
};
const tableSort = (kind, value) => sortFieldsByTable[kind].includes(value.replace(/_(asc|desc)$/, '')) ? value : 'sales_desc';
const sameIds = (left, right) => left.length === right.length && left.every((id) => right.includes(id));
const reportDates = (state) => {
  if (state.reportPeriod === 'custom') return { startDate: state.reportStart, endDate: state.reportEnd };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: state.reportTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  const endDate = `${parts.year}-${parts.month}-${parts.day}`;
  const startDate = new Date(Date.parse(`${endDate}T00:00:00.000Z`) - (Number(state.reportPeriod) - 1) * 86400000).toISOString().slice(0, 10);
  return { startDate, endDate };
};

export function BusinessAnalytics({ session, ownOnly = false, organizations = [], venues = [], canCreateIndependent = false, onEvent, onUnauthorized }) {
  const [initial] = useState(readWorkspaceLocation);
  const [initialDates] = useState(() => reportDates(initial));
  const [period, setPeriod] = useState(initial.reportPeriod);
  const [startDate, setStartDate] = useState(initialDates.startDate);
  const [endDate, setEndDate] = useState(initialDates.endDate);
  const [organizationIds, setOrganizationIds] = useState(initial.organizationIds);
  const [venueIds, setVenueIds] = useState(initial.venueIds);
  const [region, setRegion] = useState(initial.reportRegion);
  const [regions, setRegions] = useState(initial.reportRegions);
  const [search, setSearch] = useState(initial.reportSearch);
  const [draftSearch, setDraftSearch] = useState(initial.reportSearch);
  const [sort, setSort] = useState(initial.reportSort);
  const [table, setTable] = useState(initial.reportTable);
  const [reportEvent, setReportEvent] = useState(initial.reportEvent);
  const [eventHint, setEventHint] = useState(null);
  const [reportPerson, setReportPerson] = useState(initial.reportPerson);
  const [personHint, setPersonHint] = useState(null);
  const [reportOfferingKind, setReportOfferingKind] = useState(initial.reportOfferingKind);
  const [reportOfferingName, setReportOfferingName] = useState(initial.reportOfferingName);
  const eventHeading = useRef(null);
  const [reportPage, setReportPage] = useState(initial.reportPage);
  const [reportPageSize, setReportPageSize] = useState(initial.reportPageSize);
  const [timezone, setTimezone] = useState(initial.reportTimezone);
  const [summary, setSummary] = useState(null);
  const [resolvedSummaryQuery, setResolvedSummaryQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const ready = period !== 'custom' || Boolean(startDate && endDate && startDate <= endDate);
  useEffect(() => { const restore = () => { const state = readWorkspaceLocation();
    const dates = reportDates(state);
    setPeriod(state.reportPeriod); setStartDate(dates.startDate); setEndDate(dates.endDate);
    setOrganizationIds(state.organizationIds); setVenueIds(state.venueIds); setRegion(state.reportRegion); setRegions(state.reportRegions);
    setSearch(state.reportSearch); setDraftSearch(state.reportSearch); setSort(state.reportSort); setTable(state.reportTable);
    setReportEvent(state.reportEvent); setEventHint(null);
    setReportPerson(state.reportPerson); setPersonHint(null);
    setReportOfferingKind(state.reportOfferingKind); setReportOfferingName(state.reportOfferingName);
    setReportPage(state.reportPage); setReportPageSize(state.reportPageSize); setTimezone(state.reportTimezone);
  }; window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, []);
  const query = useMemo(() => ready ? reportQuery({ days: period, startDate: period === 'custom' ? startDate : '',
    endDate: period === 'custom' ? endDate : '', organizationIds, venueIds, regions: region ? [region] : regions,
    search, sort: 'sales_desc', timezone, eventId: reportEvent, personId: reportPerson,
    offeringKind: reportOfferingKind, offeringName: reportOfferingName }) : null,
  [ready, period, startDate, endDate, organizationIds, venueIds, region, regions, search, timezone, reportEvent,
    reportPerson, reportOfferingKind, reportOfferingName]);
  useEffect(() => {
    if (!query) { setLoading(false); setError(''); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = setTimeout(() => api(`/business/reports/summary?${query}`, session, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setSummary(data); setResolvedSummaryQuery(query); } })
      .catch((err) => { if (controller.signal.aborted || err.name === 'AbortError') return;
        if (err.status === 401) onUnauthorized(); else setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); }), 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [session, query, retry, onUnauthorized]);
  useEffect(() => { if (reportEvent) eventHeading.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }, [reportEvent]);
  const changeTable = (value) => { const nextSort = tableSort(value, sort);
    const clearRegion = value === 'regions';
    const clearVenues = value === 'regions' || value === 'venues';
    const clearEvent = ['regions', 'venues', 'events'].includes(value);
    const clearPerson = ['regions', 'venues', 'events', 'team'].includes(value);
    const clearOffering = value !== 'customers';
    if (table === value && (!clearRegion || !region) && (!clearVenues || !venueIds.length) && (!clearEvent || !reportEvent)
      && (!clearPerson || !reportPerson) && (!clearOffering || !(reportOfferingKind || reportOfferingName))) return;
    if (clearRegion) setRegion('');
    if (clearVenues) setVenueIds([]);
    if (clearEvent) { setReportEvent(''); setEventHint(null); }
    if (clearPerson) { setReportPerson(''); setPersonHint(null); }
    if (clearOffering) { setReportOfferingKind(''); setReportOfferingName(''); }
    setTable(value); setSort(nextSort); setReportPage(1);
    writeWorkspaceLocation({ reportTable: value, reportSort: nextSort, reportPage: 1, reportTeamPage: 1,
      ...(clearRegion ? { reportRegion: null } : {}), ...(clearVenues ? { venueIds: [] } : {}),
      ...(clearEvent ? { reportEvent: null } : {}), ...(clearPerson ? { reportPerson: null } : {}),
      ...(clearOffering ? { reportOfferingKind: null, reportOfferingName: null } : {}) }); };
  const chooseRegion = (value) => { if (region === value && !venueIds.length && !reportEvent && table === 'venues') return;
    setRegion(value); setVenueIds([]); setTable('venues'); setReportPage(1); setReportEvent(''); setEventHint(null);
    setReportPerson(''); setPersonHint(null); setReportOfferingKind(''); setReportOfferingName('');
    writeWorkspaceLocation({ reportRegion: value, venueIds: [], reportEvent: null, reportPerson: null,
      reportOfferingKind: null, reportOfferingName: null, reportTable: 'venues', reportPage: 1 }); };
  const chooseVenue = (value) => { if (sameIds(venueIds, [value]) && !reportEvent && table === 'events') return;
    const nextSort = tableSort('events', sort); setVenueIds([value]); setTable('events'); setSort(nextSort); setReportPage(1); setReportEvent(''); setEventHint(null);
    setReportPerson(''); setPersonHint(null); setReportOfferingKind(''); setReportOfferingName('');
    writeWorkspaceLocation({ venueIds: [value], reportEvent: null, reportPerson: null,
      reportOfferingKind: null, reportOfferingName: null, reportTable: 'events', reportSort: nextSort, reportPage: 1 }); };
  const chooseEvent = (id, label = '', startsAt, venueTimezone) => { if (!id || (reportEvent === id && table === 'offerings')) return; const nextSort = tableSort('offerings', sort);
    setReportEvent(id); setEventHint({ label, startsAt, venueTimezone }); setTable('offerings'); setSort(nextSort); setReportPage(1);
    setReportPerson(''); setPersonHint(null); setReportOfferingKind(''); setReportOfferingName('');
    writeWorkspaceLocation({ reportEvent: id, reportPerson: null, reportOfferingKind: null,
      reportOfferingName: null, reportTable: 'offerings', reportSort: nextSort, reportPage: 1, reportTeamPage: 1 }); };
  const choosePerson = (id, label = '') => { if (!id || (reportPerson === id && !reportOfferingKind && table === 'offerings')) return;
    const nextSort = tableSort('offerings', sort); setReportPerson(id); setPersonHint({ label });
    setReportOfferingKind(''); setReportOfferingName(''); setTable('offerings'); setSort(nextSort); setReportPage(1);
    writeWorkspaceLocation({ reportPerson: id, reportOfferingKind: null, reportOfferingName: null,
      reportTable: 'offerings', reportSort: nextSort, reportPage: 1 }); };
  const chooseOffering = (kind, name) => { if (!kind || !name || (reportOfferingKind === kind && reportOfferingName === name && table === 'customers')) return;
    const nextSort = tableSort('customers', sort); setReportOfferingKind(kind); setReportOfferingName(name);
    setTable('customers'); setSort(nextSort); setReportPage(1);
    writeWorkspaceLocation({ reportOfferingKind: kind, reportOfferingName: name,
      reportTable: 'customers', reportSort: nextSort, reportPage: 1 }); };
  const backToEvents = () => changeTable('events');
  const backToEventOfferings = () => { if (!reportPerson && !reportOfferingKind && table === 'offerings') return;
    const nextSort = tableSort('offerings', sort); setReportPerson(''); setPersonHint(null);
    setReportOfferingKind(''); setReportOfferingName(''); setTable('offerings'); setSort(nextSort); setReportPage(1);
    writeWorkspaceLocation({ reportPerson: null, reportOfferingKind: null, reportOfferingName: null,
      reportTable: 'offerings', reportSort: nextSort, reportPage: 1 }); };
  const update = (key, value, setter, { replace = false } = {}) => { setter(value); setReportPage(1);
    writeWorkspaceLocation({ [key]: value, reportPage: 1 }, { replace }); };
  const updateDate = (key, value, setter) => { if (period === 'custom' && (key === 'reportStart' ? startDate : endDate) === value) return;
    setter(value); setPeriod('custom'); setReportPage(1);
    writeWorkspaceLocation({ reportPeriod: 'custom', reportStart: key === 'reportStart' ? value : startDate,
      reportEnd: key === 'reportEnd' ? value : endDate, reportPage: 1, reportTeamPage: 1 }); };
  const submitSearch = (event) => { event.preventDefault(); const value = draftSearch.trim();
    const showEvents = !ownOnly && Boolean(value) && (table === 'regions' || table === 'venues');
    const nextSort = showEvents ? tableSort('events', sort) : sort;
    if (search === value && !showEvents) return;
    setDraftSearch(value); setSearch(value); setReportPage(1);
    if (showEvents) { setTable('events'); setSort(nextSort); }
    writeWorkspaceLocation({ reportSearch: value, reportTable: showEvents ? 'events' : table,
      reportSort: nextSort, reportPage: 1, reportTeamPage: 1 }); };
  const s = summary?.summary;
  const summaryCurrent = Boolean(summary && query && resolvedSummaryQuery === query);
  const previousSummary = Boolean(summary && !summaryCurrent);
  const eventDetails = (summaryCurrent && (summary?.event?.id === reportEvent ? summary.event : null))
    || (summaryCurrent && summary?.eventMix?.find((row) => row.id === reportEvent)) || eventHint;
  const personDetails = (summaryCurrent && summary?.person?.id === reportPerson ? summary.person : null) || personHint;
  const normalizedSort = tableSort(table, sort);
  const tableQuery = new URLSearchParams(query || '');
  tableQuery.set('sort', normalizedSort);
  const regionOptions = [...new Set(venues.map((venue) => [venue.location?.city, venue.location?.region, venue.location?.countryCode].filter(Boolean).join(', ')).filter(Boolean))].sort();
  const rootTable = ownOnly ? 'events' : regionOptions.length > 1 ? 'regions' : 'venues';
  const selectedRegions = region ? [region] : regions;
  const regionLabel = selectedRegions.join(' · ');
  const venueLabel = venueIds.map((id) => venues.find((item) => item.id === id)?.label || 'Unavailable venue').join(' · ');
  const breadcrumbs = [];
  if (ownOnly) {
    if (reportEvent) breadcrumbs.push({ label: 'Events', actionLabel: 'Back to event reports', onClick: backToEvents });
  } else {
    const rootIsAncestor = reportEvent || reportPerson || reportOfferingKind || table === 'events' || (rootTable === 'regions' && table === 'venues')
      || (table === 'team' && Boolean(regionLabel || venueLabel));
    if (rootIsAncestor) breadcrumbs.push({ label: rootTable === 'regions' ? 'Regions' : 'Venues',
      actionLabel: rootTable === 'regions' ? 'Back to regions' : 'Back to venues', onClick: () => changeTable(rootTable) });
    if (regionLabel && table !== 'regions') breadcrumbs.push({ label: regionLabel,
      actionLabel: `Back to venues in ${regionLabel}`, onClick: table === 'venues' ? null : () => changeTable('venues') });
    if (rootTable === 'regions' && (venueLabel || (regionLabel && (table === 'events' || reportEvent)))) breadcrumbs.push({
      label: 'Venues', actionLabel: 'Back to venue reports', onClick: () => changeTable('venues') });
    if (venueLabel && !['regions', 'venues'].includes(table)) breadcrumbs.push({ label: venueLabel,
      actionLabel: `Back to events for ${venueLabel}`, onClick: table === 'events' ? null : () => changeTable('events') });
    if (reportEvent) breadcrumbs.push({ label: 'Events', actionLabel: 'Back to event reports', onClick: backToEvents });
  }
  if (reportEvent) breadcrumbs.push({ label: eventDetails?.label || 'Selected event', wrap: true,
    current: !reportPerson && !reportOfferingKind, onClick: reportPerson || reportOfferingKind ? backToEventOfferings : null,
    actionLabel: 'Back to event purchases',
    date: eventDetails?.startsAt ? eventReportTime(eventDetails) : null });
  if (reportPerson) {
    breadcrumbs.push({ label: 'Team', actionLabel: 'Back to team reports', onClick: () => changeTable('team') });
    breadcrumbs.push({ label: personDetails?.label || 'Selected team member', wrap: true, current: !reportOfferingKind,
      actionLabel: 'Back to team member purchases', onClick: reportOfferingKind ? () => changeTable('offerings') : null });
  }
  if (reportOfferingKind || reportOfferingName) {
    breadcrumbs.push({ label: 'Tickets & packages', actionLabel: 'Back to purchases', onClick: () => changeTable('offerings') });
    breadcrumbs.push({ label: reportOfferingName || 'Selected purchase', wrap: true, current: true });
  }
  const categoryChoices = reportOfferingKind || reportOfferingName || reportPerson
    ? [['offerings', 'Tickets & packages'], ['customers', 'Customers']]
    : reportEvent
    ? [['offerings', 'Tickets & packages'], ['team', 'Team'], ['customers', 'Customers']]
    : ownOnly ? [] : [...(rootTable === 'regions' ? [['regions', 'Regions']] : []),
      ['venues', 'Venues'], ['events', 'Events'], ['team', 'Team']];
  const categories = categoryChoices.map(([id, label]) => ({ id, label, active: table === id,
    onClick: () => changeTable(id) }));
  const visuals = summary && { ...summary, options: { regions: regionOptions }, hierarchy: regionOptions.length > 1 ? summary.regionalMix || [] : summary.eventMix.map((row) => ({ ...row, level: 'event' })) };
  const hasScopeFilters = (!ownOnly && regionOptions.length > 1) || (organizations.length + Number(canCreateIndependent)) > 1 || venues.length > 1;
  const filters = hasScopeFilters && <div className="analytics-filters flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4" aria-label="Analytics scope filters">
      {!ownOnly && regionOptions.length > 1 && <MultiSelect label="Regions" options={regionOptions.map((id) => ({ id, label: id }))} selected={region ? [region] : regions} onChange={(ids) => { if (sameIds(ids, region ? [region] : regions)) return;
        const nextSort = tableSort('regions', sort);
        setRegions(ids); setRegion(''); setVenueIds([]); setReportEvent(''); setEventHint(null); setReportPerson(''); setPersonHint(null);
        setReportOfferingKind(''); setReportOfferingName(''); setTable('regions'); setSort(nextSort); setReportPage(1);
        writeWorkspaceLocation({ reportRegions: ids, reportRegion: null, venueIds: [], reportEvent: null, reportPerson: null,
          reportOfferingKind: null, reportOfferingName: null, reportTable: 'regions', reportSort: nextSort, reportPage: 1, reportTeamPage: 1 }); }}/>}
      {(organizations.length + Number(canCreateIndependent)) > 1 && <MultiSelect label="Organizations" options={[...(canCreateIndependent ? [{ id: 'independent', label: 'Independent events' }] : []), ...organizations.map((row) => ({ id: row.id, label: row.name }))]} selected={organizationIds}
        onChange={(value) => { if (sameIds(value, organizationIds)) return;
          const resetDetail = Boolean(reportEvent || reportPerson || reportOfferingKind || reportOfferingName);
          const nextSort = resetDetail ? tableSort('events', sort) : sort;
          setOrganizationIds(value); setVenueIds([]); setReportEvent(''); setEventHint(null); setReportPerson(''); setPersonHint(null);
          setReportOfferingKind(''); setReportOfferingName(''); setReportPage(1);
          if (resetDetail) { setTable('events'); setSort(nextSort); }
          writeWorkspaceLocation({ organizationIds: value, venueIds: [], reportEvent: null, reportPerson: null,
            reportOfferingKind: null, reportOfferingName: null, reportTable: resetDetail ? 'events' : table,
            reportSort: nextSort, reportPage: 1, reportTeamPage: 1 }); }}/>}
      {venues.length > 1 && <MultiSelect label="Venues" options={venues.filter((row) => !organizationIds.length || organizationIds.includes(row.organizationId))} selected={venueIds}
        onChange={(value) => { if (sameIds(value, venueIds)) return;
          const resetDetail = Boolean(reportEvent || reportPerson || reportOfferingKind || reportOfferingName);
          const nextSort = resetDetail ? tableSort('events', sort) : sort;
          setVenueIds(value); setReportEvent(''); setEventHint(null); setReportPerson(''); setPersonHint(null);
          setReportOfferingKind(''); setReportOfferingName(''); setReportPage(1);
          if (resetDetail) { setTable('events'); setSort(nextSort); }
          writeWorkspaceLocation({ venueIds: value, reportEvent: null, reportPerson: null,
            reportOfferingKind: null, reportOfferingName: null, reportTable: resetDetail ? 'events' : table,
            reportSort: nextSort, reportPage: 1, reportTeamPage: 1 }); }}/>}
    </div>;
  const tableControls = <div className="analytics-table-controls flex flex-wrap items-end gap-3 border-t border-border px-5 py-4" aria-label="Analytics table controls">
      <AnalyticsReportNavigation breadcrumbs={breadcrumbs} categories={categories} navigationRef={eventHeading}/>
      <label className="text-xs text-muted-foreground">Start date<Input className="mt-1" type="date" value={startDate} max={endDate || undefined} onChange={(event) => updateDate('reportStart', event.target.value, setStartDate)}/></label>
      <label className="text-xs text-muted-foreground">End date<Input className="mt-1" type="date" value={endDate} min={startDate || undefined} onChange={(event) => updateDate('reportEnd', event.target.value, setEndDate)}/></label>
      <form className="analytics-search-form flex min-w-0 flex-1 items-center gap-2" onSubmit={submitSearch} role="search">
        <label className="analytics-search relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-3 text-muted-foreground"/><Input className="pl-9" aria-label="Search business analytics" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search"/></label>
        <Button type="submit">Search</Button>
      </form>
      {!ready && <p role="status" className="hint basis-full">Choose both dates in order to load a custom paid-order report.</p>}
    </div>;
  return <div className="business-analytics space-y-5">
    {filters}
    {reportEvent && summaryCurrent && 'event' in summary && !summary.event && <p className="empty-inline" role="status">This event is not available in the current selection.</p>}
    {reportPerson && summaryCurrent && 'person' in summary && !summary.person && <p className="empty-inline" role="status">This team member is not available in the current selection.</p>}
    {error && <div className="error" role="alert">{error}<Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div>}
    {!summary && query && !error && <LoadingState>Loading analytics…</LoadingState>}
    {summaryCurrent && loading && <LoadingState>Updating analytics…</LoadingState>}
    {s && <div className="relative" aria-busy={Boolean(query && (loading || (previousSummary && !error)))}>
      <div className={previousSummary ? 'pointer-events-none opacity-40' : ''}>
        <div className="analytics-metrics grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[[ownOnly ? 'Your referred sales' : 'Face-value sales',money(s.salesCents),ownOnly ? 'Before customer fees' : 'Paid subtotals, USD'],[ownOnly ? 'Your paid orders' : 'Paid orders',s.orders.toLocaleString(),s.checkedIn + ' / ' + (s.admissions + s.guestlistPlaces) + ' admitted'],[ownOnly ? 'Your customers' : 'Unique customers',s.customers.toLocaleString(),ownOnly ? 'Only your attributed buyers' : 'Within this selection'],[ownOnly ? 'Your average order' : 'Average order',money(s.averageOrderCents),'Before customer fees']].map(([label,value,detail]) => <div className="rounded-xl border border-border bg-card p-5" key={label}><small className="text-muted-foreground">{label}</small><strong className="mt-2 block text-2xl">{value}</strong><small className="text-muted-foreground">{detail}</small></div>)}</div>
        <Visuals data={visuals}/>
      </div>
      {previousSummary && <div className="absolute inset-0 z-10 flex items-start justify-center rounded-xl bg-background/30 p-4">
        <div className="rounded-lg border border-border bg-card px-4 shadow-lg">
          {error ? <p className="py-3 text-sm" role="status">Previous report · Update failed. Try again.</p>
            : query ? <LoadingState>Updating analytics… Previous report shown.</LoadingState>
              : <p className="py-3 text-sm" role="status">Previous report · Choose both dates to update.</p>}
        </div>
      </div>}
    </div>}
      {ownOnly && !reportEvent && !reportPerson && !reportOfferingKind && !reportOfferingName ? <><section className="panel"><div className="section-heading"><div><h3>Your sales by event</h3><p>Only purchases credited to you are counted.</p></div></div>{tableControls}{ready && s && <PersonalActivityTable session={session} query={query} onUnauthorized={onUnauthorized} onEvent={chooseEvent} columns={[{key:'name',label:'Event'},{key:'orders',label:'Paid orders',numeric:true},{key:'customers',label:'Customers',numeric:true},{key:'salesCents',label:'Sales',numeric:true,render:(row)=>money(row.salesCents)}]}/>}</section>
        {ready && s && <section className="panel"><div className="section-heading"><div><h3>Your referred customers</h3><p>Customer details are for order operations only, not marketing without consent.</p></div></div><PersonalActivityTable kind="customers" session={session} query={query} onUnauthorized={onUnauthorized} columns={[{key:'name',label:'Customer',render:(row)=><><strong>{row.name}</strong><small className="block text-muted-foreground">{row.email}</small></>},{key:'orders',label:'Paid orders',numeric:true},{key:'salesCents',label:'Sales',numeric:true,render:(row)=>money(row.salesCents)},{key:'units',label:'Units',numeric:true}]}/></section>}</>
        : table === 'team' ? <BusinessTeamPerformance key={query} session={session} query={query} totalSales={summaryCurrent && s ? s.salesCents : 0}
        directSalesCents={summaryCurrent && s ? s.directSalesCents : 0} summaryReady={summaryCurrent} onUnauthorized={onUnauthorized} onEvents={reportEvent ? backToEvents : () => onEvent?.(null)}
        eventsLabel={reportEvent ? 'Back to events' : undefined} locationScope="analytics" toolbar={tableControls} onPerson={choosePerson}/>
        : <BusinessReportTable key={table} kind={table} session={session} query={query == null ? null : tableQuery.toString()} onUnauthorized={onUnauthorized}
          onEvent={chooseEvent} onRegion={chooseRegion} onVenue={chooseVenue} onOffering={table === 'offerings' ? chooseOffering : undefined}
          initialPage={reportPage} pageSize={reportPageSize} sort={normalizedSort}
          selectedVenueTimezone={venueIds.length === 1 ? venues.find((row) => row.id === venueIds[0])?.location?.timezone : undefined} toolbar={tableControls}
          onSortChange={(value) => update('reportSort', value, setSort)}
          onPageSizeChange={(size) => { setReportPageSize(size); setReportPage(1); writeWorkspaceLocation({ reportPageSize: size, reportPage: 1 }); }}
          onPageChange={(value) => { setReportPage(value); writeWorkspaceLocation({ reportPage: value }); }}/>}
  </div>;
}
