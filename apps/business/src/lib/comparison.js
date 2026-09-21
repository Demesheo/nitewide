import { checkoutFeeCents } from "../../../customer/src/lib/checkout-fees.js";

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

export const comparisonColumns = [
  "Nitewide",
  "Posh",
  "Discotech",
  "Tabler",
  "Sections",
];
// Unknown is deliberately not rendered as a missing feature or a zero-dollar fee.
export const comparisonRows = [
  {
    label: "Standard paid-sale fee",
    cells: [
      "7.5% + $0.79 / order to customer; Stripe paid by organizer · planned",
      "10% + $0.99 / ticket, processing included [1]",
      "No universal rate verified; ticket providers vary [4]",
      "Commission shown during booking; no fixed rate in terms [5]",
      "No fixed rate found in reviewed official sources [7, 8]",
    ],
  },
  {
    label: "Who pays standard checkout fees?",
    cells: [
      "Customer pays Nitewide fee; organizer pays Stripe · planned",
      "Buyer-paid fees supported [2]",
      "Confirm with venue / ticket provider [4]",
      "Fees deducted from host payments under terms [5]",
      "Not verified [8]",
    ],
  },
  {
    label: "Business subscription",
    cells: [
      "$0 Free; optional Premium $249/month · planned",
      "No required subscription stated in reviewed pricing [1]",
      "Not verified",
      "Not verified",
      "Not verified",
    ],
  },
  {
    label: "Custom event / ticket setup",
    cells: [
      "Flyer + custom ticket/package tiers · demo",
      "Flyers + ticket tiers [2]",
      "Tickets through event-specific providers [4]",
      "Host event details + joining price [6]",
      "Event creation, tables + ticket options [7]",
    ],
  },
  {
    label: "Independent venue + promoter guestlist caps",
    cells: [
      "Separate capacity pools + approval · demo",
      "Exact allocation model not verified",
      "Exact allocation model not verified",
      "Join requests; separate pools not verified [6]",
      "Guestlists; separate pools not verified [7]",
    ],
  },
  {
    label: "Sales reporting by event / offering / person",
    cells: [
      "All three + CSV exports · demo",
      "Ticket/team tracking documented; exact parity not verified [3]",
      "Not verified",
      "Not verified",
      "Host insights; exact report breakdown not verified [7]",
    ],
  },
  {
    label: "Business operations focus",
    cells: [
      "Role-aware organization & independent-creator workspace · demo",
      "Organizer and event-team tools [2, 3]",
      "Nightlife discovery and booking",
      "Private cost-sharing; business use excluded in published terms [5]",
      "Host tools; commercial use requires authorization [7, 8]",
    ],
  },
  {
    label: "Live payment processing",
    planned: true,
    cells: [
      "Upcoming; checkout currently mocked",
      "Available [1]",
      "Ticket providers handle purchases [4]",
      "Stripe Connect [5]",
      "Stripe [8]",
    ],
  },
  {
    label: "Connected payouts & refund operations",
    planned: true,
    cells: [
      "Upcoming · Stripe Connect; timing subject to eligibility and cleared funds",
      "Payouts and organizer refund tools [1, 10]",
      "Confirm with booking / ticket provider [4]",
      "Stripe Connect; payments no earlier than 24 hours after event under terms [5]",
      "Payout, withdrawal and refund tools described [7]",
    ],
  },
  {
    label: "Dedicated QR door check-in interface",
    planned: true,
    cells: [
      "Upcoming · admission validation and audit trail",
      "Exact scanner workflow not verified in reviewed sources",
      "Not verified",
      "Not verified",
      "Check-in and QR feedback described [7]",
    ],
  },
  {
    label: "Email / SMS reminders & approval alerts",
    planned: true,
    cells: [
      "Upcoming · reminders, approval requests/results and sold-out alerts",
      "SMS campaigns and event-change alerts; exact trigger parity not verified [10]",
      "Exact trigger coverage not verified",
      "Exact trigger coverage not verified",
      "SMS event requests/status/updates; exact trigger parity not verified [8]",
    ],
  },
  {
    label: "Consent-based CRM & marketing outreach",
    planned: true,
    cells: [
      "Upcoming · Premium customer tools and opt-in campaigns",
      "Attendee data and organization SMS campaigns [10]",
      "Not verified",
      "Not verified",
      "Opt-in promotional SMS; full CRM not verified [8]",
    ],
  },
  {
    label: "Advanced analytics & promoter ROI",
    planned: true,
    cells: [
      "Upcoming · Premium multidimensional reports and ROI tools",
      "Expanded organizer analytics; exact ROI parity not verified [10]",
      "Not verified",
      "Not verified",
      "Host insights; advanced ROI parity not verified [7]",
    ],
  },
  {
    label: "Dispute evidence & audit workflows",
    planned: true,
    cells: [
      "Upcoming · payment-linked admission evidence; no guaranteed dispute outcome",
      "Exact evidence workflow not verified",
      "Not verified",
      "Support reviews event complaints; payment-dispute evidence not verified [6]",
      "Not verified",
    ],
  },
];

export function comparePosh({ ticketPrice, quantity, orders }) {
  if (
    !Number.isFinite(ticketPrice) ||
    ticketPrice < 0.01 ||
    ticketPrice > 10000 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 100 ||
    !Number.isInteger(orders) ||
    orders < 1 ||
    orders > 100000
  )
    return null;
  const unitCents = Math.round(ticketPrice * 100);
  if (unitCents < 1) return null;
  const subtotalCents = unitCents * quantity;
  const platformCents = checkoutFeeCents(subtotalCents);
  const nitewideTotalCents = subtotalCents + platformCents;
  const processingCents = 0; // No separate customer processing surcharge.
  const organizerProcessingCents = Math.round(nitewideTotalCents * 0.029) + 30;
  const poshFeeCents = (Math.round(unitCents * 0.1) + 99) * quantity;
  const poshTotalCents = subtotalCents + poshFeeCents;
  const savingsCents = poshTotalCents - nitewideTotalCents;
  return {
    subtotalCents,
    platformCents,
    processingCents,
    organizerProcessingCents,
    organizerNetCents: subtotalCents - organizerProcessingCents,
    nitewideTotalCents,
    poshFeeCents,
    poshTotalCents,
    savingsCents,
    aggregateSavingsCents: savingsCents * orders,
  };
}
