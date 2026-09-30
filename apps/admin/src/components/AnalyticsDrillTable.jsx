import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { TablePager } from './TablePager';
import { formatMoney } from '../lib/admin';

const columns = [
  { label: 'Name', value: (row) => row.label, render: (row) => <><strong>{row.label}</strong>{row.email && <small className="block text-muted-foreground">{row.email}</small>}{row.kind && <small className="block text-muted-foreground">{row.kind}</small>}</> },
  { label: 'Events', value: (row) => row.events, render: (row) => row.events ?? '—' },
  { label: 'Sales', value: (row) => row.orders, render: (row) => row.orders },
  { label: 'Sales value', value: (row) => row.salesCents, render: (row) => formatMoney(row.salesCents) },
  { label: 'Customers', value: (row) => row.customers, render: (row) => row.customers ?? '—' },
  { label: 'Units', value: (row) => row.units, render: (row) => row.units },
  { label: 'Admissions', value: (row) => row.admissions, render: (row) => row.admissions ?? '—' },
  { label: 'Avg. order', value: (row) => row.averageOrderCents, render: (row) => formatMoney(row.averageOrderCents ?? (row.orders ? row.salesCents / row.orders : 0)) },
];

const kinds = ['regions', 'venues', 'events', 'customers'];
const titles = ['Regions', 'Venues', 'Events', 'Customers'];
const sortFields = ['name', 'events', 'orders', 'sales', 'customers', 'units', 'admissions', 'average'];
export default function AnalyticsDrillTable({ request, path, setPath }) {
  const [sortIndex, setSortIndex] = useState(3);
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const kind = kinds[path.length];
  const query = useMemo(() => {
    const params = new URLSearchParams(request);
    for (const row of path) {
      if (row.kind === 'regions') { params.delete('regions'); params.append('regions', row.label); }
      if (row.kind === 'venues') { params.delete('venueIds'); params.append('venueIds', row.id); }
      if (row.kind === 'events') params.set('eventId', row.id);
    }
    params.set('page', String(page)); params.set('pageSize', String(pageSize));
    params.set('sort', `${sortFields[sortIndex]}_${descending ? 'desc' : 'asc'}`);
    return params.toString();
  }, [request, path, page, pageSize, sortIndex, descending]);
  const key = `${kind}:${query}`;
  const current = result?.key === key ? result.data.items : [];
  const data = result?.key === key ? result.data : null;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError('');
    api(`/admin/reports/${kind}?${query}`, { signal: controller.signal }).then((value) => {
      if (active) setResult({ key, data: value });
    }).catch((err) => { if (active && err.name !== 'AbortError') setError(err.message); });
    return () => { active = false; controller.abort(); };
  }, [key, kind, query]);
  const navigate = (nextPath) => { setPath(nextPath); setPage(1); setSortIndex(3); setDescending(true); };
  const total = data?.total || 0;
  const pager = { total, from: total ? (page - 1) * pageSize + 1 : 0, to: Math.min(page * pageSize, total),
    currentPage: page, pages: Math.max(1, Math.ceil(total / pageSize)), pageSize, setPage,
    setPageSize: (value) => { setPageSize(value); setPage(1); } };
  const sortable = (index) => !(kind === 'customers' && [1, 4, 6, 7].includes(index)) && !(kind === 'events' && index === 1);
  return <Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5"><div><p className="eyebrow">DRILL-DOWN</p><h3 className="text-lg font-semibold">{titles[path.length]}</h3><p className="text-xs text-muted-foreground">Select a row to move from region to venue, event, and customer.</p></div>{path.length > 0 && <Button variant="outline" size="sm" onClick={() => navigate(path.slice(0, -1))}><ArrowLeft size={14}/> Back</Button>}</div><div className="flex flex-wrap gap-1 border-b border-border p-3 text-xs"><Button variant="ghost" size="sm" onClick={() => navigate([])}>All regions</Button>{path.map((row, index) => <Button key={row.id} variant="ghost" size="sm" onClick={() => navigate(path.slice(0, index + 1))}><ChevronRight size={12}/>{row.label}</Button>)}</div><div className="table-wrap"><Table><TableHeader><TableRow>{columns.map((column, index) => <TableHead key={column.label}><button className="table-sort" disabled={!sortable(index)} onClick={() => { setPage(1); if (index === sortIndex) setDescending(!descending); else { setSortIndex(index); setDescending(index !== 0); } }}>{column.label} {index === sortIndex ? (descending ? '↓' : '↑') : '↕'}</button></TableHead>)}</TableRow></TableHeader><TableBody>{current.map((row) => <TableRow key={row.id}>{columns.map((column, index) => <TableCell key={column.label}>{index === 0 && kind !== 'customers' ? <button className="table-drill" onClick={() => navigate([...path, { id: row.id, label: row.label, kind }])}>{column.render(row)} <ChevronRight size={14}/></button> : column.render(row)}</TableCell>)}</TableRow>)}</TableBody></Table></div>{error ? <p className="error" role="alert">{error}</p> : !data ? <p className="loading" role="status">Loading report rows…</p> : !current.length ? <p className="p-8 text-center text-sm text-muted-foreground">No matching records in this range.</p> : <TablePager pager={pager}/>}</Card>;
}
