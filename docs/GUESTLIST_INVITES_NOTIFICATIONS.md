# Guestlist invitations and in-app notifications

## What works now

From the Business app's Events → event details → Share this event card, an organization owner or manager, or an independent event creator, can invite a guest into the event's direct pool. They can also use their own event allocation when one is active. Employees and promoters can invite only into their own active event allocation, and only when its effective limit is greater than zero. The invitation form takes one email **or** phone number and a party size. The API checks permissions and available people-capacity, not just the browser. Request review and capacity controls are in that event's Guestlist subtab.

An existing account matching the email is confirmed immediately if the pool has space. A phone number auto-matches an existing account only if exactly one active account has that **verified** number. Otherwise the Business app returns a seven-day private link for the host to share manually. New guests register through that link, using the invited email or phone; an existing guest may sign in and claim it. At claim time, the server locks the event and checks the direct or personal allocation again. A pending invitation does **not** reserve capacity. Full or closed events do not prevent account creation; the guest sees that their guestlist place was not confirmed. Invitations are one-use after successful claim. Existing guestlist entries cannot be silently replaced by an invitation.

Both apps have a signed-in notification inbox with unread counts and mark-as-read. The server currently records guestlist requests for their authorized reviewer, approval/decline/revocation for customers, confirmed invitations for customers, purchase confirmations, and sold-out offering alerts for organization owners/managers or independent creators. Notifications are created transactionally with the underlying action and are scoped to the recipient. They are not emails or texts. The API lists the newest 50 non-dismissed records per user; retention/pagination need a production policy.

Customer booking notifications open **Booked** directly to the referenced purchase or guestlist entry and its QR credentials, not the event sales dialog. Purchase notifications use `metadata.orderId`; approvals and accepted invitations use `metadata.entryId`. Old invitation records missing an entry ID are resolved at read time against that recipient's own event guestlist entry. Deep links retrieve the exact booking independently of list pagination and select the matching upcoming/past period. Missing or unauthorized records show an error and retain the notification.

Once a booking opens successfully, its notification is dismissed from the inbox. **Clear all**, at the upper left opposite the close button, dismisses all of the signed-in user's notifications, including records beyond the current 50-item list. Migration `202609230002-notification-dismissal` adds nullable `dismissed_at`; records are retained, not deleted. Dismissal survives refresh and excludes records from unread counts. Both dismissal endpoints require authentication and scope to the recipient. Business notification navigation is unchanged.

## Local verification

```bash
npm run db:migrate
npm test --workspace @nitewide/api --workspace @nitewide/business --workspace @nitewide/customer
RUN_DB_TESTS=1 node --test apps/api/test/business-integration.test.js
npm run build --workspace @nitewide/business
npm run build --workspace @nitewide/customer
```

The new migration only adds `guestlist_invitations` and `notifications`; it does not reseed or alter existing guestlist entries. The database integration fixture tests direct and personal pools, owner/staff/promoter boundaries, immediate confirmation, email and phone signup claims, full-capacity behavior, notification access, purchase alerts, and sold-out alerts. It deletes only its own test records.

## Provider integration path and launch gates

1. Add an append-only notification outbox with an idempotency key, delivery attempts, retries, dead-letter state, and per-channel templates. An in-app record is the source of truth; a worker sends email/SMS asynchronously. Do not send inside the purchase or guestlist transaction.
2. Verify email ownership and phone possession before relying on contact matches or sending sensitive links. Today email signup has no verification, so immediate email-account matching is an MVP trust limitation. A private invite link is a bearer secret and must be treated like one. Phone-only invitations are never auto-matched to an unverified existing number. Normalize/uniquely claim verified numbers and handle changed or shared numbers.
3. Add email delivery (transactional provider), then Twilio SMS behind the existing `transactionalSmsConsentAt` and `phoneVerifiedAt` fields. Invitation contact information supplied by a host is **not** the recipient's SMS marketing consent. Marketing messages require separate `marketingSmsConsentAt`/`marketingConsentAt`, unsubscribe and suppression lists; no marketing send is implemented here.
4. Add scheduled reminders based on event-local time, check-in/purchase state, opt-outs, quiet hours, reschedules and cancellations. Include actionable pending-approval reminders and sold-out alerts without flooding a sole operator. Make jobs idempotent and record delivery results.
5. Customer Booked now retrieves purchase and guestlist QR credentials from the authenticated API. Harden recovery and production door-entry operations before live rollout. Never place QR secrets in notification text or logs. Also add invite cancellation/reissue and abuse throttles before broad rollout.

The invitation API is `GET /api/business/events/:eventId/guestlist-invite-pools`, `POST /api/business/events/:eventId/guestlist-invitations`, and `POST /api/guestlist-invitations/:token/claim`. Registration accepts optional `guestlistInviteToken`. The authenticated inbox uses `GET /api/notifications`, `POST /api/notifications/:id/read`, `DELETE /api/notifications/:id` (dismiss one), and `DELETE /api/notifications` (clear all). DELETE soft-dismisses records only; it never changes the booking, tickets, or guestlist allocation.
