import { useRef, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/controls';
import { MultiSelect } from '@/components/MultiSelect';
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { Input } from '@/components/ui/input';
import { money } from '@/lib/business';
import { filterPerformancePeople, normalizePerformancePeople } from '@/lib/performance-roles';

const roleOptions = ['Owner', 'Manager', 'Employee', 'Promoter', 'Creator'].map((role) => ({ id: role, label: `${role}s` }));

function TeamRows({ people, selectedRoles, search, totalSales, resetToken, onPageChange }) {
  const [sortKey, setSortKey] = useState('salesCents');
  const [descending, setDescending] = useState(true);
  const query = search.trim().toLocaleLowerCase();
  const filtered = filterPerformancePeople(people, selectedRoles).filter((person) =>
    !query || `${person.name} ${person.role}`.toLocaleLowerCase().includes(query));
  const sorted = [...filtered].sort((a, b) => {
    const first = a[sortKey]; const second = b[sortKey];
    const result = typeof first === 'number' && typeof second === 'number' ? first - second : String(first).localeCompare(String(second));
    return (descending ? -result : result) || a.name.localeCompare(b.name);
  });
  const pager = useTablePagination(sorted, resetToken, `${selectedRoles.join(',')}:${search}:${sortKey}:${descending}`);
  const head = (label, key) => <th scope="col"><button type="button" className="analytics-sort" onClick={() => { if (sortKey === key) setDescending(!descending); else { setSortKey(key); setDescending(key !== 'name' && key !== 'role'); } }}>{label}<span aria-hidden="true">{sortKey === key ? (descending ? ' ↓' : ' ↑') : ' ↕'}</span></button></th>;
  const row = (person) => {
    const [firstName, ...lastName] = person.name.split(' ');
    const name = <td><div className="person"><span className="avatar" aria-hidden="true">{person.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><strong className="performance-name"><span>{firstName}</span>{lastName.length > 0 && <> <span>{lastName.join(' ')}</span></>}</strong></div></td>;
    const role = <td><Badge variant="outline">{person.role}</Badge></td>;
    const orders = <td>{person.orders}</td>;
    const sales = <td className="numeric">{money(person.salesCents)}</td>;
    const guestlist = <td>{person.guestlistPlaces || 0}<small className="block text-muted-foreground">{person.approvedGuestlistPlaces || 0} approved</small></td>;
    const commission = <td>{money(person.commissionCents)}</td>;
    const contribution = <td><div className="contribution"><span style={{ width: `${totalSales ? (person.salesCents / totalSales) * 100 : 0}%` }}/></div><small>{totalSales ? Math.round((person.salesCents / totalSales) * 100) : 0}% of sales</small></td>;
    return <tr key={person.id}>{name}{role}{sales}{orders}{guestlist}{commission}{contribution}</tr>;
  };
  return <><div className="table-wrap performance-desktop-table"><table><thead><tr>{head('Name', 'name')}{head('Role', 'role')}{head('Attributed sales', 'salesCents')}{head('Paid orders', 'orders')}{head('Guestlist places', 'guestlistPlaces')}{head('Commission', 'commissionCents')}{head('Contribution', 'contribution')}</tr></thead><tbody>{pager.rows.map(row)}</tbody></table></div><div className="table-wrap performance-mobile-table"><table><thead><tr>{head('Name', 'name')}{head('Role', 'role')}{head('Sales', 'salesCents')}{head('Orders', 'orders')}{head('Guestlist places', 'guestlistPlaces')}{head('Commission', 'commissionCents')}{head('Contribution', 'contribution')}</tr></thead><tbody>{pager.rows.map(row)}</tbody></table></div>{!filtered.length && <Empty title="No team members in this view">Attributed sales and guestlist activity appear when customers use referral links or codes.</Empty>}<TablePagination pager={pager} onPageChange={onPageChange}/></>;
}

export function TeamPerformanceTable({ report, summary, onEvents }) {
  const panelRef = useRef(null);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [search, setSearch] = useState('');
  const people = normalizePerformancePeople(report.people).map((person) => ({ ...person, contribution: summary.salesCents ? person.salesCents / summary.salesCents : 0 }));
  const scrollToTable = () => requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  return <section ref={panelRef} className="panel team-performance-panel"><div className="section-heading"><div><span className="eyebrow">PEOPLE MAKE IT HAPPEN</span><h2>Team & promoter performance</h2><p>Sales credited to referral codes—not the person who created the event.</p></div><MultiSelect label="Roles" options={roleOptions} selected={selectedRoles} onChange={setSelectedRoles}/></div><div className="table-search"><div className="search-field"><Search size={16} aria-hidden="true"/><Input aria-label="Search team performance" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)}/></div></div><TeamRows people={people} selectedRoles={selectedRoles} search={search} totalSales={summary.salesCents} resetToken={report.people} onPageChange={scrollToTable}/><div className="panel-footer"><span>Direct / unattributed sales <strong>{money(summary.directSalesCents)}</strong></span><Button variant="ghost" size="sm" onClick={onEvents}>Manage your events<ArrowRight/></Button></div></section>;
}
