export function hasMultipleRegions(data) {
  return (data?.options?.regions?.length || 0) > 1;
}

export function explorerView(data, path = []) {
  const byId = new Map(data.hierarchy.map((row) => [row.id, row]));
  const multipleRegions = hasMultipleRegions(data);
  const rootId = multipleRegions ? 'all' : (data.children.all?.[0] || 'all');
  const parentId = path.at(-1) || rootId;
  const parentLevel = byId.get(parentId)?.level;
  const level = parentLevel === 'event' ? 'customer' : parentLevel === 'entity' ? 'event' : parentLevel === 'region' ? 'entity' : multipleRegions ? 'region' : 'entity';
  const rows = (data.children[parentId] || []).map((id) => byId.get(id)).filter(Boolean);
  return { byId, rootId, parentId, level, rows, multipleRegions };
}

export function sortExplorerRows(rows, key = 'salesCents', descending = true) {
  return [...rows].sort((a, b) => {
    const first = a[key] ?? (typeof a[key] === 'number' ? 0 : '');
    const second = b[key] ?? (typeof b[key] === 'number' ? 0 : '');
    const comparison = typeof first === 'number' && typeof second === 'number' ? first - second : String(first).localeCompare(String(second));
    return (descending ? -comparison : comparison) || a.label.localeCompare(b.label);
  });
}
