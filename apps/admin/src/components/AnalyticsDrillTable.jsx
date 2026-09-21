import { useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { TablePager, useTablePager } from './TablePager';
import { sortRecords } from '../lib/table-utils';
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
export default function AnalyticsDrillTable({ data, path, setPath }) {
  const [sortIndex, setSortIndex] = useState(3);
  const [descending, setDescending] = useState(true);
  const rows = new Map(data.hierarchy.map((row) => [row.id, row]));
  const parent = path.at(-1) || 'all';
  const current = (data.children[parent] || []).map((id) => rows.get(id)).filter(Boolean);
  const sorted = sortRecords(current, columns[sortIndex].value, descending);
  const pager = useTablePager(sorted, current, `${parent}:${sortIndex}:${descending}`);
  const level = parent === 'all' ? 'Regions' : rows.get(parent)?.level === 'region' ? 'Organizations & creators' : rows.get(parent)?.level === 'entity' ? 'Events' : 'Customers';
  return <Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5"><div><p className="eyebrow">DRILL-DOWN</p><h3 className="text-lg font-semibold">{level}</h3><p className="text-xs text-muted-foreground">Select a row to move from region to organization, event, and customer.</p></div>{path.length > 0 && <Button variant="outline" size="sm" onClick={() => setPath(path.slice(0, -1))}><ArrowLeft size={14}/> Back</Button>}</div><div className="flex flex-wrap gap-1 border-b border-border p-3 text-xs"><Button variant="ghost" size="sm" onClick={() => setPath([])}>All regions</Button>{path.map((id, index) => <Button key={id} variant="ghost" size="sm" onClick={() => setPath(path.slice(0, index + 1))}><ChevronRight size={12}/>{rows.get(id)?.label || id}</Button>)}</div><div className="table-wrap"><Table><TableHeader><TableRow>{columns.map((column, index) => <TableHead key={column.label}><button className="table-sort" onClick={() => { if (index === sortIndex) setDescending(!descending); else { setSortIndex(index); setDescending(index !== 0); } }}>{column.label} {index === sortIndex ? (descending ? '↓' : '↑') : '↕'}</button></TableHead>)}</TableRow></TableHeader><TableBody>{pager.rows.map((row) => <TableRow key={row.id}>{columns.map((column, index) => <TableCell key={column.label}>{index === 0 && row.level !== 'customer' ? <button className="table-drill" onClick={() => setPath([...path, row.id])}>{column.render(row)} <ChevronRight size={14}/></button> : column.render(row)}</TableCell>)}</TableRow>)}</TableBody></Table></div>{!current.length ? <p className="p-8 text-center text-sm text-muted-foreground">No matching records in this range.</p> : <TablePager pager={pager}/>}</Card>;
}
