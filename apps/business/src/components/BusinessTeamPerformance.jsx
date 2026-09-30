import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ChevronRight, Search } from 'lucide-react';
import { money } from '@/lib/business';
import { usePagedResource } from '@/hooks/usePagedResource';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { MultiSelect } from './MultiSelect';
import { MobileTableSort } from './MobileTableSort';
import { ServerPager } from './ServerPager';
import { LoadingState } from './LoadingState';
import { ReportTableSurface } from './ReportTableSurface';
import { readWorkspaceLocation, writeWorkspaceLocation } from '@/lib/workspace-navigation';
import { downloadBusinessReport } from '@/lib/report-client';
import { AnalyticsReportHeader } from './AnalyticsReportHeader';

const roleOptions = ['Owner', 'Manager', 'Employee', 'Promoter', 'Creator'].map((role) => ({ id: role, label: `${role}s` }));
const columns = [
  ['name', 'Name', 'name_asc', 'name_desc'],
  ['role', 'Role', 'role_asc', 'role_desc'],
  ['sales', 'Attributed sales', 'sales_asc', 'sales_desc'],
  ['orders', 'Paid orders', 'orders_asc', 'orders_desc'],
  ['guestlist', 'Guestlist places', 'guestlist_asc', 'guestlist_desc'],
  ['commission', 'Commission', 'commission_asc', 'commission_desc'],
  ['contribution', 'Contribution', 'contribution_asc', 'contribution_desc'],
];

