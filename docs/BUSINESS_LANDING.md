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

Current pricing: Free $0/month; optional Premium $249/month; **customer pays 7.5% + $0.79 per paid order, organizer pays Stripe processing**. Premium does not reduce fees. API and Customer demo use this policy; Stripe settlement and subscriptions are not live. See [current fee policy](FEE_POLICY.md).

Comparisons are positioning statements—not claims that alternatives lack particular features or measured proof of outperforming them. Sources reviewed September 21, 2026:

- [Posh team documentation](https://docs.posh.vip/event-team) and [organizer workspace/marketing](https://support.posh.vip/en/articles/15091892-understanding-the-posh-workspace-menu-organizer-vs-attendee-controls).
- [Discotech official product overview](https://discotech.me/).
- [Tabler official FAQ](https://www.tablerapp.com/faq).
- [Sections developer App Store listing](https://apps.apple.com/us/app/sections-tables-events/id6755155921). The old `sections.app` domain is not the verified nightlife product; do not use it as a source.

Revalidate these links and claims before public launch. Competitor names are informational; there are no implied partnerships, endorsements, customer logos, or invented testimonials.

## Verification

### Pricing and competitor grid update — September 21, 2026

`components/fee-comparison.jsx` renders one compact table with **platforms as rows and all current/upcoming features as columns**, using `lib/feature-matrix.js`. Checkmarks indicate documented availability (Nitewide checks are local-demo features); clock/Planned marks future work. Partial, Not verified, and Not offered have different symbols and accessible descriptions. Nitewide’s row is highlighted without implying an independent award or live roadmap functionality. Eleven feature columns remain together; no Current/Upcoming tab switch is needed. A separate compact rates table keeps dollar amounts out of the checkmark cells. Copy frames lower buyer fees as freeing budget for in-venue purchases—not guaranteed incremental venue revenue.

`lib/comparison.js` contains reviewed claims, numbered official sources and the comparison calculator. Posh publishes **10% + $0.99 per paid ticket including processing**. Nitewide charges the buyer **7.5% + $0.79 per order**, with **Stripe paid by the organizer**. Buyer fees are at least 10% below the dated standard Posh benchmark; this is not an organizer savings claim. Discotech uses event-specific providers; Tabler has booking-disclosed commissions; no universal Sections rate was verified. Unknown rates are not treated as zero. Tabler’s terms restrict business use, a documented scope difference.

The estimator models identical USD face values and quantities. Stripe’s illustrative US domestic-card 2.9% + $0.30 is calculated on the **full customer charge** and shown as an organizer expense. No buyer processing surcharge or gross-up is applied. Actual provider/Connect pricing, methods, taxes, special discounts and disputes vary; this is not a settlement quote. The financial model likewise keeps organizer processing out of Nitewide platform expenses.

Examples: one $20 ticket costs $22.29 on Nitewide versus $22.99 on Posh ($0.70 customer savings); four $20 tickets cost $86.79 versus $91.96 ($5.17 savings). Nitewide organizer Stripe estimates are $0.95 and $2.82 respectively. For 1,000 such orders, customer savings are $700 and $5,170. Premium is optional at $249/month and excluded from buyer totals. Inputs are bounded and invalid values show an error instead of stale results.

Free means no organizer subscription, listing, or Nitewide transaction fee; organizers **do** pay Stripe processing. Taxes, promoter rewards, disputes and refunds remain separate obligations. Existing orders/receipts are not repriced. New API snapshots store the policy version and processing payer. Promoter arrangements were not changed.

Each claim references official sources in the expandable source list; IDs align with `comparisonSources`. Refresh before public launch. Tests cover matrix alignment/statuses, customer/API parity, cent rounding, fee savings, organizer processing, input bounds and policy snapshots. Browser checks cover combined feature columns and desktop/mobile layouts.

```bash
npm test --workspace @nitewide/business
npm test --workspace @nitewide/customer
npm run build --workspace @nitewide/business
npm run build --workspace @nitewide/customer
```

Automated tests cover route classification, current/upcoming copy separation, latest pricing, source presence, and local/deployed cross-app destinations. Existing auth/reporting/helper tests remain in place. Browser smoke checks: Customer → Business → sign-in → existing demo-owner workspace → sign-out → splash; preview tabs and FAQ expansion; feature/pricing anchors; 1440px desktop, 390px phone and 320px narrow-phone overflow. These are manual browser checks, not a newly installed browser test runner.
