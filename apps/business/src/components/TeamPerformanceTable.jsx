import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/controls';
import { MultiSelect } from '@/components/MultiSelect';
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { money } from '@/lib/business';
import { filterPerformancePeople, normalizePerformancePeople } from '@/lib/performance-roles';

const roleOptions = ['Owner', 'Manager', 'Employee', 'Promoter'].map((role) => ({ id: role, label: `${role}s` }));

function TeamRows({ people, selectedRoles, totalSales, resetToken }) {
  const [sortKey, setSortKey] = useState('salesCents');
  const [descending, setDescending] = useState(true);
  const filtered = filterPerformancePeople(people, selectedRoles);
  const sorted = [...filtered].sort((a, b) => {
    const first = a[sortKey]; const second = b[sortKey];
    const result = typeof first === 'number' && typeof second === 'number' ? first - second : String(first).localeCompare(String(second));
    return (descending ? -result : result) || a.name.localeCompare(b.name);
  });
  const pager = useTablePagination(sorted, resetToken, `${selectedRoles.join(',')}:${sortKey}:${descending}`);
  const head = (label, key) => <th scope="col"><button type="button" className="analytics-sort" onClick={() => { if (sortKey === key) setDescending(!descending); else { setSortKey(key); setDescending(key !== 'name' && key !== 'role'); } }}>{label}<span aria-hidden="true">{sortKey === key ? (descending ? ' ↓' : ' ↑') : ' ↕'}</span></button></th>;
  return <><div className="table-wrap"><table><thead><tr>{head('Team member', 'name')}{head('Role', 'role')}{head('Paid orders', 'orders')}{head('Attributed sales', 'salesCents')}{head('Commission', 'commissionCents')}{head('Contribution', 'contribution')}</tr></thead><tbody>{pager.rows.map((person) => <tr key={person.id}><td><div className="person"><span className="avatar">{person.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><strong>{person.name}</strong></div></td><td><Badge variant="outline">{person.role}</Badge></td><td>{person.orders}</td><td className="numeric">{money(person.salesCents)}</td><td>{money(person.commissionCents)}</td><td><div className="contribution"><span style={{ width: `${totalSales ? (person.salesCents / totalSales) * 100 : 0}%` }}/></div><small>{totalSales ? Math.round((person.salesCents / totalSales) * 100) : 0}% of sales</small></td></tr>)}</tbody></table></div>{!filtered.length && <Empty title="No team members in this view">Attributed sales appear when a customer purchases through a referral code.</Empty>}<TablePagination pager={pager}/></>;
}

export function TeamPerformanceTable({ report, summary, onEvents }) {
  const [selectedRoles, setSelectedRoles] = useState([]);
  const people = normalizePerformancePeople(report.people).map((person) => ({ ...person, contribution: summary.salesCents ? person.salesCents / summary.salesCents : 0 }));
  return <section className="panel team-performance-panel"><div className="section-heading"><div><span className="eyebrow">PEOPLE MAKE IT HAPPEN</span><h2>Team & promoter performance</h2><p>Sales credited to referral codes—not the person who created the event.</p></div><MultiSelect label="Roles" options={roleOptions} selected={selectedRoles} onChange={setSelectedRoles}/></div><TeamRows people={people} selectedRoles={selectedRoles} totalSales={summary.salesCents} resetToken={report.people}/><div className="panel-footer"><span>Direct / unattributed sales <strong>{money(summary.directSalesCents)}</strong></span><Button variant="ghost" size="sm" onClick={onEvents}>Manage your events<ArrowRight/></Button></div></section>;
}
