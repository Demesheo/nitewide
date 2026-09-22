# Event referral links and demo commerce

Every active owner, manager, employee, independent creator, organization promoter, and event-only promoter can request a personal link for an authorized, unfinished event. The customer URL contains both the event ID and a stable referral code. Opening it validates the code server-side, records one visit per browser session, opens the event directly, and keeps attribution scoped to that event through sign-in, registration, guestlist requests, and checkout.

Removed team members, inactive users, inactive assignments, ended events, and mismatched venue memberships cannot create or use links. Employees, promoters, owners, and managers receive separate codes even when their commission is zero. Commission, role, and customer attribution are snapshotted on completed orders; later commission changes do not rewrite history.

Local development checkout posts to the real order API with payment provider `demo`. It creates order items, test admission credentials, inventory changes, referral attribution, commission snapshots, audit records, notifications, and analytics rows. The order snapshot is marked `demo: true`, the business event page labels it **Demo**, and the customer UI states that no charge occurred and the credential is not valid for entry. The API rejects `demo` checkout when its configured environment is production.

Business event details include the personal share link and a Recorded purchases table with customer, tickets/packages, referral source, face-value spend, transaction type, and recorded time. Purchase notifications identify the customer, order contents, sale, and commission for the referrer and authorized event leadership. Guestlist request notifications contain the request ID and open the relevant event/request; approval, decline, and cancellation notifications return the customer to the event.

Referral reporting uses the same attribution source across Event detail, Overview, and Analytics. Each team row includes paid orders, face-value sales, recorded commission, requested guestlist places, and approved guestlist places. Guestlist-only customers remain visible with zero sales and zero commission. Direct guestlist requests remain event-level activity and are not credited to an individual referrer. Guestlist activity never creates revenue or commission.

Current in-app notifications are the source of truth. Email and SMS adapters remain future work and must be implemented through an idempotent outbox with verified contact information and consent enforcement.

## Validation

Run:

```sh
npm run db:migrate
npm test
RUN_DB_TESTS=1 npm test --workspace @nitewide/api
npm run build
```

The written tests cover link authorization across roles, unique codes, invalid and removed links, visit deduplication, event-scoped customer referral state, demo checkout production blocking, inventory and credential creation, referral notifications, commission attribution, business-side purchase visibility, and cross-report reconciliation. The attribution matrix covers owner, manager, employee, organization promoter, event-only promoter, and independent creator roles at commission rates from 0% through 40%; it also proves later rate changes do not rewrite completed-order commission snapshots. Browser validation should exercise sign-in, a shared link, the referred checkout label, demo confirmation, and the matching Demo row in Business → Events → Sales overview.
