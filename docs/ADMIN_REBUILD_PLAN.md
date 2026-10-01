# Admin rebuild decisions

This document records the platform owner's decisions for rebuilding NiteWide Admin as the main operations and support application. Implementation was authorized and is underway locally. Decisions in this document are not a deployment claim; current capabilities are described in [Admin frontend](ADMIN_FRONTEND.md) and [Internal admin management](ADMIN_MANAGEMENT.md).

## Interface and access

Use the Business app's styling and UI components, with clear navigation and mobile-first behavior. Retain server-side pagination, reliable loading, versioned writes, authorization, and historical records. Consolidate redundant screens rather than adding another parallel management interface.

Design for a human operator, not database tables. Businesses, Events and People begin with understandable directories, not a database-record dropdown. Related access, invitations, referrals, purchases and admission records are discovered through the relevant person/business/event and contextual actions. Preserve granular capability and return context while keeping technical identifiers and mechanics secondary. Apply the [human-operator and responsive design standards](ADMIN_FRONTEND.md) to all future admin UI work until the platform owner says otherwise.

The platform owner needs granular create, view, edit, archive, suspend, restore, and event-cancellation controls. Use the creator's event-editing capabilities in admin rather than a reduced generic event form. Financial and admission history must remain intact; administrative access is not permission to silently rewrite historical payments.

Provide platform-wide analytics with drill-down and an explicit way to view or manage each individual record without losing report context. Show sales, platform fees, business proceeds, performance, and operational data with precise labels. Distinguish estimates from provider-confirmed amounts.

The primary analytics path is Business, Event, Offering, then Purchase. Provide optional Venue and Region views/filters and direct Customer and Team entry points rather than requiring a venue in every path. Use canonical record IDs for individual actions, preserve historical financial snapshots, and count order-level fees once even when an order contains several offerings.

Use dedicated detail pages for businesses, events, and users, with related tabs and contextual actions. Use modals for small edits. Returning to a report preserves its filters, pagination, and drill-down context.

Event detail pages display a compact, proportional flyer thumbnail beside the event summary in a responsive grid—not full-sized artwork or a tall, mostly empty desktop header. Missing or failed images have a clear fallback. Every admin UI change must be reviewed on iPhone/mobile and desktop, following the responsive design standard in [Admin frontend](ADMIN_FRONTEND.md).

The home page leads with financial and performance metrics and a compact admin-specific Needs attention queue. It must not copy routine business tasks. Examples include applications awaiting manual onboarding review, client/customer support cases, security concerns, and platform failures.

Support a full-access platform-owner role and separate support, operations, and read-only staff roles. Exact permissions still need definition; enforce permissions in the API, not just the interface.

## Business onboarding

Use one business workspace model for solo creators, promotion groups, single-venue operators, and multi-venue organizations. A solo creator can initially be the workspace's only owner. Venues are optional relationships, not separate authorization types; do not retain a separate individual-creator permission system for new workflows. Existing memberships, events, referrals, purchases, and audit histories need a deliberate compatibility/migration path rather than being discarded.

All new businesses are organizations. Business type is not a normal editable field. Existing stored classifications remain compatibility data, not permission or venue-count restrictions. Organization slugs are generated server-side from an ASCII-normalized name and unique identifier; they are hidden and non-editable. Same-name businesses in different cities are permitted. Slug normalization is not a substitute for output escaping, validated fields, or parameterized SQL.

An organization can own zero, one, or many managed venues. Each managed venue belongs to exactly one organization, can be created and renamed, and has separately scoped manager, employee, and promoter assignments. Organization-wide memberships retain their scope; a venue-only assignment must not grant organization-wide access, other venues, or finance permission. Venue managers manage their own venue's operations and employee/promoter assignments; organization owners or platform admins grant venue-manager access. Existing organization-wide managers retain their venue-management capabilities.

Venue management uses searchable, server-paginated lists and scoped create/edit/team actions, not a scrolling multi-select of every venue. The legacy default-location pointer is maintained internally rather than exposed as a second venue control. Event-only location/address snapshots are not managed-venue ownership; using a venue's physical address does not establish ownership or staff access. Conflicting existing managed-venue ownership must be reported and resolved explicitly, never silently reassigned during migration.

Admin can manually onboard any of these businesses. An owner or a manager may be the initial contact. A manager can be the first and initially only contact, with an owner added later; do not silently grant the manager ownership.

