import { Button } from './ui/button';

export function ServerPager({ result, page, onPageChange, disabled = false, label = 'records', targetRef,
  alwaysVisible = false, onPageSizeChange }) {
  if (!result || (!alwaysVisible && result.total <= result.pageSize)) return null;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const first = result.total ? (page - 1) * result.pageSize + 1 : 0;
  const last = Math.min(result.total, page * result.pageSize);
  const change = (next) => {
    onPageChange(next);
    requestAnimationFrame(() => targetRef?.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  };
  return <div className="table-pagination" role="group" aria-label={`Pagination for ${label}`}><span role="status">{first.toLocaleString()}–{last.toLocaleString()} of {result.total.toLocaleString()} {label}<span className="sr-only"> · Page {page} of {pages}</span></span>
    {onPageSizeChange && <label>Rows per page<select name="pageSize" aria-label="Rows per page" value={result.pageSize} disabled={disabled}
      onChange={(event) => { onPageSizeChange(Number(event.target.value)); requestAnimationFrame(() => targetRef?.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); }}>
      {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
    </select></label>}
    <div className="table-pagination-actions"><Button type="button" variant="outline" size="sm" disabled={disabled || page <= 1} onClick={() => change(page - 1)}>Previous</Button>
      <span>Page {page} of {pages}</span><Button type="button" variant="outline" size="sm" disabled={disabled || !result.hasMore} onClick={() => change(page + 1)}>Next</Button></div></div>;
}
