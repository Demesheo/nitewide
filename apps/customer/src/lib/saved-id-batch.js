const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uniqueSavedIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && uuid.test(id)))];
export const savedIdBatches = (ids, size) =>
  Array.from({ length: Math.ceil(ids.length / size) }, (_, index) => ids.slice(index * size, (index + 1) * size));
