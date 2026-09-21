import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { money } from '@/lib/business';
import { sortExplorerRows } from '@/lib/analytics-explorer';

function SortHeader({ label, field, active, descending, onSort }) {
  return <th scope="col"><button type="button" className="analytics-sort" onClick={() => onSort(field)} aria-label={`Sort by ${label}${active ? (descending ? ', descending' : ', ascending') : ''}`}>{label}<span aria-hidden="true">{active ? (descending ? ' ↓' : ' ↑') : ' ↕'}</span></button></th>;
}

export function ReferralsTable({ data }) {
  const [personId, setPersonId] = useState(null);
  const [sortKey, setSortKey] = useState('salesCents');
  const [descending, setDescending] = useState(true);
  useEffect(() => setPersonId(null), [data]);
  const person = data.referrals.people.find((row) => row.id === personId);
  const source = (person ? data.referrals.customers.filter((row) => row.personId === personId) : data.referrals.people).map((row) => ({ ...row, averageOrderCents: row.orders ? Math.round(row.salesCents / row.orders) : 0 }));
  const sorted = sortExplorerRows(source, sortKey, descending);
  const pager = useTablePagination(sorted, data, `${personId}:${sortKey}:${descending}`);
  const sort = (field) => { if (field === sortKey) setDescending(!descending); else { setSortKey(field); setDescending(field !== 'label' && field !== 'role'); } };
  const head = (label, field) => <SortHeader label={label} field={field} active={sortKey === field} descending={descending} onSort={sort}/>;
  return <section className="rounded-xl border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 p-5"><div><span className="eyebrow">TEAM & REFERRALS</span><h3 className="text-lg font-semibold">{person ? `${person.label} · referred customers` : 'Team & promoter sales'}</h3><p className="text-xs text-muted-foreground">Credited referrals only. Customer details support order operations, not marketing without consent.</p></div>{person && <Button variant="outline" size="sm" onClick={() => setPersonId(null)}><ArrowLeft size={14}/> Team</Button>}</div>
    <div className="table-wrap"><table><thead>{!person ? <tr>{head('Team member', 'label')}{head('Role', 'role')}{head('Paid orders', 'orders')}{head('Referred customers', 'customers')}{head('Sales value', 'salesCents')}{head('Units', 'units')}{head('Recorded commission', 'commissionCents')}</tr> : <tr>{head('Customer', 'label')}{head('Paid orders', 'orders')}{head('Sales value', 'salesCents')}{head('Units', 'units')}{head('Avg. order', 'averageOrderCents')}</tr>}</thead><tbody>{!person ? pager.rows.map((row) => <tr key={row.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setPersonId(row.id)}><td><button type="button" className="analytics-drill" onClick={(event) => { event.stopPropagation(); setPersonId(row.id); }}>{row.label}<ChevronRight size={13}/></button></td><td>{row.role}</td><td>{row.orders}</td><td>{row.customers}</td><td>{money(row.salesCents)}</td><td>{row.units}</td><td>{money(row.commissionCents)}</td></tr>) : pager.rows.map((row) => <tr key={row.id}><td><strong>{row.label}</strong>{row.email && <small className="block text-muted-foreground">{row.email}</small>}</td><td>{row.orders}</td><td>{money(row.salesCents)}</td><td>{row.units}</td><td>{money(row.averageOrderCents)}</td></tr>)}</tbody></table></div>
    {!source.length && <p className="p-7 text-center text-sm text-muted-foreground">{person ? 'No referred paid customers in this period.' : 'No team members with referrals in this selection.'}</p>}
    <TablePagination pager={pager}/>
  </section>;
}
