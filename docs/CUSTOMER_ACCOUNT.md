# Customer account, tickets, and connections

The customer header uses compact Discover / VIP & tables / Saved navigation, notifications, and an initials avatar. The avatar opens Profile; the My nights tab opens purchases and guest passes, alongside Connections. There is no separate ticket shortcut. Signed-in customers find For business in the footer; signed-out visitors retain the header link.

## My nights

Purchases and guest list entries are read from PostgreSQL through authenticated `/api/customer/bookings`, including seeded orders and new demo orders. Upcoming/past is determined by the event's end timestamp, so live events remain upcoming. Dates display in the event's local timezone. Both appear in one chronological list, paginated ten entries at a time with stable ID and kind tie-breakers. Both render the shared `NightCard` component with identical artwork, spacing, layout and opening behavior; guest passes are labeled “Guest list entry,” with their party size and request status. Each receipt preserves its original item quantities, amounts, fees, and status.

Browser-only historical preview receipts are no longer treated as purchases. New checkout already records orders through `/api/orders`; reopening My nights refreshes from that source. Saved discovery favorites remain browser-local.

## Ticket QR codes

Each purchase is a clickable card with a miniature flyer (or the venue's existing fallback artwork). Opening it lists every owned admission QR in the purchase, including each admission in a package. `/api/customer/purchases/:id/tickets` is scoped to the purchaser and only includes credentials still held by that customer. Checked-in tickets remain visible with an individual violet highlight, check icon and entry timestamp; codes for void/transferred/refunded/cancelled/ended admissions are withheld. While open, the list refreshes every five seconds and on window focus. Returning restores the purchase list's exact scroll position and focused card. `/api/customer/tickets/:id` also supports individual valid-ticket retrieval. Both endpoints return PNG images with `Cache-Control: no-store`; credential hashes are not exposed.

The wallet signs a versioned credential using the server authentication secret and a distinct HMAC namespace, bound to ticket ID, event ID, holder ID and original QR hash. This supports existing seeded tickets without rotating their original credentials or adding plaintext secrets to the database. Changing any binding invalidates the signature. Secret rotation invalidates previously displayed wallet codes; retrieving the ticket produces a new signed code.

The existing `/api/check-ins` endpoint accepts both original QR tokens and wallet tokens, retains transaction locking and single-use state, and checks ticket payment and the event admission window. Refunded, void, checked-in, cancelled-event, wrong-event, forged, early, and ended-event ticket admission is rejected. Demo checkout remains local only; demo tickets are labeled and cannot be checked in in production. Camera scanner UI and live payment integration remain separate work.

Approved guest list entries open through customer-scoped `/api/customer/guestlists/:id/pass`. One QR admits the entire approved party, preserving existing capacity and single-use check-in rules. A separate HMAC namespace binds the entry, event, customer, party size and original credential; cancellation invalidates the pass. Pending, declined, cancelled and no-show requests display their status without an admission code. Scanned guest passes receive the same individual checked-in highlight as purchase admissions.

## Connections

Connections derive from a customer's paid referred purchases, confirmed/checked-in/no-show referred guestlists, and accepted guestlist invitations. The connection is to the person, across all organizations and venues where that person currently has access. For example, one promoter can appear at La Rosa Thursday, Room 22 Friday, Euphoria Saturday, and Eden Sunday. No previous visit to the destination venue is required.

The feed includes future published, discoverable events for active owners, managers, employees, organization promoters, independent creators, and event-only promoters. It revalidates current membership, referral windows, and event removal through the shared referral-link service. Stable event assignments may be created for eligible staff/creators as part of obtaining their link. The feed covers the next 100 eligible candidate events with all qualifying connections for those events. Customers can filter by person and reveal cards twelve at a time. It exposes public referrer names only, never their contact information or other customers.

Opening a card validates and applies that person's referral code for the destination event. Purchase and guestlist requests use the existing attribution services. The destination event's current commission applies to a new order; historical orders retain their snapshots. Business sales, customer, commission, analytics, and notification records receive the normal checkout updates. Being connected to someone does not grant them access to unrelated customer activity.

## Profile

Customers can edit display name, E.164-normalized phone number, and separate email marketing / transactional SMS / marketing SMS choices. Email is displayed read-only pending a verified email-change flow. Changes are audited; editing the number clears phone verification. No SMS or email provider is enabled by this feature. Role and account-status changes are rejected by strict input validation.

## Verification

Run `npm test`, `npm run build --workspace @nitewide/customer`, and `RUN_DB_TESTS=1 node --test apps/api/test/business-integration.test.js` against the local database. The database test cleans up its own fixtures. `customer-wallet.test.js` verifies QR binding, tampering, access boundaries, unavailable credentials, duplicate scans and admission/payment restrictions. Integration coverage includes seeded-style purchase retrieval, profile updates, past/upcoming classification, cross-organization repeat purchases at the destination commission, and removed-referrer filtering.

Browser checks: sign in, open My nights, click a miniature-flyer purchase card, view all its ticket QR codes, return to the same scroll position, switch to past orders, paginate, edit/save profile, open Connections, choose a referrer event, complete a demo order and verify both the refreshed wallet and Business event's recorded purchase/commission. Scan an admission through the authorized check-in endpoint and verify only that ticket receives the checked-in highlight.
