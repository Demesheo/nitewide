# Internal admin management

Admin is the platform operations/support application. Every endpoint requires an active, completed internal identity and an operation-specific permission. Server-paginated directories and canonical detail pages replace bulk record dumps. Admin access never authorizes silent historical-payment edits.

| Resource | Controls and boundaries |
| --- | --- |
| People | Secure invitations, confirmed profile/contact edits, scoped roles, suspend/archive/restore. No admin-set passwords or permanent delete. Self/last-admin and last-owner protection. |
| Businesses | One organization model, optional venues, profile/plan and lifecycle actions. Hidden server-generated slugs; no editable business type. |
| Venues | Organization-scoped, searchable/paginated create, rename/edit, lifecycle and team actions. One owner organization per managed venue. |
| Ownership/finance | Secure invitations and atomic accepted transfers, explicit outgoing role, audited recovery and last-owner protection. Manager finance grants are separate. |
| Events | Full shared editor: flyer/content, venue-local schedule, offerings and publication. Preview affected attendees for material changes. Preserve sold offerings and admissions. |
| Support | Cases, priority/status/assignee, canonical business/event/person/purchase links and paginated audit. Platform alerts are not routine business guestlist tasks. |
| Performance | SQL drill-down and stable full CSV snapshots. Fees/proceeds/modelled contribution are distinct; order metrics are not multiplied by offering rows. |
| Purchases/payments/tickets/check-ins/audit | Read-only context and existing guarded domain transitions. No provider refund, payment rewrite, historical purge or storage-object deletion. |

## Onboarding and ownership

`POST /admin/onboarding` accepts recipient, organization profile, optional initial venues, authority confirmation and audit reason. Initial contact may be owner or manager; manager-led setup does not imply ownership/finance. Response reports queued/unavailable, never a raw setup token/link. Resend/revoke require reason and version. No separate independent-creator capability is granted to new businesses; legacy access remains compatibility data.

Onboarding preview is non-consuming/redacted. Acceptance requires password confirmation for a new account or an authenticated matching existing account without credential overwrite. It rechecks inviter, scope/account/membership versions, consumes once and grants the chosen role. Expired/revoked/replayed/stale invitations fail atomically.

Ownership controls use `/admin/businesses/:organizationId/access`. Adding an owner preserves co-owners. Transfers explicitly identify outgoing owner and manager/employee/removal outcome, activating atomically after incoming acceptance. Retained managers do not inherit finance permission. Recovery requires separate confirmation/reason. Business owners can separately grant/revoke manager finance permission.

## Venue identity and scale

`OrganizationVenue` establishes managed ownership; its location ID is exclusive across organizations. `Location` also holds event-address snapshots, so matching name/city/address does not establish ownership. Venue-only manager/employee/promoter grants are distinct from organization-wide roles and imply no finance permission. Venue event writes require the exact linked organization/location; moving an event rechecks destination authority.

Manage venues individually through scoped routes. Generic organization edits cannot replace all venue links or edit the internal default pointer. Search/filter before pagination with authoritative totals. Organization detail returns a venue count, not every venue ID. Conflicting legacy ownership causes an explicit migration failure, never silent reassignment.

## API patterns and retention

Support-case lists accept repeated `statuses` query parameters (`open`,
`in_progress`, `resolved`, `closed`) with OR semantics, at most eight values,
and no duplicate rows. A single value is accepted; omission or an empty
selection shows all. Search, category and identity/business scopes still combine
with AND before count and pagination. Legacy `status` remains supported, but a
non-`all` legacy status together with nonempty `statuses` returns 422 rather
than choosing an ambiguous filter.

Management metadata: `GET /admin/management/resources`. Directories: `GET /admin/management/:resource` with bounded page/pageSize (max 100), search, allowlisted sort/status/direction and supported canonical scope filters. Detail: `GET .../:id`. Safe PATCH edits require version/reason. Actions use `POST .../:id/actions/:action`; unsupported operations fail explicitly.

People search accepts name, email, normalized phone or exact UUID. Repeated `statuses=active&statuses=suspended` values use OR and combine with the search/scope; an empty selection means all statuses. Do not combine `status` with `statuses`. Event directory dates use `startDate`, `endDate` and an IANA `timezone`; bounds are inclusive local calendar dates and are applied before SQL pagination.

Person-context related lists accept `userId`. Purchases use buyer identity, tickets use holder identity, and attendance uses the ticket/guestlist subject—not the scanner. Team and guestlist invitations add `relation=sent` or `relation=received` (received is the default); received matches accepted identity or current email/normalized phone. Venue assignments are inspected through `venue_access` and changed through venue team controls, not arbitrary record patches. Related rows resolve names in bounded batch queries; scoped search matches relevant person, business, venue and event context without downloading full directories.

Events use `GET /admin/events/:id/editor`, `POST /admin/events` and `PUT /admin/events/:id`; generic record writes cannot bypass that workflow. Offering/commission writes share editor viability rules. Legacy organization creation also generates slugs server-side. See [OpenAPI](api/openapi.json) for executable schemas.

Writes recheck authority within the transaction, follow locking/version rules and audit reasons. Sensitive credential/token/QR/email fields are excluded. Suspension preserves existing passes; archive/cancellation are distinct. Restore does not republish, refund or erase history. Payments remain modeled demo transactions until separately approved Stripe work.

## Staff and tests

Platform owner has all internal capabilities. Operations reads directories/reports and manages events/cases. Support inspects directories and manages cases, not financial reports/business access. Read-only inspects directories/reports/cases/audit without mutation. Ownership, finance and internal staff role changes require platform-owner authority.

Required Node/Supertest/PostgreSQL suites cover acceptance/transfers, role/finance isolation, lifecycle, reporting, snapshots, support transactions and price safeguards. Browser interaction tests exercise the rebuilt admin at iPhone and desktop sizes. Tests clear provider credentials and use disposable fixtures; email simulations remain explicit opt-ins. See [Testing](TESTING.md).
