import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { TablePagination, useTablePagination } from './TablePagination';
import { sortTableRows } from '@/lib/table-sort';
import { Empty } from './controls';
import { MobileTableSort } from './MobileTableSort';

export function EventTable({ rows, columns, defaultSort = 'name', defaultDescending = false, empty = 'No matching records', emptyDescription = 'Records appear here as activity is recorded for this event.', onSelect, onPageChange, selectRow = false, searchable = true, remote }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(defaultSort);
  const [descending, setDescending] = useState(defaultDescending);
  const filtered = remote ? rows : rows.filter((row) => [row.name, row.email, row.role, row.kind, row.status].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()));
  const sorted = remote ? rows : sortTableRows(filtered, sort, descending);
  const pager = useTablePagination(sorted, rows, `${sort}:${descending}:${search}`);
  const activeSort = remote?.sort ?? sort;
  const activeDescending = remote?.descending ?? descending;
  const chooseSort = (key, down) => { if (remote) remote.onSort(key, down); else { setSort(key); setDescending(down); } };
  const sortableColumns = columns.filter((column) => column.sortable !== false);
  return <>{filtered.length > 0 && sortableColumns.length > 0 && <MobileTableSort columns={sortableColumns} value={activeSort} descending={activeDescending} onChange={(key) => chooseSort(key, Boolean(columns.find(c => c.key === key)?.numeric))} onToggle={() => chooseSort(activeSort, !activeDescending)}/>}
    {searchable && <div className="toolbar"><div className="search-field"><Search size={16}/><Input aria-label="Search table" placeholder="Search" value={remote?.search ?? search} onChange={(e) => remote ? remote.onSearch(e.target.value) : setSearch(e.target.value)}/></div></div>}
    {filtered.length ? <><div className="table-wrap responsive-event-table"><table><thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.className || ''} aria-sort={activeSort === c.key ? activeDescending ? "descending" : "ascending" : "none"}>{c.sortable === false ? c.label : <button type="button" className="analytics-sort" onClick={() => chooseSort(c.key, activeSort === c.key ? !activeDescending : Boolean(c.numeric))}>{c.label}<span aria-hidden="true">{activeSort === c.key ? activeDescending ? ' ↓' : ' ↑' : ' ↕'}</span></button>}</th>)}</tr></thead><tbody>{(remote ? rows : pager.rows).map((row) => <tr key={row.id || row.userId || row.name} className={selectRow && onSelect ? 'event-selectable-row' : undefined} onClick={selectRow && onSelect ? (e) => { if (!e.target.closest('button, a, input, select, textarea')) onSelect(row); } : undefined}>{columns.map((c, i) => <td key={c.key} data-label={c.label} className={[c.className, c.numeric ? 'numeric' : ''].filter(Boolean).join(' ')}>{i === 0 && onSelect ? <button className="event-text-link" onClick={() => onSelect(row)}>{c.render ? c.render(row) : row[c.key]}</button> : c.render ? c.render(row) : row[c.key]}</td>)}</tr>)}</tbody></table></div>{!remote && <TablePagination pager={pager} onPageChange={onPageChange}/> }</> : <Empty title={empty}>{emptyDescription}</Empty>}
  </>;
}
