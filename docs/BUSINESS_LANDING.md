# Business splash page

## Routes and navigation

- Customer header → **For business** → Business `/` (public, including when already signed in).
- Business calls to action → `/sign-in` → existing authenticated workspace at `/app`.
- Sign-out and expired sessions return to `/sign-in`; sign-in includes a link back to the splash.
- Business **Explore events** links back to Customer. On narrow screens this remains available in the final call to action rather than crowding the header.
- Unknown Business routes show a not-found screen with a home link.

Local development uses ports 5173 and 5174, preserving `localhost`, `127.0.0.1`, or IPv6 loopback. No new backend route or database migration is needed.

For production, set `VITE_BUSINESS_URL` in `apps/customer/.env.local` and `VITE_CUSTOMER_URL` in `apps/business/.env.local`, or in each build environment. Use the actual deployed HTTPS origins; variables are public build-time values, never secrets. Restart Vite after changing them. The root API `.env` does not configure Vite. Examples live in both app directories. Production cross-origin deployments **must** set these values: the unconfigured same-origin fallbacks (`/business` and `/`) do not provision routing or hosting.

Deploy Business at its own origin root and configure SPA fallback to `index.html` for `/sign-in`, `/app`, and unknown paths. Preserve `/api` proxy routing separately. Subpath hosting needs base-aware routing changes; it is not implemented. Existing sign-in/session handling and server-side role checks remain authoritative. The public page does not fetch private business data.

## Components and style

| File | Responsibility |
| --- | --- |
| `apps/business/src/Landing.jsx` | Header, hero, interactive preview, feature cards, workflow, comparison, pricing, roadmap, FAQ, and final CTA |
| `apps/business/src/lib/landing-content.js` | Reviewed feature copy, pricing policy, competitor sources, roadmap, questions, and route classification |
| `apps/business/src/landing.css` | Scoped `.business-landing` styles and `lp-` components |
| `apps/business/src/main.jsx` | Public page selection; lazy-loads the existing workspace and chart bundle |
| `apps/business/src/lib/customer-link.js` | Customer destination selection |
| `apps/customer/src/lib/business-link.js` | Business destination selection |

The page uses existing shadcn Button, Badge, and Radix Tabs components with Lucide icons. It extends the charcoal/lavender Business theme: canvas `#101116`, cards around `#191A22`, foreground `#F4F3F9`, primary `#B9A9FF`, and muted plum accents. It intentionally avoids the Customer app’s vivid pink treatment. Native details/summary makes the FAQ usable without custom disclosure state. No external fonts, tracking scripts, stock imagery, new dependencies, or third-party embeds are added.

Desktop uses a split hero and four feature cards; tablet uses two-column cards; phones stack content. The customer header wraps its discovery navigation onto a second row below 900px to preserve both auth and Business access. Keyboard focus is visible, preview tabs support arrow keys, chart values have a textual accessible equivalent, progress bars are labeled, and motion respects reduced-motion preferences. The preview is sample data, not a sales claim or a live workspace; gross sales are not profit or payouts.

## Copy and claims policy

Current = working **local demo** features, not production readiness. Guestlist limits are independent event/promoter pools; approval is required. Sales reports are recorded paid-order metrics. Customer purchase flow is mocked. Do not imply settled funds, guaranteed results, automatic liability elimination, or launched city coverage.

Upcoming = live Stripe Connect payments/payouts/refunds/disputes, door-scanner UI, email/SMS, consent-based CRM/outreach, advanced analytics, Premium billing/entitlements, and geographic rollout. Roadmap order expresses direction, not guaranteed delivery dates.

Current pricing: Free $0/month; optional Premium $249/month; **customer pays standard 8% + $0.80 (automatic discounts and minimum-cost exceptions apply) per paid ticket/package, Nitewide pays Stripe processing**. Premium does not reduce fees. API and Customer demo use this policy; Stripe settlement and subscriptions are not live. See [current fee policy](FEE_POLICY.md).

Comparisons are positioning statements—not claims that alternatives lack particular features or measured proof of outperforming them. Sources reviewed September 21, 2026:

