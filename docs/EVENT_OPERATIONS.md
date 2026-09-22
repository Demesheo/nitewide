# Business event operations

## Run locally

From the repository root:

```sh
npm run db:migrate
npm run dev:api
# In another terminal:
npm run dev:business
```

Open `http://127.0.0.1:5174/app` and use a README demo account. Restart a running API after backend changes. The additive `202609220001-event-workspace` migration adds `Organization.locationId` and `Offering.releaseAfterOfferingId`. It preserves orders and seeds; no reset or reseed is required. It selects each existing organization's earliest event location as its saved venue address. New demo seeds explicitly save the venue's location on its organization.

## Library and event detail

- Upcoming & live, Past, Drafts, and All events are based on stored start/end times and status. Past includes events whose end time has passed and explicitly completed events. Cancelled future events appear under All events.
- Search covers titles, venue names, and cities. From/Through dates are inclusive event-start dates in each location's time zone.
- Event-list sales and orders cover full paid USD event history, independent of the Overview date filter. Organization filters remain limited to authorized workspaces.
- Open an event for Sales overview, Tickets & packages, or Team. Sales overview includes the attendee table; there is no separate attendee tab. Charts split revenue by offering and direct/referrer role. All tables support sorting and 10/25/50 rows. Team defaults to Sales descending; attendees default to Total spend descending; tier sales also start highest first.
- Clicking a customer opens their contact details, guestlist state, and historical purchased items with referral sources. Spending is recorded Nitewide event purchases, not unrecorded bar/venue spending. Buyers, ticket holders and guestlist requesters may differ. Anonymous package guests are represented by admission credentials, not invented customer identities.
- Sales are paid-order subtotals; payments include customer fees; commission earnings use stored order amounts. This is not a processor settlement or payout reconciliation report. Fully refunded/cancelled orders are excluded from paid sales. Partially refunded accounting needs the future refund ledger.
- The attendee table in Sales overview shows **Total spend**: ticket/package subtotals before fees. It does not display the fee-inclusive customer-payment column.
- Active admissions count valid/checked-in tickets; guestlist places count confirmed/checked-in party sizes. Checked in combines tickets and checked-in guestlist party members. These are admission counts, not deduplicated physical people across both pools. Declined, pending, cancelled and no-show requests do not consume approved guestlist places.

## Roles and locations

Organization owners/managers can configure events for their authorized organizations. A user's creator attribution on an organization event does not grant management after their organization role is removed. Independent creators can configure their own independent events. Internal administrators retain support access.

Basic employees/promoters can read event metadata but only their own referred orders, earnings and guestlist customer details. They cannot edit events, select referrers, change commissions, or read direct/other people's sales. Independent events retain the single User identity: an existing customer can become a creator without a separate account.

The editor has no category or URL-slug inputs. Existing slugs/categories remain stable; new events receive an automatic unique slug and generic category. New venue events default to the organization's saved venue location. Editing preserves the event's existing venue location even if the organization's default differs; client-supplied addresses cannot override it. The read-only card uses the venue name and says “Uses venue’s saved address.” Place & access omits time-zone fields and technical zone labels; the saved location zone is retained internally. Independent mode permits entering an address and privacy setting, retains an existing event's zone, and defaults new independent events to America/New_York for the current Florida launch. Address-based time-zone resolution is still needed before offering this simplified independent-event editor outside that zone. An organization without a saved default venue location must have that profile configured before creating venue events; there is no unrestricted venue-address override in this editor. Selecting among multiple saved venue profiles is a separate extension to the present organization-default creation flow.

Once `endsAt <= now`, or status is completed, business event configuration is read-only. Server checks protect saving event details/tiers, new offerings/referrers, commission changes/removal, and allocation changes. Checkout also stops at the event end. Historical reporting remains available. Internal admin support overrides are separate from this business workflow.

## Admission release rules

Each ticket or package can have optional opening/closing timestamps. A higher-priced tier can reference an earlier limited tier of the same type with positive stock. Forward/self references, cycles, cross-type prerequisites, unlimited predecessors, and non-increasing price ladders are rejected. Reservations can have windows but cannot join a ladder.

