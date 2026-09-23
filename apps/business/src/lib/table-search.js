export function searchRows(rows, query, fields) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return rows;
  return rows.filter((row) => fields.some((field) => String(row[field] ?? '').toLocaleLowerCase().includes(term)));
}
