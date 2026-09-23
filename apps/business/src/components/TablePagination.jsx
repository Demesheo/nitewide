import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PAGE_SIZES, paginate } from '@/lib/pagination';

export function useTablePagination(rows, resetToken, levelToken) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => setPage(1), [resetToken, levelToken]);
  const result = paginate(rows, page, pageSize);
  return { ...result, pageSize, setPage, setPageSize: (value) => { setPageSize(value); setPage(1); } };
}

export function TablePagination({ pager, onPageChange }) {
  const paginationRef = useRef(null);
  const changePage = (page) => {
    pager.setPage(page);
    if (onPageChange) return onPageChange();
    requestAnimationFrame(() => {
      const card = paginationRef.current?.closest('section');
      if (!card) return;
      window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 76), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  };
  return <div ref={paginationRef} className="table-pagination"><span>{pager.from}–{pager.to} of {pager.total}</span><label>Rows per page <select aria-label="Rows per page" value={pager.pageSize} onChange={(event) => pager.setPageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label><div className="table-pagination-actions"><Button type="button" variant="outline" size="sm" disabled={pager.currentPage <= 1} onClick={() => changePage(pager.currentPage - 1)}>Previous</Button><span>Page {pager.currentPage} of {pager.pages}</span><Button type="button" variant="outline" size="sm" disabled={pager.currentPage >= pager.pages} onClick={() => changePage(pager.currentPage + 1)}>Next</Button></div></div>;
}