An organization must also be allowed to have no saved venue or business address. A group such as Evolve Promo can organize events at other locations, have its own employees and promoters, and retain an organization owner who also promotes its events. Having a referral link or commission terms must not change that person's owner role into promoter.

For the initial event workflow, allow a venue name and event address without linking to a registered venue or claiming its ownership. Selecting a physical location must not grant venue-management rights or determine the payment merchant automatically. Preserve existing managed-venue relationships while allowing this simpler event-location path.

Owners, managers, and employees retain their business roles while also having referral links, guestlist allocations, and optional commissions. A user can have different scoped roles in different businesses. Historical attribution remains intact when roles change.

Support multiple owners in the same business. Initially, only internal admins can add, remove, or transfer ownership; business owners cannot remove another co-owner. Adding an owner must not replace existing co-owners. A transfer must identify the outgoing and incoming users explicitly and preserve unrelated memberships and historical attribution. Ownership changes remain separate from Stripe's account-control process.

Each transfer must explicitly choose whether the outgoing owner remains as a manager, remains as an employee, or loses business access. Retaining someone as a manager does not automatically retain finance permission; that requires a separate grant. The incoming owner must accept a secure invitation before the transfer activates. Until acceptance, the outgoing owner retains ownership. Apply the incoming grant and outgoing role/access change together so a transfer cannot leave the business without an active owner. Admin recovery overrides require separate confirmation and an audit record.

Business owners can grant or revoke a separate finance permission for managers they choose. Internal admin can grant it during manager-led onboarding and support operations. Finance-authorized managers can connect/select payment accounts and approve merchant refund requests when payments are integrated. An operational manager role alone must not confer this permission. Exact staff permission templates still need definition.

Collect the business/creator name, applicant name and role, verified email, phone, venue details when applicable, and confirmation of authority to represent the business. Website and social links are optional. Do not unnecessarily duplicate banking or identity-verification documents handled by Stripe.

Admin supplies the business configuration. The recipient verifies their email and sets their own password, or accepts access through their existing account. The business completes its own Stripe onboarding when payments are integrated. Account activation, business approval, and Stripe readiness are separate states.

Business sign-in requires current approved/onboarded business access, not merely an existing Customer account. The public Request access form now collects an application for manual Admin review. It does not grant a draft workspace or self-provision an organization. Admin approval uses the existing secure onboarding invitation, with access activated only after acceptance. Full self-service configuration remains a later phase.

Future self-service onboarding will let an owner, manager, or independent creator configure their business and draft events before submitting for manual admin review. Publication requires approval; paid sales additionally require Stripe readiness. Review actions are Approve, Request changes, and Decline. Admin-created businesses can bypass application review because the administrator has already reviewed them.

## Suspension and support

Suspension blocks new sales, invitations, and business changes while honoring existing bookings and admissions. Event cancellation is a separate explicit action, not an automatic side effect of organization suspension.

Admin event cancellations and significant time or venue changes notify affected attendees through the same domain rules as creator changes. Show recipient counts before confirmation. Ordinary spelling or description corrections do not trigger attendee notices.

Start support intake with admin-created cases and automatic platform alerts. Prioritize admission and paid-booking problems, then account/access problems, followed by guestlist, referral, and reporting corrections. Case details, priority rules, and staff permissions remain to be specified.

Retain Contact support and Report an issue forms in the Customer and Business apps as a later feature. Do not add those forms in the initial rebuild merely because the idea is recorded here.

When refunds are integrated, use merchant approval by default with a separately authorized and audited admin override. Application-fee refund policy remains an open decision.

## Future payment integration

Businesses are intended to be their own merchants of record, using Stripe Connect with Standard-style account control, direct charges, and Stripe-handled processing pricing. Keep business account ownership and Stripe authorization separate from a user's manager role. The initial payment scope is US merchants, USD, cards and Apple Pay, accounting for international-card costs; additional methods/currencies need validated economics before being enabled. Provider support does not mean the app's Connect onboarding, server-side payment verification, webhook handling, or reconciliation is already implemented.

Initially use one connected account per business. Support the future case of multiple venues belonging to one organization, each with its own connected account. Use named business payment-account profiles, a business default, explicit event-level selection, and a merchant snapshot on every order/payment. A profile can represent a nightclub without deriving routing from its address text. Only owners or finance-authorized managers can connect/select accounts; internal admin has audited operational controls. Each checkout uses one merchant account. Lock the event's selection after its first paid sale and retain the original merchant on historical transactions. Keep merchant-account identity separate from user identity and event-location fields.

