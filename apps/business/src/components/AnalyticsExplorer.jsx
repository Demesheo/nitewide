import { Fragment, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TablePagination, useTablePagination } from '@/components/TablePagination';
import { money } from '@/lib/business';
import { explorerView, hasMultipleRegions, sortExplorerRows } from '@/lib/analytics-explorer';

const levelNames = { region: 'Regions', entity: 'Venues & creators', event: 'Events', customer: 'Customers' };
const firstColumn = { region: 'Region', entity: 'Venue / creator', event: 'Event', customer: 'Customer' };
const emptyText = { region: 'No locations in this selection.', entity: 'No venues or creators in this selection.', event: 'No events in this selection.', customer: 'No paid customers for this event and date range.' };
const eventColors = ['#b9a9ff', '#fe6ef0', '#0446ef', '#f10393', '#8b85c5', '#8b0535'];

function SortHead({ label, value, sortKey, descending, onSort }) {
  return <th scope="col"><button type="button" className="analytics-sort" onClick={() => onSort(value)} aria-label={`Sort by ${label}${sortKey === value ? (descending ? ', descending' : ', ascending') : ''}`}>{label}<span aria-hidden="true">{sortKey === value ? (descending ? ' ↓' : ' ↑') : ' ↕'}</span></button></th>;
}

export function ContributionChart({ data }) {
  const multipleRegions = hasMultipleRegions(data);
  const type = multipleRegions ? 'region' : 'event';
  const rows = data.hierarchy.filter((row) => row.level === type && row.salesCents > 0).sort((a, b) => b.salesCents - a.salesCents).slice(0, 6);
  return <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">{multipleRegions ? 'Regional contribution' : 'Top events'}</h3><p className="mb-4 text-xs text-muted-foreground">{multipleRegions ? 'Selected sales by event location' : 'Highest face-value sales in this selection'}</p>{rows.length ? <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical"><CartesianGrid horizontal={false} stroke="#353040"/><XAxis type="number" tickFormatter={(value) => `$${Math.round(value / 100)}`} tick={{ fill: '#a5a5b8', fontSize: 10 }}/><YAxis dataKey="label" type="category" width={135} tickFormatter={(value) => value.length > 18 ? `${value.slice(0, 17)}…` : value} tick={{ fill: '#c4b8d6', fontSize: 10 }}/><Tooltip formatter={(value) => money(value)} contentStyle={{ background: '#20202c', border: '1px solid #3b394d', borderRadius: 12 }}/><Bar dataKey="salesCents" radius={[0, 4, 4, 0]} isAnimationActive={false}>{rows.map((row, index) => <Cell key={row.id} fill={eventColors[index % eventColors.length]}/>)}</Bar></BarChart></ResponsiveContainer></div> : <p className="py-16 text-center text-sm text-muted-foreground">No paid sales in this period.</p>}</section>;
}

export function ExplorerTable({ data }) {
  const [path, setPath] = useState([]);
  const [sortKey, setSortKey] = useState('salesCents');
  const [descending, setDescending] = useState(true);
  useEffect(() => setPath([]), [data]);
  const { byId, level, rows, multipleRegions } = explorerView(data, path);
  const visible = sortExplorerRows(rows, sortKey, descending);
  const pager = useTablePagination(visible, data, `${level}:${path.join('/')}:${sortKey}:${descending}`);
  const sort = (key) => { if (sortKey === key) setDescending(!descending); else { setSortKey(key); setDescending(key !== 'label'); } };
  return <section className="rounded-xl border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div><span className="eyebrow">EXPLORE PERFORMANCE</span><h3 className="text-lg font-semibold">{levelNames[level]}</h3><p className="text-xs text-muted-foreground">{level === 'customer' ? 'Customers with paid orders for this event. Use this information for order operations only.' : 'Select a row to see the next level.'}</p></div>
      {path.length > 0 && <Button variant="outline" size="sm" onClick={() => setPath(path.slice(0, -1))}><ArrowLeft size={14}/> Back</Button>}
    </div>
    <nav aria-label="Report drill-down" className="border-y border-border">
      {multipleRegions && <Button variant="ghost" size="sm" onClick={() => setPath([])}>All regions</Button>}
      {path.map((id, index) => <Fragment key={id}>
        {(multipleRegions || index > 0) && <span className="report-trail-separator" aria-hidden="true"><ChevronRight size={13}/></span>}
        <Button variant="ghost" size="sm" onClick={() => setPath(path.slice(0, index + 1))}>{byId.get(id)?.label}</Button>
      </Fragment>)}
    </nav>
    <div className="table-wrap"><table><thead><tr><SortHead label={firstColumn[level]} value="label" sortKey={sortKey} descending={descending} onSort={sort}/>{(level === 'region' || level === 'entity') && <SortHead label="Events" value="events" sortKey={sortKey} descending={descending} onSort={sort}/>}<SortHead label="Paid orders" value="orders" sortKey={sortKey} descending={descending} onSort={sort}/><SortHead label="Sales value" value="salesCents" sortKey={sortKey} descending={descending} onSort={sort}/>{level !== 'customer' && <SortHead label="Customers" value="customers" sortKey={sortKey} descending={descending} onSort={sort}/>}<SortHead label="Units" value="units" sortKey={sortKey} descending={descending} onSort={sort}/><SortHead label="Admissions" value="admissions" sortKey={sortKey} descending={descending} onSort={sort}/><SortHead label="Avg. order" value="averageOrderCents" sortKey={sortKey} descending={descending} onSort={sort}/></tr></thead><tbody>{pager.rows.map((row) => <tr key={row.id} className={row.level === 'customer' ? '' : 'cursor-pointer hover:bg-accent/50'} onClick={() => row.level !== 'customer' && setPath([...path, row.id])}><td>{row.level === 'customer' ? <strong>{row.label}</strong> : <button type="button" className="analytics-drill" onClick={(event) => { event.stopPropagation(); setPath([...path, row.id]); }}>{row.label}<ChevronRight size={13}/></button>}{row.email && <small className="block text-muted-foreground">{row.email}</small>}{row.kind && <small className="block text-muted-foreground">{row.kind === 'creator' ? 'Independent creator' : 'Organization'}</small>}{row.level === 'event' && row.status && <small className="block text-muted-foreground">{row.status}</small>}</td>{(level === 'region' || level === 'entity') && <td>{row.events}</td>}<td>{row.orders}</td><td>{money(row.salesCents)}</td>{level !== 'customer' && <td>{row.customers}</td>}<td>{row.units}</td><td>{row.admissions}</td><td>{money(row.averageOrderCents)}</td></tr>)}</tbody></table></div>
    {!visible.length && <p className="p-7 text-center text-sm text-muted-foreground">{emptyText[level]}</p>}
    <TablePagination pager={pager}/>
  </section>;
}