Example: create 50 GA tickets at $10, 50 at $20 linked to the first tier, then 100 at $40 linked to the second. A linked tier opens when its predecessor **sells out, reaches its sales stop time, or is closed manually** by unchecking Sales enabled and saving. Its own sales start time must also have arrived, and its own stop time must not have passed. A date-only tier has no predecessor requirement. Re-enabling a manually closed predecessor or increasing its inventory may put a successor back into the waiting state; review the ladder before saving. Closing a tier never alters completed purchases.

The editor sends `releaseAfterIndex` for a preceding tier. The API resolves it to a persisted offering ID within one transaction, including newly created tiers. Historical tier IDs cannot be silently removed. Checkout locks the event before inventory, checks the stored release rule/windows, and records original prices and admission counts. A higher tier cannot be purchased in the same checkout that would finish the prerequisite tier: it opens for the next checkout after that sale commits.

Public event responses provide `saleState`: `on_sale`, `scheduled`, `waiting_for_tier`, `sold_out`, or `closed`; manually closed tiers are not shown publicly. Customer purchase controls disable locked tiers and explain when they open. An already open customer page may need Refresh to see a tier unlocked by another purchase; the API always enforces the latest state.

## Team selection and commissions

Owners/managers see the full active venue roster by default, including employees with no event assignment or sales. Each person appears once, with zero metrics when there is no activity. Active owners, managers and employees automatically receive referral codes for every event at their venue at 0% commission, unless an event override exists. Their referred sales are tracked even at 0%. Basic employees/promoters still see only their own performance; eligibility does not grant management permissions or guestlist capacity.

Team members without an event commission display **0%**. Columns start Person, Role, Commission. Click the person's name (keyboard accessible) or row to see performance and commission in a dialog, with editing and removal available only to authorized managers for unfinished events. Past-event and non-manager dialogs are read-only. The table has no inline edit buttons or selected/unselected labels; explicitly removed referrers retain a history label.

Open an unfinished event → **Team**, then click a person's name or row. The **Team** table starts Person, Role, Commission, Sales. Its Roles multiselect lists only roles present in the full roster (before filtering), supports multiple roles, and defaults to all. There are no Add person or Edit commissions toolbar buttons. The person dialog lets authorized owners/managers/independent creators adjust rates without changing the person's venue role. Past events remain read-only.

Employee referral codes use `STAFF-<OrganizationEmployee.id>`; owners and managers use `LEAD-<OrganizationOwner.id>`. Codes appear in the person's event Team dialog before any commission is saved, and the same membership code works across that venue's events. Checkout/guestlist requests validate venue membership and active account status and lazily create a zero-rate EventAffiliate for durable attribution. No team-member-by-event backfill, reseed, or migration is required. Explicit event rates/removals win over the default. Auto-created event codes also validate the corresponding membership, so removed members cannot keep using them. Guestlist requests remain pending until approved and require an allocated pool before approval; referral eligibility itself allocates no places. Existing promoter selection rules and management permissions are unchanged.

### Event-only promoter invitations

**Add promoter** opens an email invitation with a 0–40% commission slider (0.5-point steps, 0% default). The invitation records the offered rate, shows it before acceptance, and applies it to future referred sales when accepted. Existing paid orders and earned commissions are not recalculated. Venue owners/managers and independent event creators can invite people specifically to an unfinished event. The recipient registers a customer account or signs into their existing identity and accepts using the invited email. Acceptance creates/reactivates only an EventAffiliate, never an OrgAffiliate or employee/manager membership. Other roles and memberships remain intact. Managers can subsequently change event-only promoters' commissions or remove them from the event using their person dialog.

Event-only promoters have their own event sales, performance/commission data, customer drilldowns and referred guestlists, in Events, Overview, Analytics and Guestlists. They cannot see direct or other people's sales/guestlist entries, access other venue events, view the venue team, change commissions or invite others. Their guestlist pool starts at zero; an owner/manager must allocate capacity before approvals. They can review only requests referred by themselves.

