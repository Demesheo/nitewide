export function salesMixSlices(rows, limit = 6) {
  const paid = rows
    .filter((row) => Number.isFinite(row.salesCents) && row.salesCents > 0)
    .sort((a, b) => b.salesCents - a.salesCents || a.name.localeCompare(b.name));
  const slices = paid.slice(0, limit).map((row) => ({ id: row.id, name: row.name, dateLabel: row.dateLabel, salesCents: row.salesCents }));
  const otherCents = paid.slice(limit).reduce((sum, row) => sum + row.salesCents, 0);
  if (otherCents) slices.push({ id: 'other', name: 'Other', salesCents: otherCents });
  return slices;
}
