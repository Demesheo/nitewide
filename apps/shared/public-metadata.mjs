import pricing from '@nitewide/pricing';
import { publicPath } from './public-links.mjs';

export const plainText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
export function publicImage(value, origin) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value, origin); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}
const iso = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
export function eventOffers(event, url, now = new Date()) {
  return (event.offerings || []).flatMap(offer => {
    const quantity = offer.minPerOrder || 1;
    if (offer.isActive === false || (offer.visibility && offer.visibility !== 'public') || offer.saleState !== 'on_sale'
      || (offer.salesStartAt && new Date(offer.salesStartAt) > now) || (offer.salesEndAt && new Date(offer.salesEndAt) < now)
      || quantity > (offer.maxPerOrder || 10) || (offer.inventoryMode === 'finite' && offer.quantityTotal - offer.quantitySold < quantity)) return [];
    const quote = pricing.quoteOrder({ items: [{ unitPriceCents: offer.priceCents, quantity,
      feeMode: offer.effectiveFeeMode || pricing.effectiveFeeMode(event.feeMode || 'buyer', offer.feeMode || 'inherit') }], currency: offer.currency });
    if (!quote.eligible) return [];
    return [{ '@type': 'Offer', name: `${plainText(offer.name)}${quantity > 1 ? ` — order of ${quantity}` : ''}`,
      price: (quote.totalCents / 100).toFixed(2), priceCurrency: offer.currency || 'USD',
      availability: 'https://schema.org/InStock', url, ...(iso(offer.salesStartAt) ? { validFrom: iso(offer.salesStartAt) } : {}) }];
  });
}
export function publicMetadata({ origin, imageOrigin = origin, kind = 'home', event, profile, items = [], id, indexable = true, now }) {
  const home = new URL('/', origin).toString(), fallbackImage = new URL('/images/nitewide-social-nightlife-v1.png', imageOrigin).toString();
  let title = 'Nitewide — Find your night', description = 'Discover upcoming events, tickets, VIP packages and guestlists. Find your next night on Nitewide.',
    canonical = home, image = fallbackImage, structured = [];
  if (kind === 'event' && event) {
    canonical = new URL(publicPath('events', event.id), origin).toString();
    const place = [event.location?.name, event.location?.city, event.location?.region].filter(Boolean).join(', ');
    title = `${plainText(event.title)}${event.location?.city ? ` in ${plainText(event.location.city)}` : ''} | Nitewide`;
    description = plainText(event.summary || event.description || `Explore ${event.title}${place ? ` at ${place}` : ''}. View event details, tickets and guestlist options.`).slice(0, 240);
    image = publicImage(event.imageUrl, origin) || fallbackImage;
    const loc = event.location, startDate = iso(event.startsAt), endDate = iso(event.endsAt);
    // Hidden attendee addresses must never become structured data. Events
    // without a complete public physical location still get ordinary metadata.
    if (indexable && loc?.privacy === 'public' && loc.addressLine1 && loc.city && loc.region && loc.countryCode && startDate && endDate) {
      const offers = eventOffers(event, canonical, now);
      structured = [{ '@context': 'https://schema.org', '@type': 'Event', name: plainText(event.title), description, url: canonical,
        startDate, endDate, eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        image: [image], location: { '@type': 'Place', name: plainText(loc.name || loc.city), address: { '@type': 'PostalAddress',
          streetAddress: plainText([loc.addressLine1, loc.addressLine2].filter(Boolean).join(' ')), addressLocality: plainText(loc.city),
          addressRegion: plainText(loc.region), addressCountry: loc.countryCode, ...(loc.postalCode ? { postalCode: loc.postalCode } : {}) } },
        ...(event.organization?.name ? { organizer: { '@type': 'Organization', name: plainText(event.organization.name) } } : {}),
        ...(offers.length ? { offers } : {}) }];
    }
  } else if (kind === 'rundown' && profile) {
    canonical = new URL(publicPath('rundowns', id), origin).toString();
    title = `${plainText(profile.name)}’s Rundown | Nitewide`;
    description = `Explore ${plainText(profile.name)}’s upcoming events, tickets and guestlists on one page.`;
    image = publicImage(items[0]?.imageUrl, origin) || fallbackImage;
    structured = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, url: canonical,
      mainEntity: { '@type': 'ItemList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1,
        name: plainText(item.title), url: new URL(publicPath('events', item.id), origin).toString() })) } }];
  } else if (kind === 'business') {
    title = 'Nitewide for Business — Events, tickets & guestlists';
    description = 'Publish events, sell tickets and packages, manage guestlists and your team, and explore sales reports with Nitewide for Business.';
    canonical = new URL(origin).toString();
  } else if (kind === 'privacy') {
    title = 'Privacy Policy | Nitewide'; description = 'Learn how Nitewide collects, uses and protects personal information.';
    canonical = new URL('/privacy', origin).toString();
  } else if (kind === 'home') {
    structured = [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Nitewide', url: home, description }];
  } else if (kind === 'private') {
    title = 'Your account | Nitewide'; description = 'Manage your Nitewide account.'; canonical = null;
  } else if (kind === 'unavailable') {
    title = 'Page unavailable | Nitewide'; description = 'This page is not available.'; canonical = null;
  }
  return { title, description, canonical, image, robots: indexable ? 'index, follow' : 'noindex, nofollow, noarchive', structured: indexable ? structured : [] };
}
