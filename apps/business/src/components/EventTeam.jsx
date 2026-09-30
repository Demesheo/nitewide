import { useRef, useState } from 'react';
import { usePagedResource } from '@/hooks/usePagedResource';
import { EventPeople } from './EventDetail';
import { SalesMixPie } from './SalesMixPie';
import { LoadingState } from './LoadingState';
import { Button } from './ui/button';
import { ServerPager } from './ServerPager';
import { Empty } from './controls';

export function EventTeam({ event, scope, session, onUnauthorized, onSaved, refreshToken = 0, teamSales = [] }) {
  const panel = useRef(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('salesCents');
  const [descending, setDescending] = useState(true);
  const [roles, setRoles] = useState([]);
  const [revision, setRevision] = useState(0);
  const params = new URLSearchParams({ search, sortKey: sort, descending: String(descending) });
  roles.forEach((role) => params.append('roles', role));
  const people = usePagedResource('/business/events/' + event.id + '/people-page?' + params, session, { onUnauthorized, refreshToken: refreshToken + ':' + revision, pageSize: 10 });
  return <>{scope !== 'own' && <section className="panel event-team-sales-mix" aria-label="Sales by team member"><div className="event-team-sales-heading"><h3>Sales by team member</h3><p>Ticket and package sales before fees, including direct purchases.</p></div>{teamSales.length ? <SalesMixPie slices={teamSales}/> : <Empty title="No sales yet">Team and direct sales will appear after the first purchase.</Empty>}</section>}
    <section ref={panel} className="panel">
      {people.loading && <LoadingState>Loading team…</LoadingState>}
      {people.error && <div className="error" role="alert">{people.error}<Button variant="outline" onClick={people.retry}>Try again</Button></div>}
      <EventPeople data={{ event, scope, people: people.result?.items || [], candidates: (people.result?.items || []).filter((person) => person.isCurrentMember) }} session={session} onUnauthorized={onUnauthorized}
        onSaved={(message) => { setRevision((value) => value + 1); onSaved?.(message); }}
        remote={{ search, onSearch: setSearch, sort, descending, onSort: (key, down) => { setSort(key); setDescending(down); }, roles, onRoles: setRoles, roleOptions: ['Owner','Manager','Employee','Promoter','Creator'].map((role) => ({ id: role, label: role })) }}/>
      <ServerPager result={people.result} page={people.page} onPageChange={people.setPage} disabled={people.loading} label="people" targetRef={panel}/>
    </section></>;
}
