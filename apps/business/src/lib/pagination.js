export const PAGE_SIZES = [10, 25, 50];

export function paginate(rows, page = 1, pageSize = 10) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), pages);
  const start = (currentPage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, pages, currentPage, from: total ? start + 1 : 0, to: Math.min(total, start + pageSize) };
}
