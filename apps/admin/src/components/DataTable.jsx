import { useState } from 'react';
import { Button } from './ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { TablePager, useTablePager } from './TablePager';
import { sortRecords } from '../lib/table-utils';

export function DataTable({ columns, rows, kind, onEdit, sales = false }) {
  const salesIndex = columns.findIndex((column) => column.sales || ['Total', 'Gross sales', 'Sales value'].includes(column.label));
  const salesTable = sales || salesIndex >= 0;
  const defaultIndex = salesTable ? Math.max(0, salesIndex) : 0;
  const [sortIndex, setSortIndex] = useState(defaultIndex);
  const [descending, setDescending] = useState(salesTable);
  const active = columns[sortIndex] || columns[0];
  const sorted = sortRecords(rows, (row) => active.sortValue ? active.sortValue(row) : row[active.key || (active.label === 'Gross sales' ? 'salesCents' : undefined)], descending);
  const pager = useTablePager(sorted, rows, `${sortIndex}:${descending}`);
  if (!rows.length) return <div className="empty">No records match these filters.</div>;
  return <><div className="table-wrap"><Table><TableHeader><TableRow>{columns.map((column, index) => <TableHead key={column.label}><button type="button" className="table-sort" onClick={() => { if (sortIndex === index) setDescending(!descending); else { setSortIndex(index); setDescending(Boolean(column.sales || column.numeric)); } }}>{column.label}<span aria-hidden="true">{sortIndex === index ? (descending ? ' ↓' : ' ↑') : ' ↕'}</span></button></TableHead>)}{kind && <TableHead>Action</TableHead>}</TableRow></TableHeader><TableBody>{pager.rows.map((row) => <TableRow key={row.id}>{columns.map((column) => <TableCell key={column.label}>{column.render ? column.render(row) : row[column.key] ?? '—'}</TableCell>)}{kind && <TableCell><Button variant="outline" size="sm" className="table-action" onClick={() => onEdit(kind, row)}>Edit</Button></TableCell>}</TableRow>)}</TableBody></Table></div><TablePager pager={pager}/></>;
}
