# Nitewide Business

## Scope and local startup

The business application is a real API-backed React/Vite application, not a static dashboard. It uses the existing single User identity, shadcn/ui components, Radix accessible primitives, Tailwind CSS v4, Lucide icons, and Recharts. Apply the additive `202609210001-event-images` migration; no reseed is needed and existing events/sales are preserved.

From the repository root, after the initial setup in README:

```bash
npm install
docker compose up -d postgres
npm run db:migrate
# Separate terminals:
npm run dev:api
npm run dev:business
```

Open http://127.0.0.1:5174. Vite proxies `/api` to http://localhost:4000. Restart the API after backend changes. For separate production origins, set `VITE_API_URL` at build time and configure the API CORS allowlist. Otherwise proxy `/api` on the web origin. Root `.env` is for the API; Vite overrides belong in `apps/business/.env.local` or the build environment.

Demo password for every account below: `NitewideDemo!2026`.

| Persona              | Email                                   | Expected workspace                                     |
| -------------------- | --------------------------------------- | ------------------------------------------------------ |
| Portfolio owner      | maya.owner@nitewide.test                | All 12 organizations; full event management            |
| Venue manager        | sam.rivera.manager@nitewide.test        | Euphoria Downtown; management and approval             |
| Venue employee       | tessa.ward.employee1@nitewide.test     | Euphoria events; own referrals and guestlists          |
| Promoter             | leo.carter.promoter1@nitewide.test      | Euphoria events; own attributed sales; approval access |
| Internal admin       | admin@nitewide.test                     | Platform-wide organization/event management            |
| Customer/new creator | jordan.customer.customer1@nitewide.test | Empty workspace until creating an independent event    |

## User workflows

The Business root now shows a public splash page; `/sign-in` and `/app` serve the existing sign-in/workspace flow. See [Business splash documentation](BUSINESS_LANDING.md) for components, claim boundaries, responsive behavior, and cross-app deployment settings.

**Sign in:** email/password goes to the existing authentication API. The signed 12-hour token is stored in this tab's `sessionStorage`, separately from the customer app. Signing out clears the business session; expiry and API 401 responses return to sign-in. Every business request is authorized server-side; the UI never sends a hard-coded development user ID. Customer accounts can start independent events, consistent with the shared-identity architecture; they cannot assign themselves a venue role.

**Personal workspace:** a basic venue employee or event/venue promoter gets a distinct Overview, My analytics, My events, and Guestlists navigation; there is no Team page, organization-management control, full-venue revenue panel, or event editor. Their sales and customers are limited to purchases credited to their referral assignments, and their guestlist requests are limited to their own referrals. Employees can open events at their venue; an event-only promoter can open only assigned events. Both can retain their own historical credited sales after an event assignment is deactivated while current venue membership still authorizes event access. Owners, venue managers, independent event creators, and internal admins keep management views for the organizations or events they actually manage. A user with both management and basic roles sees authorized management data as well as their own attributed performance. The API enforces these boundaries independently of the UI.

**Guestlist invitations and notifications:** authorized users can invite by email or phone from the Guestlists tab, using the direct pool or their own positive allocation as their role permits. Existing matching customers are confirmed immediately; new guests get a private signup link to share manually and capacity is checked when claimed. Both Business and Customer include an in-app notification inbox. See [invitation behavior, API, verification and future email/SMS delivery plan](GUESTLIST_INVITES_NOTIFICATIONS.md).

**Overview:** select one or several authorized organizations, or independent events and a 7/30/90/365-day sales period. Review gross sales, paid orders, average order, recorded commissions, daily sales, sales by event/tier, and team/promoter performance. The performance table has a multi-select Roles dropdown for owners, managers, employees, promoters, and independent creators when those roles are present; no selection shows everyone. It reconciles each person's paid orders, attributed face-value sales, requested/approved guestlist places, and recorded commission against Event detail and Analytics. The Sales mix tabs show a face-value revenue pie with a top-six-plus-Other legend and ranked amounts for tickets/packages or events. The organization picker is hidden when only one workspace is authorized. Refresh explicitly reloads current API data. Export downloads all report rows and daily values as CSV; formula-like names are escaped to avoid spreadsheet injection.