Links expire after seven days or at event end, whichever is earlier. Only hashed tokens are stored. Renewing a pending invite invalidates the previous link and preserves the displayed offered rate; creating another invitation for that email can revise the offer. Revocation expires the pending link. Accepted, expired, revoked and past-event invitations cannot be accepted. The inviter must still be an active authorized event manager at acceptance.

**Delivery limitation:** there is no automatic email provider configured. Create invitation generates a private link; Copy link shares it manually, and Email invitation opens a prefilled email in the operator's mail app to send. The UI does not claim an email was sent. Automatic transactional email delivery remains future work.

Run `npm run db:migrate` and restart the API. Migration `202609220002-event-invitations` adds nullable event scope and offered commission to TeamInvitation, with a database constraint requiring either venue scope or event-only promoter scope. Existing organization invitations are preserved; no reseed is required.

Each selected individual has an event-specific 0–40% commission. The slider changes in 0.5 percentage-point steps, and the API accepts integer basis points from 0 to 4000. Zero is an explicit override. Commission applies to referred order face value, excluding the customer's service fee. The UI shows an example on a $100 sale.

Only event managers may add, change or remove people. Updates lock the event before the person's assignment and create an AuditLog. Checkout stores the commission rate in `pricingPlanSnapshot.commissionBps` and the earned amount in `affiliateCommissionCents`; existing orders are never recalculated. Older seeded orders retain their original recorded amounts even if they have no explicit rate snapshot.

Removal marks the EventAffiliate inactive, preserving references, prior earnings and approved guestlists. Both event-specific and linked organization referral codes are blocked for new purchases on that event. Adding the person again reactivates the same assignment. This selection controls future attribution, not automatic commission payouts or marketing consent. New assignments default to zero guestlist allocation; managers can configure independent guestlist pools on Guestlists.

## API

| Endpoint | Behavior |
| --- | --- |
| `GET /api/business/workspace` | Authorized events now include `canEdit` and `lifetimeSales`; organizations include their saved location |
| `GET /api/business/events/:eventId/detail` | Full-event scoped report, metadata, tiers, people, customers, channels, and manager-only roster candidates |
| `POST /api/business/events` | Create with organization location or independent location; automatic slug |
| `PUT /api/business/events/:eventId` | Version-checked edit of unfinished event and tier configuration |
| `PUT /api/business/events/:eventId/people` | `{ userId OR email, commissionBps, status: active OR inactive }`; manager-only, unfinished events |
| `GET /api/business/events/:eventId/invitations` | Manager-only pending invitations and offered rates; no tokens returned |
| `POST /api/business/events/:eventId/invitations` | `{ email, commissionBps: 0..4000 }`; create/renew event-only promoter link; response explicitly marks manual delivery |
| `DELETE /api/business/events/:eventId/invitations/:invitationId` | Revoke an unaccepted event invitation |
| `GET /api/team/invitations/:token` | Preview event/venue scope and offered event commission |
| `POST /api/team/invitations/:token/accept` | Authenticated invited identity; add only the invitation's scoped role |

Existing generic commerce model names remain OrgAffiliate and EventAffiliate. User-facing text says promoter/referrer. Overview keeps its existing workspace/report size bounds. Event detail aggregates one event's authorized paid history; large-event server pagination and reporting aggregation should precede high-volume production rollout.

## Verification

```sh
npm test --workspace @nitewide/api
npm test --workspace @nitewide/business
npm test --workspace @nitewide/customer
npm run build --workspace @nitewide/business
npm run build --workspace @nitewide/customer
RUN_DB_TESTS=1 node --test apps/api/test/business-integration.test.js
```

The integration test uses isolated UUID fixtures in a local non-production database and cleans only those fixtures. It verifies location tampering, role isolation, different individual rates, historical commission preservation, sellout/date gates, public availability, promoter removal through both referral codes, attendee spend totals, past-event protection, and independent creator assignment. Unit tests cover date boundaries, invalid tier ladders, report reconciliation, and frontend event filtering/payloads.
