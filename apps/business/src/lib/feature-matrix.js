// Status is evidence-based. Unknown is not a claim that a feature is absent.
export const featureHeaders = [
  { label: "Event setup", group: "current" },
  { label: "Guestlist caps", group: "current" },
  { label: "Sales reports", group: "current" },
  { label: "Team workspace", group: "current" },
  { label: "Live payments", group: "planned" },
  { label: "Payouts", group: "planned" },
  { label: "QR entry", group: "planned" },
  { label: "Email / SMS", group: "planned" },
  { label: "CRM", group: "planned" },
  { label: "ROI analytics", group: "planned" },
  { label: "Dispute tools", group: "planned" },
];
const cell = (status, note) => ({ status, note });
export const featurePlatforms = [
  {
    name: "Nitewide",
    cells: [
      cell(
        "demo",
        "Flyers and custom ticket/package tiers, available in the local demo.",
      ),
      cell(
        "demo",
        "Independent event and promoter capacity pools with approvals.",
      ),
      cell(
        "demo",
        "Event, offering and attributed-person reports with CSV export.",
      ),
      cell(
        "demo",
        "Role-aware organization and independent-creator workspace.",
      ),
      ...[
        "Live payments",
        "Connect payouts and refunds",
        "Dedicated QR door interface",
        "Reminders, approval and sold-out alerts",
        "Consent-based Premium CRM and marketing",
        "Premium multidimensional analytics and promoter ROI",
        "Payment-linked admission evidence",
      ].map((note) => cell("planned", `${note}: upcoming, not live.`)),
    ],
  },
  {
    name: "Posh",
    cells: [
      cell("yes", "Event creation and ticket tiers [2]."),
      cell(
        "unknown",
        "Exact separate venue/promoter allocation model not verified.",
      ),
      cell(
        "yes",
        "Team tracking and organizer analytics [3, 10]; exact report parity varies.",
      ),
      cell("yes", "Organizer and organization workspace [10]."),
      cell("yes", "Live payments [1]."),
      cell("yes", "Payouts and organizer refunds [1, 10]."),
      cell(
        "unknown",
        "Exact QR door workflow not verified in reviewed sources.",
      ),
      cell(
        "partial",
        "SMS campaigns and event-change alerts documented; exact email/trigger parity not verified [10].",
      ),
      cell(
        "partial",
        "Attendee data and organization SMS campaigns, not full CRM parity [10].",
      ),
      cell(
        "partial",
        "Expanded analytics; exact promoter ROI parity not verified [10].",
      ),
      cell("unknown", "Exact dispute-evidence workflow not verified."),
    ],
  },
  {
    name: "Discotech",
    cells: [
      cell("partial", "Listings may link to external ticket providers [4]."),
      cell("unknown", "Separate allocation model not verified."),
      cell("unknown", "Organizer report feature set not verified."),
      cell("unknown", "Comparable operator workspace not verified."),
      cell("partial", "Ticket purchases through providers [4]."),
      cell("partial", "Confirm payout/refund terms with ticket provider [4]."),
      ...Array.from({ length: 5 }, () =>
        cell("unknown", "Not verified in reviewed official sources."),
      ),
    ],
  },
  {
    name: "Tabler",
    cells: [
      cell(
        "yes",
        "Hosts add event details, guest quantity and joining price [6].",
      ),
      cell("unknown", "Separate venue/promoter allocation model not verified."),
      cell("unknown", "Business sales reports not verified."),
      cell(
        "no",
        "Published terms restrict the service to private entertainment and exclude business use [5].",
      ),
      cell("yes", "Stripe Connect [5]."),
      cell("yes", "Payments and cancellation/refund policies in terms [5]."),
      cell("unknown", "QR check-in interface not verified."),
      cell(
        "unknown",
        "Exact reminder/approval notification coverage not verified.",
      ),
      cell("unknown", "CRM and marketing tools not verified."),
      cell("unknown", "Advanced ROI tools not verified."),
      cell(
        "partial",
        "Support reviews event complaints; not a verified payment-dispute evidence workflow [6].",
      ),
    ],
  },
  {
    name: "Sections",
    cells: [
      cell("yes", "Event creation, ticket options and packages described [7]."),
      cell("unknown", "Exact separate allocation model not verified."),
      cell("yes", "Host insights described; exact report parity varies [7]."),
      cell(
        "partial",
        "Host tools; commercial use subject to authorization [7, 8].",
      ),
      cell("yes", "Stripe payments [8]."),
      cell("yes", "Payout and refund tools described [7]."),
      cell("yes", "Check-in and QR feedback described [7]."),
      cell(
        "partial",
        "SMS requests, status and event updates; exact email/trigger parity not verified [8].",
      ),
      cell("partial", "Opt-in promotional SMS; full CRM not verified [8]."),
      cell("unknown", "Advanced promoter ROI tools not verified."),
      cell("unknown", "Payment-dispute evidence workflow not verified."),
    ],
  },
];
