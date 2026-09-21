export function sortTableRows(rows, key, descending = false) {
  return [...rows].sort((a, b) => {
    const first = a[key] ?? '';
    const second = b[key] ?? '';
    const compared = typeof first === 'number' && typeof second === 'number' ? first - second : String(first).localeCompare(String(second), undefined, { sensitivity: 'base', numeric: true });
    return (descending ? -compared : compared) || String(a.name || a.title || a.label || a.id || '').localeCompare(String(b.name || b.title || b.label || b.id || ''));
  });
}
