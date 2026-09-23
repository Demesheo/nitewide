import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { TablePagination, useTablePagination } from './TablePagination';
import { sortTableRows } from '@/lib/table-sort';
import { Empty } from './controls';
import { MobileTableSort } from './MobileTableSort';

export function EventTable({ rows, columns, defaultSort = 'name', defaultDescending = false, empty = 'No matching records', emptyDescription = 'Records appear here as activity is recorded for this event.', onSelect, selectRow = false, searchable = true }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(defaultSort);
  const [descending, setDescending] = useState(defaultDescending);
  const filtered = rows.filter((row) => [row.name, row.email, row.role, row.kind, row.status].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()));
  const sorted = sortTableRows(filtered, sort, descending);
  const pager = useTablePagination(sorted, rows, `${sort}:${descending}:${search}`);
  return <>{searchable && <div className="toolbar"><div className="search-field"><Search size={16}/><Input aria-label="Search table" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)}/></div></div>}
    {filtered.length ? <><MobileTableSort columns={columns} value={sort} descending={descending} onChange={(key) => { setSort(key); setDescending(Boolean(columns.find(c => c.key === key)?.numeric)); }} onToggle={() => setDescending(!descending)}/><div className="table-wrap responsive-event-table"><table><thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.className || ''} aria-sort={sort === c.key ? descending ? "descending" : "ascending" : "none"}><button type="button" className="analytics-sort" onClick={() => { setDescending(sort === c.key ? !descending : Boolean(c.numeric)); setSort(c.key); }}>{c.label}<span aria-hidden="true">{sort === c.key ? descending ? ' ↓' : ' ↑' : ' ↕'}</span></button></th>)}</tr></thead><tbody>{pager.rows.map((row) => <tr key={row.id || row.userId || row.name} className={selectRow && onSelect ? 'event-selectable-row' : undefined} onClick={selectRow && onSelect ? (e) => { if (!e.target.closest('button, a, input, select, textarea')) onSelect(row); } : undefined}>{columns.map((c, i) => <td key={c.key} data-label={c.label} className={[c.className, c.numeric ? 'numeric' : ''].filter(Boolean).join(' ')}>{i === 0 && onSelect ? <button className="event-text-link" onClick={() => onSelect(row)}>{c.render ? c.render(row) : row[c.key]}</button> : c.render ? c.render(row) : row[c.key]}</td>)}</tr>)}</tbody></table></div><TablePagination pager={pager}/></> : <Empty title={empty}>{emptyDescription}</Empty>}
  </>;
}
