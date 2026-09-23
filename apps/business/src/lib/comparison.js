import pricing from '@nitewide/pricing';
export { matrixColumns, matrixRows } from './feature-matrix.js';
export const comparisonSources = [
  {
    name: "Posh pricing",
    url: "https://university.posh.vip/university/post/event-marketplaces-where-posh-fits-and-where-it-does-not",
  },
  {
    name: "Posh event tools",
    url: "https://support.posh.vip/en/articles/15089963-creating-customizing-and-managing-your-posh-events-the-complete-guide",
  },
  { name: "Posh team reporting", url: "https://docs.posh.vip/event-team" },
  {
    name: "Discotech ticket-provider example",
    url: "https://app.discotech.me/events/38196137-michigander-at-rebel-lounge",
  },
  {
    name: "Tabler terms",
    url: "https://www.tablerapp.com/terms-and-conditions",
  },
  { name: "Tabler features", url: "https://www.tablerapp.com/faq" },
  {
    name: "Sections features",
    url: "https://apps.apple.com/us/app/sections-tables-events/id6755155921",
  },
  { name: "Sections terms", url: "https://www.sectionsapp.com/terms" },
  { name: "Stripe US processing", url: "https://stripe.com/pricing" },
  {
    name: "Posh dashboard & messaging",
    url: "https://support.posh.vip/en/articles/15091892-understanding-the-posh-workspace-menu-organizer-vs-attendee-controls",
  },
];


export function comparePosh({ ticketPrice, quantity, orders }) {
  if (!Number.isFinite(ticketPrice) || ticketPrice < .01 || ticketPrice > 10000 ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 100 ||
      !Number.isInteger(orders) || orders < 1 || orders > 100000) return null;
  const unitPriceCents = Math.round(ticketPrice * 100);
  const q = pricing.quoteOrder({ items: [{ unitPriceCents, quantity }] });
  const poshFeeCents = (Math.round(unitPriceCents * .1) + 99) * quantity;
  const eventbriteServiceCents = (Math.round(unitPriceCents * .037) + 179) * quantity;
  const eventbriteProcessingCents = Math.round((q.subtotalCents + eventbriteServiceCents) * .029);
  const poshTotalCents = q.subtotalCents + poshFeeCents;
  const eventbriteTotalCents = q.subtotalCents + eventbriteServiceCents + eventbriteProcessingCents;
  const savingsCents = q.eligible ? poshTotalCents - q.totalCents : null;
  // Public calculator deliberately omits internal margin/cost/net fields.
  return { ...pricing.publicQuote(q), platformCents: q.feeCents,
    nitewideTotalCents: q.totalCents, organizerNetCents: q.eligible ? q.subtotalCents : null,
    poshOrganizerNetCents: q.subtotalCents, eventbriteOrganizerNetCents: q.subtotalCents,
    poshFeeCents, poshTotalCents, eventbriteServiceCents, eventbriteProcessingCents,
    eventbriteTotalCents, savingsCents,
    eventbriteSavingsCents: q.eligible ? eventbriteTotalCents - q.totalCents : null,
    aggregateSavingsCents: q.eligible ? savingsCents * orders : null };
}