**Analytics:** choose preset or custom UTC payment dates (up to 366 inclusive days), select multiple authorized regions and organizations when more than one exists, or search broadly. The page combines face-value sales, orders, unique customers, average order, sales pace, regional contribution or color-distinct top events, and ticket/package performance. The Tickets & packages panel also uses the shared face-value sales pie and legend. For a single-region business, start at venues/creators; otherwise drill region → venue/creator → event → paid customer. In **Team & referrals**, drill from each owner, manager, employee, or promoter into their referred customers and paid sales. Current team members with no attributed sales still appear with zero values. Names and email addresses are shown only for orders in the signed-in user's authorized sales scope; they are for order operations, not outreach without marketing consent. Attribution follows `EventAffiliate` before `OrgAffiliate`; the four team roles stay distinct. The report never infers sales from ownership or event creation. A promoter-only viewer sees only their own credited orders, not a venue-wide customer list.

**Events:** browse Upcoming & live, Past, Drafts, or All events, search names/venues/cities, and filter inclusive venue-local dates. The library shows lifetime paid sales and order counts, independent of the Overview sales period. Open an event for Sales overview, Tickets & packages, or Team. Sales overview includes attendees sorted by Total spend descending (before fees); Team defaults to Sales descending. Details include face-value sales, payments including fees, earned commissions, direct/role sales mix, ticket admissions, checked-in admissions, guestlist places, and customer purchase details. Employees/promoters see only their own referred commerce and guests. Past events remain readable and reject configuration changes on the server. See [Event operations](EVENT_OPERATIONS.md) for complete rules and verification.

The Tickets & packages step supports limited ticket or package ladders and venue-local sales windows. Add a tier, choose a lower-priced earlier tier of the same type in **Open after**, and optionally set Start/Stop selling times. The next tier unlocks when the prior tier sells out, reaches its stop time, or an authorized editor unchecks Sales enabled and saves. New tiers can be added to unfinished events through Manage tiers; completed sales retain their original price.

The three-step editor omits category and URL-slug inputs; the API preserves existing slugs/categories and generates a unique slug for new events. Organization events use their authorized organization's saved location, ignoring client-supplied addresses; independent creators can enter a location and privacy setting. Ticket tiers can open during date windows and/or after an earlier finite, lower-priced admission tier sells out. Checkout enforces both gates under the event/inventory transaction. Existing password tiers can retain their visibility, but provisioning passwords is outside this UI. New events start with $10 GA and $300/$400/$1,000 packages; all prices are editable and in USD. Event managers select owners/managers/employees/promoters for unfinished events and set each person's rate with a 0–40% slider; changes affect future orders only.

**Guestlists:** the event selector shows future events and events that ended within the last 24 hours, with dates in each event's local timezone; it refreshes while the page remains open. Names longer than 36 characters are shortened in the selector. This page has no sales-period or export controls. Choose one or more request statuses (or clear the selection for all). The table shows guest names but not email addresses; click a name for a details dialog with contact information, event, party, referral, review, and check-in details. The dialog handles pending approvals/declines and a two-step cancellation of approved, unused entries. Cancelling revokes the QR credential, records an audit event, and immediately releases the direct or individual referral allocation. Source shows Direct or the referrer's name; there is no separate referral column. Future events do not offer checked-in or no-show statuses, and the API rejects guestlist check-in before an event starts. Only approval issues a credential. Owners/managers, independent event creators, and internal admins can review any request for their event; a basic employee or promoter can view and review only entries referred by their own active EventAffiliate. They cannot approve, decline, or cancel a Direct entry or another person's referral. Owners and managers can set direct-event capacity and each selected referrer's additional allocation. Blank limits inherit the organization default when present. Limits cannot be lowered below already approved/checked-in party members. A direct 50 plus two promoter 20s remains 90 possible guest admissions.

