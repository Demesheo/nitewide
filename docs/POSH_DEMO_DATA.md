# Orlando Posh demo snapshot

Verified September 21, 2026. Window: **September 21–October 20, 2026**, inclusive of local start dates, in `America/New_York`. This is a reviewed snapshot, **not a live Posh integration** or a guarantee that listings remain available.

## Coverage

| Existing organization | Imported events | Source series / dates (all 2026, Eastern) |
| --- | ---: | --- |
| Euphoria Downtown | 4 | [Rew1nd Saturdays](https://posh.vip/e/rew1nd-saturdays-2026-9-27-6-0): September 26; October 3, 10, 17; 10 PM–2 AM next day |
| Eden | 4 | [Tequila & Touchdowns](https://posh.vip/e/tequila-touchdowns-2026-9-27-2-0): September 26; October 3, 10, 17; 6–10 PM |
| La Rosa | 8 | [Broke A$$ Thursday$](https://posh.vip/e/broke-a-thursday-2026-9-25-6-0): September 24; October 1, 8, 15. Orlando After Dark: September 27; October 4, 11, 18. All 10 PM–2 AM next day |
| OHM (formerly Tier) | 7 | [First Class Fridays](https://posh.vip/e/first-class-fridays-2026-9-26-6-0): September 25; October 2, 9, 16. Orlando 2016 Party: September 24. Jayy Laurent: September 27. Jada Fish: October 10. All 10 PM–2 AM next day |

One-off sources:

- [Orlando 2016 Party — OHM](https://posh.vip/e/orlando-back-to-school-copy)
- [Hottie Hot Line / Jayy Laurent — OHM](https://posh.vip/e/hottie-hot-line-jayy-laurent-live)
- [Jada Fish / Playground Saturdays — OHM](https://posh.vip/e/jada-fish-live-playground-saturdays)
- [Dead Drunk / Orlando After Dark — La Rosa](https://posh.vip/e/dead-drunk-orlando-after-dark)
- [Only the Drunk Survive — La Rosa](https://posh.vip/e/orlando-after-dark-only-the-drunk-survive)
- [Orange Cup vs Nakpin Warz — La Rosa](https://posh.vip/e/orlando-after-dark-orange-cup-vs-nakpin-warz)
- [Pink Out / Libra Bash — La Rosa](https://posh.vip/e/orlando-after-dark-pink-out-the-biggest-libra-bash)

In the September 21 snapshot, no upcoming match was verified for Room 22, Parlay, Proper, Celine, Aura, Shakai, Fixtion, or The Beacham. Research included the [public Orlando directory](https://posh.vip/explore-v2?location=custom&place=Orlando,+FL&lat=28.5383832&lng=-81.3789269), organizer pages, and venue-specific search. Absence from that snapshot does not mean a venue has no events. Other cities, unrecognized venues, past dates, and occurrences beyond the window were excluded. That original import creates no organizations. The [September 22 expansion](ORLANDO_SEED_REFRESH.md) subsequently verified Room22 and five additional venues, grouped Room 22 under Proper, and added separate repeatable provisioning/cleanup commands.

## Content and matching decisions

- Tier → OHM was confirmed by the user and the source's matching address, **20 E Central Blvd**. The existing organization ID, `tier` slug and memberships stay intact. Fresh baseline seeds use OHM. Historical event titles/locations are not rewritten by the additive import.
- Euphoria and Eden match both venue names (including displayed aliases) and street addresses.
- La Rosa matches the existing Orlando venue name, but Posh lists **49 N Orange Ave / ground level**, not the old seed's **123 W Church St**. Imported La Rosa events get a new source-backed location. The old location and Aura organization are untouched; sharing an address does not merge organizations.
- Source pages and recurring date chips supply date/time facts. The URL suffix and image alt-text timestamps are **not** reliable local start times. Explicit `-04:00` offsets preserve EDT and overnight end dates.
- Some Connect 4 detail pages omit the end time; their Orlando discovery cards explicitly show **10 PM–2 AM**. This provenance is recorded with the event.
- Written descriptions are concise paraphrases. Six Connect 4 pages have no written About section, so they receive clearly recorded factual fallback descriptions using only title, host and venue. No attendee identities, profile images or contact details are imported.
- 11 source flyers are validated, resized and converted to WebP using the same image validation as uploads (10 MB / 20 MP maximum). They are served from Nitewide's own public media endpoint, not hotlinked in the customer app. Their source URLs remain in the fixture and audit log.
- Rew1nd's September 26 detail page showed sales closed while its recurring dates remained listed. Source availability is recorded, but **not mirrored as live Nitewide inventory**.

## Safe local import

From the repository root, with PostgreSQL running and migrations applied:

```sh
npm run db:seed:posh -- --dry-run
npm run db:seed:posh -- --apply
```

The default is dry-run. Preview validates the snapshot and checks existing organizations/owners without downloads or database writes. Apply is additive and refuses production environments and non-local database hosts. **Do not run `db:seed` to update an existing database**: that original baseline command truncates data.

On apply:

1. Preflight every venue and owner; never create a missing venue implicitly.
2. Download only missing reviewed flyer assets from the allowlisted public Posh image host, without cookies or credentials. Redirects, invalid formats and oversized downloads fail closed.
3. Insert locations, media metadata, events, offerings, EventAffiliates and provenance in one database transaction protected by an advisory lock.
4. Preserve existing events and user edits. Stable source-occurrence IDs make reruns skip already imported events; they do not reset stock, sales, guestlist requests or pricing.

Original accounts, orders, tickets and guestlist records remain untouched. New imported events have no simulated paid orders or admissions. They inherit the existing venue owner and active affiliates, with a demo direct guestlist cap of 50 and an additional 20 per commission-bearing promoter; staff inherit their organization allocation. Existing role checks and request/approval rules remain in force.

For UI testing, each imported event receives the existing sample tiers: **$10 GA**, **$300 regular**, **$400 premium**, and **$1,000 Clase Azul / 1942**. These are not copied Posh prices or real offers. Event descriptions, summaries and tier descriptions identify this distinction. Source listings may have free RSVPs or different ticket terms.

Flyers cache in `apps/api/uploads/events` (or `MEDIA_UPLOAD_DIR`), which is git-ignored. Back it up with the database. A failed DB transaction can leave unreferenced cache files; a retry reuses them. Do not delete the upload directory to reset this importer. It also contains user-uploaded images.

## Fresh seeds and expiration

The unified `npm run db:seed` now appends this snapshot after creating its baseline fixtures on a local, non-production database. The first run needs network access for uncached flyers. For a deliberately offline baseline reset only:

```sh
npm run db:seed --workspace @nitewide/api -- --skip-posh
```

Only future starts within the actual next 30 days are imported. This snapshot never moves historical dates forward or invents more recurrences. Once its dates pass, it adds zero events. Refresh the reviewed fixture with new verified pages rather than changing the snapshot dates. Existing imported events are not deleted on expiration.

## Files and verification

- `apps/api/src/db/fixtures/posh-orlando-2026-09-21.js`: reviewed sources, explicit dates, summaries, images, aliases and coverage.
- `apps/api/src/db/posh-importer.js`: validation, restricted downloads, stable IDs, demo tiers, additive import and audit trail.
- `apps/api/src/db/import-posh.js`: safe preview/apply command.
- `apps/api/test/posh-importer.test.js`: scope/date/URL validation, stale snapshot handling, pricing and download bounds.
- `apps/api/test/posh-importer-integration.test.js`: opt-in real-PostgreSQL import, concurrency, repeatability, preserved edits and transactional failure; cleans only isolated test fixtures.

```sh
node --test apps/api/test/posh-importer.test.js
RUN_DB_TESTS=1 node --test apps/api/test/posh-importer*.test.js
RUN_DB_TESTS=1 npm test
npm run build
```

These are local demo assets, not proof of a license or authorization to sell tickets for the organizers. Obtain appropriate image/content permissions and organizer authorization before any public deployment, commercial reuse or real sales. Importing a listing does not establish a partnership with Posh, a venue or an organizer.