Customers normally pay an added fee covering Stripe processing and NiteWide's platform fee. Businesses must also be able to absorb the combined fees so an advertised price, such as $10, is the customer's full purchase price before any separately applicable taxes. Set fee mode per offering, with an event-wide default.

Business-absorbed fees and commission-eligible purchases have a $10 minimum order subtotal after discounts and before taxes/added fees. Two $5 tickets can qualify. An absorbed-fee $5 offering must require at least two units, enforced in the editor before it becomes sellable; allowed quantities and later discount rules must not permit a below-threshold absorbed purchase. Below-threshold buyer-paid purchases remain purchasable and retain referral attribution while awarding $0 commission. Require positive business proceeds after combined fees and configured commissions, in addition to protecting NiteWide's floor.

Paid sales must preserve positive NiteWide transaction contribution after applicable transaction costs; free tickets are exempt. Competitive pricing and the margin floor remain requirements. Do not promise accounting profit or unconditional realized profitability after refunds, fraud, or unknown provider costs.

Retain the existing [fee policy](FEE_POLICY.md): a hard $1 contribution per paid order, a preferred 5% contribution target, and a standard 8% plus $0.80 per paid offering unit. The hard floor overrides the standard fee ceiling and competitor discount when necessary. The local modeled-demo implementation now supports buyer-paid and business-absorbed fees and editor safeguards. Its processor-paid-by-platform assumption must be reconciled with the intended Connect setup before live payments.

Catch infeasible paid prices at the creator/admin editor, not by rejecting an otherwise valid published purchase for insufficient pricing margin. Validate supported currencies, configured payment costs, allowed quantities, absorbed-fee prices, the $10 eligibility requirement, positive business proceeds, and future discount rules before making them sellable. Validate changes to commission terms and payment-cost configuration as well as offering edits. Keep defensive server-side validation for tampered, stale, or unsupported requests; editor validation is not a replacement for checkout authorization or verified payment success. Exact cost bounds and future discount rules still need definition.

Under the intended Stripe-handled direct-charge setup, Stripe deducts processing fees from the connected account and the platform collects an application fee. The combined buyer fee and NiteWide application fee must not be treated as the same amount or processor costs deducted twice. See [Stripe direct charges](https://docs.stripe.com/connect/direct-charges), [Connect pricing](https://stripe.com/connect/pricing), and [merchant of record](https://docs.stripe.com/connect/merchant-of-record).

## Implementation sequence

The platform owner approved coding, planning and parallel implementation. The rebuild is being integrated and verified locally; it has not been committed, pushed or deployed as part of this work.

First rebuild admin and the shared business model: onboarding, scoped roles/finance permissions, event locations, support cases and alerts, record actions, analytics, and pricing/editor safeguards. Preserve the existing demo checkout. Deliver small increments with unit, API/database, and UI regression coverage; the business and customer apps must retain existing workflows and styling outside explicitly approved changes. No email-quota-consuming tests should run by default.

Next integrate Stripe in test mode, including connected-account onboarding, verified payments, application fees, webhook processing, merchant-specific reconciliation, and refunds. This is a separate phase, not an implied part of the first admin rebuild.

Enable live payments only after a separate launch approval. Contact support/Report an issue forms and business self-service application forms remain later features, although the initial admin design must account for their eventual review/support workflows.

## Remaining operational decisions

- Define staff permission templates and support case workflow before enabling their actions. These can use conservative proposed defaults without reopening the overall navigation or business model.
- Define application-fee refund policy, cost bounds, and Stripe launch configuration during the subsequent payment-integration phase.

## Findings that motivated the rebuild

Before the rebuild, the Organization model allowed a null default location, but admin onboarding required a venue and always granted ownership. Organization event editing required a saved linked venue. The rebuild replaces those new-workflow restrictions with optional venues, an explicit owner or manager initial contact, and event-specific address support.

Admin reporting shares SQL-backed summaries and paginated reports with Business. The rebuild adds business and purchase drill-down tables, canonical record links, and authoritative directories including businesses without events. Region remains based on event location, not a business headquarters. Historical normalized venue groups are reporting aggregates, not ownership records or safe substitutes for canonical record IDs when editing.

The reporting summary currently emphasizes face-value sales and recorded commissions. Platform/application fees, processor costs, merchant proceeds, and refunds need explicit reporting definitions. Order-level fees cannot be counted once for every offering in the same order. Extend the shared query scope and snapshot exports rather than loading all raw platform records into the browser.
