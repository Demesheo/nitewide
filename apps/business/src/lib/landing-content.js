// Public claims are deliberately separate from roadmap promises.
export const features = [
  {
    icon: "calendar",
    title: "An event worth showing up for.",
    description:
      "Publish with your flyer, location, schedule, and custom ticket or package tiers. Create independently or with your organization.",
    label: "EVENTS & OFFERINGS",
  },
  {
    icon: "chart",
    title: "Know what moves your business.",
    description:
      "Explore sales by event, package, employee, or promoter. Filter your reporting window and export the numbers as CSV.",
    label: "SALES VISIBILITY",
  },
  {
    icon: "users",
    title: "Your guestlist. Your rules.",
    description:
      "Approve or decline requests. Set a venue event limit and additional promoter allocations without one consuming the other.",
    label: "GUESTLIST CONTROL",
  },
  {
    icon: "shield",
    title: "One team. The right access.",
    description:
      "Keep owners, managers, employees, and promoters in a role-aware workspace. Manage multiple organizations with one identity.",
    label: "TEAM WORKSPACE",
  },
];

export const competitors = [
  {
    name: "Posh",
    focus:
      "Social event discovery, ticketing, team tracking, and organizer marketing.",
    fit: "Choose Nitewide for a workspace that brings event/package/person reporting and separate guestlist allocations together.",
    url: "https://docs.posh.vip/event-team",
    source: "Posh organizer documentation",
  },
  {
    name: "Discotech",
    focus:
      "Nightlife discovery, tickets, guestlists, and bottle-service reservations.",
    fit: "Choose Nitewide when your priority is the operator’s workflow: publishing, team permissions, approvals, and sales visibility.",
    url: "https://discotech.me/",
    source: "Discotech product overview",
  },
  {
    name: "Tabler",
    focus: "Social experiences, joining or hosting tables, and sharing costs.",
    fit: "Choose Nitewide to configure your own ticket and package offerings, with organization or independent-creator management.",
    url: "https://www.tablerapp.com/faq",
    source: "Tabler FAQ",
  },
  {
    name: "Sections",
    focus:
      "Discovering events, reserving tables, buying tickets, and joining guestlists.",
    fit: "Choose Nitewide for a browser-first business workspace connected to customer discovery, with no organization required to create independently.",
    url: "https://apps.apple.com/us/app/sections-tables-events/id6755155921",
    source: "Sections developer product listing",
  },
];

export const roadmap = [
  {
    phase: "01",
    title: "Payments & the door",
    description:
      "Stripe Connect onboarding, verified payment processing, refunds, dispute workflows, and a dedicated QR check-in interface.",
  },
  {
    phase: "02",
    title: "Keep your crowd connected",
    description:
      "Email and SMS reminders, approval notifications, sold-out alerts, and consent-based marketing and customer tools.",
  },
  {
    phase: "03",
    title: "A deeper view. A wider reach.",
    description:
      "Advanced Premium analytics and promoter ROI tools. A Florida launch focus, followed by national expansion.",
  },
];

export const pricing = {
  freeMonthly: 0,
  premiumMonthly: 249,
  feePercent: 8,
  feeFixed: 0.80,
  status: "planned",
};

export const questions = [
  [
    "What does my business pay?",
    "Core platform use is free. Standard customer fees are 8% + $0.80 per paid ticket or package. Automatic discounts target modeled Posh and Eventbrite buyer fees. Minimum-cost adjustments take priority and may exceed the standard rate or competitor price. Nitewide covers Stripe processing fees; there is no Nitewide organizer listing or transaction fee. Premium is optional at $249/month. Taxes, refunds, disputes and agreed promoter rewards remain separate obligations. Live payments and subscriptions are not yet enabled.",
  ],
  [
    "Do I need to own a venue?",
    "No. Independent creators can create events with their own account. Organization events use assigned roles so only authorized people can make changes.",
  ],
  [
    "What can I use today?",
    "The local demo includes sign-in, event creation and editing, flyer uploads, ticket/package configuration, guestlist approvals, and sales reporting. Customer checkout is mocked; it does not collect real payments.",
  ],
  [
    "How do guestlist limits work?",
    "The event guestlist and each promoter allocation are separate. An event with 50 venue entries plus two promoter allocations of 20 can approve up to 90 entries across those lists. Pending requests are not admission approval.",
  ],
  [
    "Does Premium lower transaction fees?",
    "No. Planned transaction fees are the same on both plans. Premium is intended for advanced analytics, consent-based CRM, marketing, and business management—not a fee discount. Billing and Premium feature gates are not live.",
  ],
  [
    "When can I take payments or receive payouts?",
    "Live payments and payouts are upcoming. Availability and payout timing will depend on payment-provider approval, cleared funds, risk checks, and the connected account. There is no guaranteed 24-hour payout or chargeback protection.",
  ],
];

export function businessPage(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "landing";
  if (path === "/sign-in" || path === "/app") return "workspace";
  return "not-found";
}
