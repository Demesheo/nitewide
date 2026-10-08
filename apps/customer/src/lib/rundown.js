export const RUNDOWN_PAGE_SIZE = 6;

export function rundownIdKey(value) {
  return typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
    ? value.toLowerCase() : '';
}

export function rundownPagePath(id, cursor = null) {
  const key = rundownIdKey(id);
  if (!key) return null;
  const params = new URLSearchParams({ pageSize: String(RUNDOWN_PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  return `/rundowns/${encodeURIComponent(key)}?${params}`;
}

export function rundownPreviewPath(preview, cursor = null) {
  if (!['personal', 'business'].includes(preview?.kind)) return null;
  const organizationId = rundownIdKey(preview.organizationId);
  if (preview.kind === 'business' && !organizationId) return null;
  if (preview.kind === 'personal' && preview.organizationId != null) return null;
  const params = new URLSearchParams({ kind: preview.kind, pageSize: String(RUNDOWN_PAGE_SIZE) });
  if (preview.kind === 'business') params.set('organizationId', organizationId);
  if (cursor) params.set('cursor', cursor);
  return `/customer/rundowns/preview?${params}`;
}

export function rundownProfileName(profile) {
  if (typeof profile?.name !== 'string') return '';
  return profile.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

export function prepareRundownPage(data) {
  const name = rundownProfileName(data?.profile);
  if (!name || !['personal', 'business'].includes(data?.profile?.kind)
    || !Array.isArray(data.items) || data.items.length > RUNDOWN_PAGE_SIZE
    || typeof data.hasMore !== 'boolean'
    || (data.hasMore && (typeof data.nextCursor !== 'string' || !data.nextCursor))) {
    throw new Error('Invalid rundown page');
  }
  const items = data.items.map(event => {
    if (!event || typeof event.id !== 'string' || !event.id || typeof event.title !== 'string') {
      throw new Error('Invalid rundown event');
    }
    return { ...event, offerings: Array.isArray(event.offerings) ? event.offerings : [],
      referralCode: typeof event.referralCode === 'string' && event.referralCode ? event.referralCode : null };
  });
  return { profile: { kind: data.profile.kind, name }, items: appendRundownEvents([], items),
    hasMore: data.hasMore, nextCursor: data.hasMore ? data.nextCursor : null };
}

export function appendRundownEvents(previous, incoming) {
  const seen = new Set(previous.map(event => event.id));
  const appended = [...previous];
  for (const event of incoming) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    appended.push(event);
  }
  return appended;
}
