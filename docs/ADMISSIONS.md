# Admissions and mobile check-in

Business **Admissions** is available in the sidebar and mobile bottom navigation. Select an authorized, published event whose admission window is open: **24 hours before its start through 24 hours after its finish**, inclusive. Times are enforced by the API; moving a phone's clock cannot open an event. Draft, cancelled, and completed events are excluded. Event choices refresh every 30 seconds.

## At the door

- **Scan QR:** Start camera requests the phone's rear camera, with inline video on iPhone. A signed customer ticket or approved guestlist QR is decoded locally and submitted once. The camera stops while the result is displayed. **Scan next** explicitly restarts scanning.
- **Scan a photo:** Opens the native camera/photo chooser as an alternative. Images stay in the browser; only the decoded credential reaches the API.
- **Manual check-in:** Search by customer name, email, or the pass ID displayed beneath their QR. Filter All, Ready, or Admitted. Select **Admit**, verify identity, and **Confirm entry**. Each package ticket is an individual admission. An approved guestlist code admits the entire party; the confirmation states the number of spots.
- **Confirmed** (green) means the transaction committed. **Already admitted** (amber) includes the genuine credential's prior admission time and does not record another check-in. **Invalid** (red) covers fake, altered, revoked, unpaid/refunded, and wrong-event codes. An unreadable photo also displays Invalid with instructions to try again.
- Connection or server failures display **Check-in not confirmed**. No offline admission queue exists. Retry after reconnecting; if the first request committed but its response was lost, retry returns Already admitted.

Camera frames are never stored or uploaded. Camera tracks stop after a decoded pass, when leaving Scan QR, closing the view, or backgrounding the page. A denied/busy/missing camera offers manual recovery. Use HTTPS on physical iPhones; plain HTTP on a LAN IP is not a secure camera context. Desktop localhost is supported for development. The hosted Render origin provides HTTPS.

## Access and credential integrity

Internal admins, organization owners/managers, active organization employees, independent event creators, and active event-assigned promoters can admit guests. Expired automatic staff/leader referral records do not preserve access after organization membership is removed. Every roster read and check-in rechecks authorization. Promoter admissions do not grant event editing, guestlist approval outside their existing scope, or access to another person's financial reports.

Tickets use signed `nw1` wallet tokens; guestlist passes use signed `nwg1` tokens bound to the current approval, holder, event and party size. Legacy random-token QR credentials remain supported. The selected event is part of every lookup. Authenticity is checked before returning Already admitted, preventing forged codes from revealing admission history.

The existing `tickets`, `guestlist_entries`, and `check_ins` tables remain the source of truth. A single PostgreSQL transaction locks the credential, checks its state and paid-order eligibility, updates it, and inserts the admission record. READ COMMITTED plus row locks serializes competing scans; unique credential constraints on `check_ins` provide a second duplicate safeguard. QR and manual entry share this path and record the operator, timestamp, and `qr`/`manual` method. No new migration is needed.

## Synchronization and reporting

The Admissions roster and headcount refresh every eight seconds, on focus and after a check-in. Open customer passes refresh every five seconds and on focus, updating each admitted ticket's existing highlight independently. Guestlist parties contribute their approved party size, rather than one scan, to attendance counts.

Event details, customer histories, guestlist status, workspace summaries, and analytics derive attendance from these same credential states. Workspace summaries refresh after admission and on navigation/focus. Sales and commissions are unchanged by admission. Report attendance remains subject to the report's existing date range and financial/referral scope; Admissions shows the full selected event's door headcount. Admissions responses contain no QR hashes, payment totals, fees or commission data.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/business/admissions/events` | Authorized events in the server's admission window |
| `GET /api/business/admissions/events/:eventId` | Paginated credentials and admitted/expected headcount; `search`, `status=all\|ready\|admitted`, `page` |
| `POST /api/check-ins` | QR: `{ eventId, qrToken }`; manual: `{ eventId, credentialId, kind: "ticket"\|"guestlist" }` |

Success returns HTTP 201. Duplicates return 409 / `CREDENTIAL_ALREADY_USED`; invalid credentials return 422 / `INVALID_CREDENTIAL`; a closed event returns 409 / `EVENT_NOT_OPEN`; access failures return 401/403. Responses use `Cache-Control: no-store`.

## Verification

Run `npm test` and `npm run build`. For real PostgreSQL verification:

```sh
RUN_DB_TESTS=1 node --test apps/api/test/admissions-integration.test.js
```

This test is restricted to a local, non-production database. It creates and removes UUID-scoped fixtures and checks authorization, scan authenticity, concurrent attempts, individual package tickets, whole-party guestlists, manual entry, customer passes and report reconciliation. It does not reseed the database.

The GitHub Demo image workflow runs this integration test against its disposable PostgreSQL service before publishing or deploying the demo image.

Browser verification covers genuine ticket and guestlist QR images, duplicate and invalid results, manual confirmation, small-screen layout and customer status refresh. A physical iPhone camera field test remains necessary before live door operations; desktop viewport emulation cannot verify iPhone camera autofocus, low-light performance, or Safari permission prompts.

Implementation references: [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [ZXing browser](https://github.com/zxing-js/browser).