- [Posh team documentation](https://docs.posh.vip/event-team) and [organizer workspace/marketing](https://support.posh.vip/en/articles/15091892-understanding-the-posh-workspace-menu-organizer-vs-attendee-controls).
- [Discotech official product overview](https://discotech.me/).
- [Tabler official FAQ](https://www.tablerapp.com/faq).
- [Sections developer App Store listing](https://apps.apple.com/us/app/sections-tables-events/id6755155921). The old `sections.app` domain is not the verified nightlife product; do not use it as a source.

Revalidate these links and claims before public launch. Competitor names are informational; there are no implied partnerships, endorsements, customer logos, or invented testimonials.

## Verification

### Pricing and competitor grid update — September 23, 2026

`components/fee-comparison.jsx` renders the investor deck's slide 6 matrix with **13 capabilities as rows and platforms as columns**, using `lib/feature-matrix.js`. Nitewide's “Yes” means working local demo, “In dev” means planned or in progress, and a dash means no equivalent verified in reviewed public materials—not proof of absence. Qualified competitor entries do not imply exact feature parity. Nitewide's column is highlighted without implying an independent award or production availability. Copy frames lower buyer fees as freeing budget for in-venue purchases—not guaranteed incremental venue revenue.

`lib/comparison.js` contains reviewed claims, numbered official sources and the comparison calculator. Posh publishes **10% + $0.99 per paid ticket including processing**. Nitewide charges the buyer **standard 8% + $0.80 (automatic discounts and minimum-cost exceptions apply) per paid ticket/package**, with **Stripe paid by Nitewide**. Buyer fees target 2% below the lower modeled Posh/Eventbrite buyer fee, except where the hard minimum contribution overrides; this is not an organizer savings claim. Discotech uses event-specific providers; Tabler has booking-disclosed commissions; no universal Sections rate was verified. Unknown rates are not treated as zero. Tabler’s terms restrict business use, a documented scope difference.

The estimator models identical USD face values and quantities. Stripe’s illustrative US domestic-card 2.9% + $0.30 is calculated on the **full customer charge** as an internal Nitewide cost. Public results show customer totals and venue proceeds, not Nitewide contribution or processing deductions. There is no separate buyer processing surcharge. The hard contribution floor can increase the service fee beyond the standard rate or competitor target. Actual provider/Connect pricing, methods, taxes, special discounts and disputes vary; this is not a settlement quote.

Examples: 3 × $25 tickets cost $83.40 on Nitewide, $85.47 on Posh and approximately $85.57 on Eventbrite. Nitewide venue proceeds are $75 before commissions and other obligations; modeled internal contribution is $5.68 after estimated Stripe. One $300 VIP costs $321.52, $330.99 and approximately $321.96 respectively; modeled internal contribution is $11.90 after Stripe. Contribution figures are internal documentation only, not public calculator output. See [current fee policy](FEE_POLICY.md) for formulas, fee breakdowns and rounding assumptions.

Free means no organizer subscription, listing, or Nitewide transaction fee; Nitewide pays routine Stripe processing. Taxes, promoter rewards, disputes and refunds remain separate obligations. Existing orders/receipts are not repriced. New API snapshots store the policy version and processing payer. Promoter arrangements were not changed.

Each claim references official sources in the expandable source list; IDs align with `comparisonSources`. Refresh before public launch. Tests cover matrix alignment/statuses, customer/API parity, cent rounding, fee savings, organizer processing, input bounds and policy snapshots. Browser checks cover combined feature columns and desktop/mobile layouts.

```bash
npm test --workspace @nitewide/business
npm test --workspace @nitewide/customer
npm run build --workspace @nitewide/business
npm run build --workspace @nitewide/customer
```

Automated tests cover route classification, current/upcoming copy separation, latest pricing, source presence, and local/deployed cross-app destinations. Existing auth/reporting/helper tests remain in place. Browser smoke checks: Customer → Business → sign-in → existing demo-owner workspace → sign-out → splash; preview tabs and FAQ expansion; feature/pricing anchors; 1440px desktop, 390px phone and 320px narrow-phone overflow. These are manual browser checks, not a newly installed browser test runner.