**Team:** owner and manager accounts see only organizations they manage. Owners can invite managers, employees, or promoters; managers can invite employees or promoters; employees cannot invite or edit events. New invitees register as customers first, while existing customers retain their identity and other roles. Invitation tokens are stored only as hashes, expire after seven days, and can be accepted only by the matching email. The Team table lists owners, managers, employees, and promoters; clicking a person opens a modal with their profile and 30-day referred-sales figures. The modal closes with its Close button, the X, Escape, or a click outside, returning focus to the selected member. Pending invitations can be deleted or renewed. **Resend** opens a prefilled email in the operator's email app; Nitewide does not yet deliver email automatically. Owners/managers should copy the newly generated link if no email app opens.

**Event Team:** the event-detail Team table uses plain Sales and Commission columns, with Role before Commission. Click the name or row for details and authorized editing/removal. A shared Roles multiselect derives its options from roles actually in the roster. **Add promoter** opens `EventPromoterInvite`: email, 0–40% offered commission slider, private link/email sharing, and pending invitation renewal/revocation. This grants event-only promoter access, not venue membership. The invitation landing shows the offered rate and routes successful event invitees to Events; their reports and guestlists remain limited to their own referrals. Automatic email sending is not yet configured.

The local demo seed varies team sizes repeatably by venue: 1–3 managers plus the owner, 9–12 employees, and two promoters. These are fixture counts, not invitation limits. Team, Overview, and Analytics use the same people and attribution rules for a matching venue and date range. A read-only seeded-database test checks all 12 venues with `RUN_DB_TESTS=1 node --test apps/api/test/seed-team-integration.test.js`.

All data tables use sortable headers and 10 rows per page by default, with 25/50 options. Management lists default A–Z; sales-focused lists default by sales descending. The Create event button appears only on Overview and Events (including the Events empty state), never in the shared navigation or analytics/guestlist/team pages.

## Event images and flyers

In the essentials step, choose **Event image or flyer** to upload artwork. The editor displays the optimized result before you save. Replace it by choosing another file, or **Remove from event** and save to return to fallback imagery. Attaching/removing artwork participates in the same audited, version-checked event transaction. Authorized event editors may attach any existing uploaded asset, regardless of who uploaded it. Asset existence and event-management permission are still required; uploader identity is retained only for provenance and upload accounting.

Customer cards and the event-detail dialog use `Event.imageUrl` automatically. Portrait flyers use `object-fit: contain`, not cover, so embedded text is not cropped. The detail view accommodates a larger flyer. Failed image loads revert to the mood-photo fallback. Events without uploaded artwork keep existing stock imagery.

