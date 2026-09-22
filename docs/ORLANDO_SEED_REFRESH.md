# Orlando seed refresh — September 22, 2026

## Scope and commands

```bash
npm run db:seed:orlando -- --dry-run
npm run db:seed:orlando -- --apply
# Purchase cleanup alone, also defaults to a preview:
npm run db:seed:clean-purchases -- --dry-run
npm run db:seed:clean-purchases -- --apply
```

Only a local, non-production database is accepted. Do not use the destructive `db:seed` command to refresh an existing workspace. The refresh consists of independently transactional, repeatable cleanup, organization grouping, venue provisioning and event import stages. A later download failure does not undo earlier completed stages; rerun safely after resolving it. Event insertion, offerings and promoter assignment are one atomic transaction.

## Purchase and guestlist rules

- Compare absolute event start/end timestamps, including overnight events. Intervals are start-inclusive, end-exclusive: one ending exactly when another starts is not a conflict.
- Multiple orders for the **same event** are allowed. The restriction concerns different simultaneous events for the same buyer.
- Guestlists can overlap other guestlists **and purchases**. Cleanup never alters guestlist rows or their check-ins.
- A removable order must be paid and all its payments must have provider `seed`. Browser mock checkouts (`demo`) and all other providers are protected. Keep protected orders first, then the earliest seed order with a stable ID tie-breaker.
- Remove the conflicting order's items, tickets, ticket check-ins, payments, purchase attribution and order-specific notifications. Decrement each offering's sold quantity in the same transaction; inconsistent inventory rolls back the cleanup.
- `order.seed_overlap_removed` audit entries retain the complete removed graph plus the retained conflicting order ID. These archives support manual recovery; there is no one-click restore command. Restore dependencies and inventory together inside a reviewed transaction, not by copying only the order row. Historical audit entries remain intact.
- Baseline and additive sales generation share a buyer selector that grows the customer pool if everyone is booked. It never queries guestlists. This is a **fixture rule**, not a new API/checkout restriction.

## Source coverage and matching

The fixed snapshot covers September 22 through October 21 inclusive, America/New_York, with end exclusive October 22. It contains 37 publicly verified occurrences in discovery order, including competing/overlapping listings retained in the fixture for auditability. Import keeps the first non-overlapping occurrence per physical venue. Existing events win over new overlapping imports; no event, sale or guestlist is deleted to make room for a flyer.

Public [Orlando discovery](https://posh.vip/explore-v2?location=custom&place=Orlando,+FL&lat=28.5383832&lng=-81.3789269) supplied matches for all six requested venues:

| Seed venue | Public listing name / example |
| --- | --- |
| Room 22, within Proper | [Room22 — Culture Code Friday](https://posh.vip/e/culture-code-friday-2026-9-26-6-0) |
| Elixir | [How a Sunset Sounds](https://posh.vip/e/how-a-sunset-sounds-orlando-2) |
| Sessions | [UCF College Night](https://posh.vip/e/ucf-college-night-free-21-rsvp-b4-1130pm) |
| Taco Kat | [Sport Mode](https://posh.vip/e/good-boi-presents-sport-mode-003) |
| The Robinson Cocktail Room | [The Social Room](https://posh.vip/e/the-social-room-orlando) |
| McQueens | [Bullit and Mcqueens — Berlin Techno Night](https://posh.vip/e/berlin-techno-night-2-story-building-takeover) |

Names tolerate casing, spaces, punctuation, prefixes and suffixes, with an Orlando address check. Combined Bullit/McQueens listings map to McQueens at the published 33 E Pine St address. Ambiguous multi-venue matches require review. Every occurrence has its own verified source URL, image URL and explicit offset timestamps in `apps/api/src/db/fixtures/posh-orlando-2026-09-22.js`; dates are not extrapolated from a weekly description or shifted forward after expiry.

Descriptions are concise paraphrases, not copied promotional articles. Culture Code supplies no description, so it receives a factual fallback. Perro Society's page explicitly publishes **10 AM** (not 10 PM); the fixture preserves and flags that source time. Paradiso lists doors at 7 PM but the scheduled music/event start at 10 PM; the latter is used with the doors note in its description.

Flyers are cached and normalized through the existing 10 MB image import path. Public availability is not a license: these are private local demonstration assets. Obtain organizer permission before publishing or using imported artwork commercially. Source ticket prices and policies are not copied into commerce: $10 GA and $300/$400/$1,000 packages remain clearly labeled Nitewide demo inventory.

## Organizations and teams

Room 22's existing events move to Proper while retaining their location IDs and addresses. Existing memberships move to Proper, duplicate memberships consolidate, existing financial commission snapshots stay unchanged, and both sets of managers keep access. This preserves the combined staff roster; standalone venue fixture counts are not a limit on the shared organization. The old Room 22 organization is archived as `closed`, with a `organization.demo_consolidated` audit record, rather than erasing its history. The model currently stores event locations rather than a separate Venue entity; this refresh does not add a multi-location event-editor workflow.

Five new organizations each have a demo owner, 1–3 managers and 9–12 employees. Imported new-venue events receive two event-only promoters at 8%/10% commissions and 20-person allocations. An active promoter is reused only when no active, non-cancelled event assignment overlaps; otherwise additional demo promoter identities are created. They can work across organizations without duplicate User identities. Existing unrelated promoter assignments are not rewritten.

## Verification

```bash
npm test --workspace @nitewide/api
RUN_DB_TESTS=1 node --test apps/api/test/seed-cleanup-integration.test.js apps/api/test/posh-importer-integration.test.js apps/api/test/seed-team-integration.test.js
RUN_ORLANDO_SEED_TESTS=1 node --test apps/api/test/orlando-seed-integration.test.js
```

Unit coverage includes overnight/adjacent intervals, same-event repeat purchases, protected mock orders, buyer-pool growth independent of guestlists, venue aliases, snapshot bounds and first-source overlap precedence. Isolated database coverage checks guestlist preservation, inventory reconciliation, full audit archives, idempotency and import atomicity. The team report contract checks the combined Proper/Room 22 roster against Overview and Analytics.

Applied local result on September 22: 896 conflicting seed orders archived and removed, 396 paid orders retained (including both browser-created mock purchases), all 548 guestlist entries retained, 30 events imported, and 7 conflicting candidates skipped. Five organizations received 11 managers, 53 employees and five owners total. Eight additional demo promoters were needed to fill busy time slots without overlaps. Post-refresh verification found zero buyer purchase overlaps, zero new-venue promoter assignment conflicts and zero sold-inventory discrepancies. These are fixture counts, not product limits or production sales.
# Room 22 listing correction — September 22, 2026

The user-requested Culture Code Friday listing replaces the existing September 25 Room 22 Friday Nights event **in place**: Friday September 25 at 9 PM to Saturday September 26 at 2 AM, America/New_York, using the verified Posh flyer and source details. Its UUID and public slug stay unchanged, preserving existing orders, offerings, tickets, referral assignments, and guestlists. `replace-room22-friday.js` checks venue and buyer purchase overlaps, records an audit entry, and is idempotent. The local application was verified to preserve all child-record fingerprints (including two orders and eight guestlist entries).

This explicit replacement is separate from the additive importer, which continues to preserve edited events. It runs in the unified seed and Orlando refresh before additive imports. It does not rename Room 22 to its parent organization, Proper.
