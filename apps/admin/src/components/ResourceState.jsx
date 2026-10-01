import { Button } from './ui/button';
export function ResourceState({ loading, error, onRetry, children }) {
  if (error) return <div className="error" role="alert"><p>{error}</p><Button variant="outline" onClick={onRetry}>Retry</Button></div>;
  if (loading) return <div className="loading" role="status">Loading records…</div>;
  return children;
}
export function Pager({ result, onPage }) {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <div className="management-pagination"><Button variant="outline" disabled={result.page <= 1} onClick={() => onPage(result.page - 1)}>Previous</Button><span>Page {result.page} of {pages}</span><Button variant="outline" disabled={result.page >= pages} onClick={() => onPage(result.page + 1)}>Next</Button></div>;
}
