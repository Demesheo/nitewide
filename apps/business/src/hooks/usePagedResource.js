import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export function usePagedResource(path, session, { pageSize = 20, initialPage = 1, onPageChange, onUnauthorized, refreshToken = 0 } = {}) {
  const [page, setPageValue] = useState(initialPage);
  const mounted = useRef(false);
  const setPage = (value) => { setPageValue(value); onPageChange?.(value); };
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setPageValue(initialPage); setResult(null);
  }, [path]);
  useEffect(() => { setPageValue(initialPage); }, [initialPage]);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const params = new URLSearchParams(path.split('?')[1] || '');
    params.set('page', String(page)); params.set('pageSize', String(pageSize));
    setLoading(true); setError('');
    api(`${path.split('?')[0]}?${params}`, session, { signal: controller.signal })
      .then((data) => { setResult(data); const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > lastPage) { setPageValue(lastPage); onPageChange?.(lastPage); } })
      .catch((err) => { if (err.name === 'AbortError') return; if (err.status === 401) onUnauthorized?.(); else setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, page, pageSize, session, refreshToken, retry, onUnauthorized]);
  return { page, setPage, result, error, loading, retry: () => setRetry((value) => value + 1) };
}