function PersonName({ name }) {
  const [first, ...last] = (name || 'Unnamed member').split(' ');
  return <div className="person"><span className="avatar" aria-hidden="true">{(name || '').split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><strong className="performance-name"><span>{first}</span>{last.length > 0 && <> <span>{last.join(' ')}</span></>}</strong></div>;
}

export function BusinessTeamPerformance({ session, query, totalSales, directSalesCents, revision, onUnauthorized, onEvents,
  onPerson, locationScope = 'overview', summaryReady = true, toolbar, eventsLabel = 'Manage your events' }) {
  const analyticsView = locationScope === 'analytics';
  const panelRef = useRef(null);
  const [initial] = useState(readWorkspaceLocation);
  const field = locationScope === 'analytics' ? 'reportTeam' : 'overviewTeam';
  const [roles, setRoles] = useState(initial[`${field}Roles`]);
  const [search, setSearch] = useState(initial[`${field}Search`]);
  const [sortKey, setSortKey] = useState(initial[`${field}Sort`].split('_')[0]);
  const [descending, setDescending] = useState(initial[`${field}Sort`].endsWith('_desc'));
  const [urlPage, setUrlPage] = useState(initial[`${field}Page`]);
  const [pageSize, setPageSize] = useState(initial[`${field}PageSize`]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const showPersonSearch = !analyticsView || !toolbar;
  useEffect(() => { const restore = () => { const state = readWorkspaceLocation();
    setRoles(state[`${field}Roles`]); setSearch(state[`${field}Search`]);
    setSortKey(state[`${field}Sort`].split('_')[0]); setDescending(state[`${field}Sort`].endsWith('_desc'));
    setUrlPage(state[`${field}Page`]); setPageSize(state[`${field}PageSize`]);
  }; window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, [field]);
  const chooseRoles = (next) => { setRoles(next); setUrlPage(1);
    writeWorkspaceLocation({ [`${field}Roles`]: next, [`${field}Page`]: 1 }); };
  const chooseSearch = (next) => { setSearch(next); setUrlPage(1);
    writeWorkspaceLocation({ [`${field}Search`]: next, [`${field}Page`]: 1 }, { replace: true }); };
  const chooseSort = (key, down) => { setSortKey(key); setDescending(down); setUrlPage(1);
    const column = columns.find(([value]) => value === key);
    writeWorkspaceLocation({ [`${field}Sort`]: column[down ? 3 : 2], [`${field}Page`]: 1 }); };
  const filterQuery = useMemo(() => {
    if (query == null) return null;
    const params = new URLSearchParams(query);
    if (showPersonSearch && search.trim()) params.set('personSearch', search.trim());
    roles.forEach((role) => params.append('roles', role));
    const selected = columns.find(([key]) => key === sortKey);
    params.set('sort', selected[descending ? 3 : 2]);
    return params.toString();
  }, [query, roles, search, showPersonSearch, sortKey, descending]);
  const page = usePagedResource(filterQuery == null ? null : `/business/reports/team?${filterQuery}`, session,
    { pageSize, initialPage: urlPage, onPageChange: (value) => { setUrlPage(value); writeWorkspaceLocation({ [`${field}Page`]: value }); },
      refreshToken: revision, onUnauthorized });
  const changeSort = (key) => {
    chooseSort(key, sortKey === key ? !descending : !['name', 'role'].includes(key));
  };
  const exportRows = async () => {
    if (!filterQuery || exporting) return;
    const params = new URLSearchParams(filterQuery);
    params.set('exportTable', 'team');
    setExporting(true); setExportError('');
    try { await downloadBusinessReport(session, params.toString()); }
    catch (error) { if (error.status === 401) onUnauthorized?.(); else if (error.name !== 'AbortError') setExportError(error.message); }
    finally { setExporting(false); }
  };
  const exportButton = <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!filterQuery || exporting} onClick={exportRows}>
    <ArrowDownToLine size={15}/>{exporting ? 'Preparing…' : 'Export CSV'}</Button>;
  const roleFilter = <MultiSelect label="Roles" options={roleOptions} selected={roles} onChange={chooseRoles}/>;
  const head = (key, label) => <th key={key} scope="col"><button type="button" className="analytics-sort" onClick={() => changeSort(key)}>
    {label}<span aria-hidden="true">{sortKey === key ? descending ? ' ↓' : ' ↑' : ' ↕'}</span>
  </button></th>;
  return <section ref={panelRef} className="panel team-performance-panel" aria-busy={filterQuery != null && page.loading}>
    {analyticsView ? <AnalyticsReportHeader title="Team" description="Sales by referral" action={exportButton}/>
      : <div className="section-heading analytics-report-header"><div><span className="eyebrow">PEOPLE MAKE IT HAPPEN</span><h2>Team performance</h2></div>
        {exportButton}<p>Sales credited to referral codes—not the person who created the event.</p></div>}
    <div className="px-5 pb-3">{roleFilter}</div>
    {exportError && <div className="error" role="alert">{exportError}</div>}
    {toolbar}
    {showPersonSearch && <div className="table-search"><div className="search-field"><Search size={16} aria-hidden="true"/>
      <Input aria-label="Search team performance" placeholder="Search" value={search} onChange={(event) => chooseSearch(event.target.value)}/></div></div>}
    {filterQuery != null && page.loading && <LoadingState>{page.result ? 'Updating team performance…' : 'Loading team performance…'}</LoadingState>}
    {filterQuery != null && page.error && <div className="error" role="alert">{page.error}<Button variant="outline" onClick={page.retry}>Try again</Button></div>}
    {filterQuery != null && page.result && <><ReportTableSurface label="Team performance" className="performance-desktop-table"><thead><tr>{head('name', 'Name')}{head('role', 'Role')}{head('sales', 'Attributed sales')}{head('orders', 'Paid orders')}{head('guestlist', 'Guestlist places')}{head('commission', 'Commission')}{head('contribution', 'Contribution')}</tr></thead>
      <tbody>{page.result.items.map((person) => <tr key={person.id} className={onPerson ? 'cursor-pointer hover:bg-accent/50' : ''}
        onClick={onPerson ? () => onPerson(person.id, person.label) : undefined}><td>{onPerson ? <button type="button" className="analytics-drill" onClick={(event) => { event.stopPropagation(); onPerson(person.id, person.label); }}><PersonName name={person.label}/><ChevronRight size={13}/></button> : <PersonName name={person.label}/>}</td><td><Badge variant="outline">{person.role}</Badge></td>
        <td className="numeric">{money(person.salesCents)}</td><td>{person.orders}</td><td>{person.guestlistPlaces}<small className="block text-muted-foreground">{person.approvedGuestlistPlaces} approved</small></td>
        <td>{person.commissionCents == null ? '—' : money(person.commissionCents)}</td><td><div className="contribution"><span style={{ width: `${summaryReady && totalSales ? person.salesCents / totalSales * 100 : 0}%` }}/></div><small>{summaryReady ? `${totalSales ? Math.round(person.salesCents / totalSales * 100) : 0}% of sales` : '—'}</small></td></tr>)}</tbody></ReportTableSurface>
      <ReportTableSurface label="Team performance" className="performance-mobile-table"><thead><tr>{head('name', 'Name')}{head('role', 'Role')}{head('sales', 'Sales')}{head('orders', 'Orders')}{head('guestlist', 'Guestlist places')}{head('commission', 'Commission')}{head('contribution', 'Contribution')}</tr></thead>
        <tbody>{page.result.items.map((person) => <tr key={person.id} className={onPerson ? 'cursor-pointer hover:bg-accent/50' : ''}
          onClick={onPerson ? () => onPerson(person.id, person.label) : undefined}><td>{onPerson ? <button type="button" className="analytics-drill" onClick={(event) => { event.stopPropagation(); onPerson(person.id, person.label); }}><PersonName name={person.label}/><ChevronRight size={13}/></button> : <PersonName name={person.label}/>}</td><td><Badge variant="outline">{person.role}</Badge></td>
          <td className="numeric">{money(person.salesCents)}</td><td>{person.orders}</td><td>{person.guestlistPlaces}<small className="block text-muted-foreground">{person.approvedGuestlistPlaces} approved</small></td>
          <td>{person.commissionCents == null ? '—' : money(person.commissionCents)}</td><td><div className="contribution"><span style={{ width: `${summaryReady && totalSales ? person.salesCents / totalSales * 100 : 0}%` }}/></div><small>{summaryReady ? `${totalSales ? Math.round(person.salesCents / totalSales * 100) : 0}% of sales` : '—'}</small></td></tr>)}</tbody></ReportTableSurface>
      {!page.result.items.length && <p className="empty-inline">No team members match this view.</p>}
      <ServerPager result={page.result} page={page.page} onPageChange={page.setPage} disabled={page.loading} label="team members" targetRef={panelRef}
        alwaysVisible onPageSizeChange={(size) => { setPageSize(size); setUrlPage(1); writeWorkspaceLocation({ [`${field}PageSize`]: size, [`${field}Page`]: 1 }); }}/></>}
    <div className="panel-footer"><span>Direct / unattributed sales <strong>{summaryReady ? money(directSalesCents || 0) : '—'}</strong></span>
      <Button variant="ghost" size="sm" onClick={onEvents}>{eventsLabel}<ArrowRight size={16}/></Button></div>
  </section>;
}
