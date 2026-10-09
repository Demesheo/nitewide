const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const publicId = value => uuid.test(value || '') ? value.toLowerCase() : null;
export function publicPath(kind, id) {
  const valid = publicId(id);
  if (!['events', 'rundowns'].includes(kind) || !valid) return null;
  return `/${kind}/${valid}`;
}
export function publicTarget(pathname) {
  const match = /^\/(events|rundowns)\/([^/]+)\/?$/.exec(pathname || '');
  return match && publicId(match[2]) ? { kind: match[1], id: publicId(match[2]) } : null;
}
// Path identity wins over contradictory legacy query parameters. Keep query
// context (especially referral credit) without changing old shared links.
export function publicRouteParams(search, pathname = globalThis.window?.location?.pathname) {
  const params = new URLSearchParams(search), target = publicTarget(pathname);
  if (target) params.set(target.kind === 'events' ? 'event' : 'rundown', target.id);
  return params;
}
export function eventPublicLink(id, origin, referralCode) {
  const url = new URL(publicPath('events', id) || '/', origin);
  if (!publicId(id)) url.searchParams.set('event', id);
  if (referralCode) url.searchParams.set('ref', referralCode);
  return url.toString();
}
export function eventPublicHref(id, referralCode) {
  const url = new URL(eventPublicLink(id, 'https://nitewide.invalid/', referralCode));
  return `${url.pathname}${url.search}`;
}
export const ordinaryLinkClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
