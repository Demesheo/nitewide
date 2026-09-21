export const PAGE_SIZES = [10, 25, 50];

export function paginateRecords(rows, page = 1, pageSize = 10) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pages);
  const start = (currentPage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), pages, currentPage, total: rows.length, from: rows.length ? start + 1 : 0, to: Math.min(rows.length, start + pageSize) };
}

export function sortRecords(rows, value, descending = false) {
  return [...rows].sort((a, b) => {
    const first = value(a) ?? '';
    const second = value(b) ?? '';
    const compared = typeof first === 'number' && typeof second === 'number' ? first - second : String(first).localeCompare(String(second), undefined, { sensitivity: 'base', numeric: true });
    return descending ? -compared : compared;
  });
}
