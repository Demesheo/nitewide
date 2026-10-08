export function hasMultipleRegions(data) {
  return (data?.options?.regions?.length || 0) > 1;
}