- `POST /api/business/uploads/image`: authenticated multipart upload, one field named `image`; returns asset ID, public URL and dimensions. An active customer identity may upload for an independent event; organization/event editing still requires the appropriate permission.
- `GET /api/media/images/:assetId`: public, immutable WebP content with validated UUID filename, nosniff and cache headers. Artwork is public even for drafts. Do not upload private guest data or unlicensed artwork. Unpublishing/detaching does not revoke already shared/cached artwork URLs.
- Limits: static JPEG/PNG/WebP, ≤10 MB input, ≥128px in both dimensions, ≤20 million decoded pixels, ≤200 retained uploads per identity in this MVP. Decoder validates actual content, not filename/MIME. Animated files and SVG are rejected. Images are auto-oriented, resized inside 1600×2400, encoded as WebP, and EXIF/GPS metadata is stripped. See the [Sharp input safety options](https://sharp.pixelplumbing.com/api-constructor/) and [Multer limits](https://expressjs.com/en/resources/middleware/multer/).
- Metadata is stored in `media_assets`, referenced by `events.image_asset_id`; bytes persist in `apps/api/uploads/events` (git-ignored), or an absolute `MEDIA_UPLOAD_DIR` set on the API. Back up that directory alongside the database. Do not use ephemeral deployment storage. A local reseed removes database references but does not sweep uploaded files.
- Upload and event save are separate: cancelling an editor or replacing an image can leave an unattached asset. Files are intentionally not auto-deleted, preventing accidental removal from shared events. Add an age-gated orphan cleanup job, abuse limits, moderation, storage accounting, and an S3/CloudFront adapter before multi-instance AWS deployment. The local 200-asset check is not a concurrency-safe billing quota.
- `ImageUpload.jsx` owns the picker, progress/error UI and API call. `event-artwork.jsx` in Customer owns preferred artwork and fallback. Optional `VITE_API_URL` resolves media against the API origin for separate deployments.

## Permission contract

| Capability                            | Internal admin   | Organization owner/manager  | Event creator                     | Promoter                                | Unrelated customer |
| ------------------------------------- | ---------------- | --------------------------- | --------------------------------- | --------------------------------------- | ------------------ |
| Create organization event             | Any organization | Their organization          | Only with organization membership | No                                      | No                 |
| Create independent event              | Yes              | Yes                         | Yes                               | Yes                                     | Yes                |
| Edit event/tiers and guestlist limits | Any event        | Their organization's events | Their own event                   | No, unless separately a creator/manager | No                 |
| View complete event sales             | Any event        | Their organization's events | Their independent event           | Own attributed orders only              | No                 |
| Review guestlist                      | Any event        | Their organization's events | Their independent event           | Own active referrals only               | No                 |

Roles combine; no role selector grants access. `OrganizationOwner.role = admin` is the existing venue-manager representation. Employees have their own `OrganizationEmployee` membership and are not managers. Promoters have organization- or event-scoped referral membership; a person may hold multiple roles. Without a credited referral purchase, a team member's referred sales show zero. Event creation never gets mislabeled as sales attribution.

## Reporting definitions and bounds

- Gross sales = the sum of `Order.subtotalCents` for paid USD orders. It is not profit, bank settlement, or total consumer charges. Refunded/cancelled/pending orders are excluded; partial refund accounting is not modeled yet.
- Periods include the current UTC day and the previous N−1 UTC calendar days, through the time of the request. The date basis is `paidAt`, not event date. The chart fills days without sales with zero and does not invent percentage growth.
- Orders count checkouts; units count purchased tier quantities; admissions use historical `entriesPerUnitSnapshot`. Packages can admit multiple people. Neither figure is actual door attendance.
- Ticket/package breakdowns group historical `nameSnapshot` and `kindSnapshot` across events. Renaming a tier does not rewrite history. Event reporting retains the event's current title.
- An order is credited once: EventAffiliate takes precedence over OrgAffiliate. Recorded commission is the existing order commission amount, not a confirmed/settled payout. Direct/unattributed sales are displayed separately.
- Access scope is applied to the database query, not merely hidden in the browser. Owners see managed event orders; promoter-only scopes see only their own attributed orders and people. Exact addresses are only available inside authorized business event scopes; public privacy rules are unchanged.
- MVP safety bounds: at most 500 events per workspace and 10,000 orders per report, with a clear error asking for a narrower organization/period instead of silent truncation. Move to server-side pagination and grouped SQL/materialized reporting before larger portfolios exceed these limits.
- Basic reports currently work for both Free and Premium. Billing/feature-entitlement enforcement for the planned advanced Premium analytics is a separate milestone. This change does not alter pricing.
- The new `GET /api/business/analytics` report uses the same paid-USD, UTC and attribution definitions. Region and organization selections are OR within each field, AND across fields. Search selects matching events (including those with matching authorized customers or referrers) and then aggregates their paid orders; it does not isolate only the matching orders. It caps at 5,000 events and 20,000 orders, returning a narrowing error rather than silently truncating. The existing Overview report retains its earlier, tighter workspace bounds.

## Backend API and write safety

| Method / endpoint                                           | Contract                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/business/workspace?days=30&organizationId=<uuid>` | Scoped organizations/events/offerings, report, range, scope; omit organization for all; `independent` for independent events |
| `GET /api/business/analytics` | Permission-scoped portfolio, chart, and referral drill-down data; `days` or `startDate`/`endDate`, repeated `regions`/`organizationIds`, optional `search` |
| `POST /api/business/events`                                 | Validated event + nested location/offerings, atomic create; creator comes from session                                       |
| `PUT /api/business/events/:eventId`                         | Full editor document plus current `version`; role enforcement and atomic update                                              |
| Existing guestlist GET/decision/PATCH endpoints             | Approval queue and separate capacity pools                                                                                   |

Event writes use a serializable transaction, lock the event before offerings (same order as checkout), validate tier ownership, and record AuditLog before/after values. Existing tiers cannot disappear from an edit; deactivate them instead. Inventory cannot drop below units sold. The type/admissions of a sold tier cannot change. Historical OrderItem prices remain immutable. Organization reassignment is forbidden. Stale versions and concurrent writes return 409 with a reload/retry message. UI must not automatically replay a stale save.

Organization locations use the saved `Organization.locationId`; the additive event-workspace migration backfills existing organizations from their earliest located event. New organizations need a configured location before venue events can be created. Independent-event locations are copy-on-write. Address edits do not automatically geocode. UTC timestamps are derived from the location time zone, independent of the browser zone. Nonexistent spring-forward local times are rejected; ambiguous fall-back times use the converter's first matching occurrence—use a non-ambiguous time around clock changes until explicit offset selection is added.

Reference venue capacity is informational in the existing model, not an enforced overall paid-plus-free occupancy ceiling. Inventory is enforced per tier; direct and promoter guestlist caps are independent. Operators must configure combined occupancy responsibly. Cancellation does not automatically refund orders or notify attendees.

## Component map

| Source                             | Responsibility                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/App.jsx`                      | Sign-in, navigation, scope/period controls, dashboard, event search, CSV export, session lifecycle                         |
| `src/components/EventEditor.jsx`   | Accessible three-step create/edit dialog and dynamic tier forms                                                            |
| `src/components/Events.jsx` | Event library, timeline views, venue-local dates, search and lifetime sales |
| `src/components/EventDetail.jsx` | Event sales, tiers, people/commission controls and attendee purchase dialogs |
| `src/components/EventTable.jsx` | Shared searchable/sortable event tables with 10/25/50 pagination |
| `src/components/ui/slider.jsx` | shadcn-style Radix slider, including keyboard interaction |
| API `services/event-workspace-service.js` | Scoped full-event reporting, team selection, audited per-person commission changes |
| API `domain/event-policy.js` | End-time edit protection and shared tier-release availability |
| `src/components/Guestlists.jsx`    | Request review, status/event filters, direct/promoter limits                                                               |
| `src/components/Team.jsx`          | Authorized roster, invitations, member details, and 30-day referral figures                                              |
| `src/components/Analytics.jsx`     | Cross-portfolio filters, visualizations, region/event drill-down, and team/promoter referral drill-down                 |
| `src/components/controls.jsx`      | Labeled shadcn Select/Input composition and consistent empty states                                                        |
| `src/components/ui/*`              | Locally owned shadcn Button, Badge, Input, Dialog, Select, Tabs source; copied from the established customer component set |
| `src/lib/api.js`                   | Bearer fetch, validation error rendering, session loading                                                                  |
| `src/lib/business.js`              | Pure date/price/payload/filter/CSV helpers                                                                                 |
| `src/styles.css`                   | Business-specific tokens, layout, responsive rules                                                                         |
| API `services/business-service.js` | Permission-scoped queries, report aggregation, transactional event writes                                                  |
| API `http/business-schemas.js`     | Input and report-query validation                                                                                          |

## Design system

Business uses charcoal surfaces and restrained lavender accents, related to the customer nightlife palette but quieter for operational work. Avoid bright neon gradients behind data or multiple competing primary buttons.

| Token                  | Value     | Usage                              |
| ---------------------- | --------- | ---------------------------------- |
| `--background`         | `#13141B` | Application canvas                 |
| Sidebar                | `#101116` | Persistent navigation              |
| `--card`               | `#191A22` | Report panels                      |
| `--foreground`         | `#F4F3F9` | Primary text                       |
| `--primary`            | `#B9A9FF` | Primary actions, focus, chart line |
| `--primary-foreground` | `#21193D` | Text on lavender buttons           |
| `--border`             | `#30303D` | Subtle separators                  |
| `--muted-foreground`   | `#A5A5B8` | Supporting information             |

System sans-serif avoids a blocking font download. Tabular numbers support scanability. Corners are 8–13px, spacing follows a 4/8px rhythm, charts use one accent and low-noise grid lines. shadcn variables are mapped through Tailwind `@theme inline`. All application rules stay local to Business; customer/Admin styling is untouched.

Accessibility: use labeled inputs, visible keyboard focus, Radix-managed dialog focus/Escape, semantic tables, explicit status text rather than color alone, polite status/error messages, and a CSV alternative to charts. Reduced-motion preferences are respected. Desktop sidebar becomes a dismissible drawer below 850px. KPI cards become two columns; chart panels stack; wide tables scroll within their containers. Do not nest buttons in clickable rows. Drawer focus trapping remains a follow-up accessibility improvement; the main editor already uses Radix focus management.

## Tests and verification

```bash
# Fast API/domain and frontend-helper suites; no database needed
npm test
# Only business helper tests
npm test --workspace @nitewide/business
# Live PostgreSQL HTTP workflow (local DB must be running/migrated)
RUN_DB_TESTS=1 node --test apps/api/test/business-integration.test.js
# Production web builds
npm run build
```

The opt-in integration test creates UUID-isolated users, memberships, event tiers, attributed orders and requests, exercises signed-token requests with the dev identity shortcut disabled, and removes only its fixtures in `finally`. Never point it at production; it rejects non-local database hosts and production environments. It does not truncate/reseed or update existing records. Coverage includes unauthorized read/write isolation, event create/edit, promoter-scoped reports, sold-stock protection, optimistic conflicts, approval, separate caps, audit records, and independent customer-created events.

Browser smoke checklist: invalid/valid sign-in; organization and period selection; team/promoter and package/event tabs; CSV export; event search/status; all editor steps; saved draft/edit persistence; promoter read-only organization events; guestlist status/limits; sign-out; 390px mobile and desktop layouts; console errors.

## Explicit production follow-ups

This is a functioning local business MVP, not a claim of launch readiness. Existing payment endpoints still accept development payment confirmations; the business UI does not invoke payment/settlement. Ship verified Stripe webhooks/Connect before real-money use. Also add managed/secure-cookie auth, recovery/verification/revocation, rate limiting, stronger production-secret enforcement, pagination/aggregates, overall occupancy enforcement, role administration UI, fine-grained approval scopes, notification delivery, refund/cancellation operations, geocoding, S3/CDN image storage and moderation, real check-in UI, and Premium entitlement gates. No live payouts, SMS/email, billing, or CRM is simulated as complete in this app.

Dependency check (2026-09-21): `npm audit` reports two moderate findings in the existing Sequelize → uuid chain (GHSA-w5hq-g745-h8pq). The suggested automatic fix downgrades Sequelize across major versions and was not applied. Track an upstream-compatible remediation separately; the upload dependencies do not introduce the reported chain.
