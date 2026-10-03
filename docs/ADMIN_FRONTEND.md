# Nitewide Admin

Admin is the internal operations console at `http://localhost:5175`. It uses Business-style dark surfaces, lavender controls, responsive tables and the shared event editor. Every API request checks the active internal identity and the capability required for that operation; hiding a button is not authorization.

## Local access

Start PostgreSQL, apply migrations, then start API and Admin:

```sh
docker compose up -d postgres
npm run db:migrate
npm run dev:api
npm run dev:admin
```

Seed only when deliberately preparing a demo database (`npm run db:seed`), not as a routine restart. Existing demo admin: `admin@nitewide.test` / `NitewideDemo!2026`. Admin verifies its bearer session on reload. Temporary network/server failures retain the stored session for a retry without exposing the workspace until verification succeeds; authentication denial clears it. No development identity-header shortcut is used by the frontend.

## Navigation

| Section | Purpose |
| --- | --- |
| Overview | Financial/performance metrics and admin-specific attention items. |
| Businesses | Organization directory, profile, ownership/finance, venues and Access requests awaiting manual review. |
| Events | Inspect the flyer, edit with the full shared creator editor, cancel/archive with history retained. |
| People | Inspect identities, access and bookings; invite, edit, suspend/archive within staff permissions. |
| Support | Cases, record links, priorities, status, assignment and audited history. |
| Messages | Private Nitewide support conversations, accessible from the header without adding another primary navigation item. |
| Analytics | SQL-backed drill-down and stable full-result CSV exports. |
| Audit | Paginated retained platform history. |

Detail pages have related tabs and contextual actions. Returning preserves directory/report filters and pagination. Small edits use dialogs; event edits use the full Business editor. Significant time/venue changes and cancellation preview the attendee count and enqueue the same notices as business changes. Queued is not proof of delivery; refunds are not automatic. Flyers render proportionally with missing/unavailable fallbacks.

## Organizations and venues

All new businesses use one organization workspace, including solo creators and promotion groups. Organizations can have zero, one or many exclusive managed venues. Business type, server-generated slugs and the legacy default-location pointer are not normal editing controls. Existing stored classifications/identities remain compatibility data. Events may use their own physical name/address without claiming ownership of that location.

Onboarding accepts an initial owner or manager. The contact verifies email and sets their own password, or signs into the matching existing account before accepting access. Admin never chooses or receives the password or setup token. Secure ownership additions/transfers activate only after acceptance; transfers explicitly retain the outgoing owner as manager/employee or remove access. Manager finance permission is separate.

### Business access requests

Businesses → Access requests provides a searchable, status-filtered, server-paginated review queue; pending requests also appear in Overview's admin-specific Needs attention list. Open a request to read the contact, intended role and business description. Authorized platform owners can approve through the existing onboarding form, verify the applicant's authority, configure optional venues and record a reason, or decline with a reason. Support, operations and read-only staff may inspect but cannot grant access.

Request submission does not send mail or create a business. Approval atomically creates the organization and secure invitation and requires queued delivery; unavailable delivery leaves the request pending and preserves the form for retry. A stale review returns a conflict rather than creating duplicate access. Approval is not activation: the invited contact must verify/accept access before entering Business. The submitted email is locked during review; ordinary manual onboarding remains available for separately verified contacts.

Venue lists and team choices are searchable and server-paginated. Venue-only assignments do not create organization-wide membership or grant another venue's operations/finance access. Physical event-location snapshots remain distinct from managed-venue ownership. See [Internal admin management](ADMIN_MANAGEMENT.md) for boundaries.

## Analytics and exports

Primary path: Business → Event → Offering → Purchase, with direct Customer/Team views and optional Region/Venue exploration. Canonical links open individual records without losing report context. Reporting retains archived history. Custom dates use the selected IANA timezone and inclusive end date; Region means event location, not headquarters.

Face-value sales, buyer-added fees, business-absorbed fees, combined fees, commissions, business proceeds and modeled Nitewide contribution are separate metrics. Order-level fees and unique customers are not counted once per offering. Cost/contribution figures are modeled snapshots, not provider-confirmed settlement or accounting profit; this phase has no live Stripe reconciliation.

Tables paginate in SQL. CSVs include the full authorized filtered result, not the visible page. Small exports are immediate; large exports prepare a stable snapshot with progress, download, retry and expiry. Staff capability is rechecked on export access. See [Reporting and snapshot exports](REPORTING_EXPORTS.md).

## Private support conversations

Customer and Business footer links open Contact Nitewide in the existing Messages interface. Each submitted issue creates an Admin support case and a separate private conversation. Messages includes explicit search, multiselect case-status filters and bounded pagination; a conversation links to its case, and the case links back. Event, booking and organization context is optional and validated against the requester's current access. Organizer conversations and refund requests remain separate.

Staff with `support.view` may inspect messages; replies and case changes require `support.manage`. Resolved/closed cases are read-only for replies. Requesters see their case status and public conversation, never internal resolution notes, assignments or audit details. Signed-in replies/status changes produce generic in-app notifications, not email.

The signed-out form is limited to account-access help. Submitted names/emails are unverified and never associate the conversation with an existing account. Its private recovery link contains a capability in the URL fragment; only a hash is stored server-side. The link grants conversation access, not account access, and expires after 90 days. Admin must independently verify ownership before changing any account.

## Guardrails and later work

No permanent-delete UI/API. Suspension/archive retain IDs, bookings, admissions and audit. Organization suspension blocks new sales, invitations and business changes while honoring existing passes/admissions; event cancellation is separate. Credential/QR hashes, provider identifiers, encrypted email payloads and storage keys are not editable. Contact-change, last-owner/admin, capacity and pricing protections are enforced server-side.

Platform owner has full access; operations manages events and reads reports; support manages cases and inspects directories; read-only inspects directories/reports/cases/audit. Ownership, finance and staff access changes remain platform-owner controls. Full self-service business configuration, reconciliation, disputes/refunds and step-up controls remain separate work; the current Request access form is a review intake, not self-service provisioning.

## Verification

```sh
npm test
npm run test:e2e
npm run build
```

Default tests use mocks or generated disposable databases and consume zero email quota. Rebuild browser coverage runs in iPhone/WebKit and desktop/Chromium; the obsolete admin browser spec stays inactive. See [Testing](TESTING.md) and [Automated browser testing](UI_TESTING.md).

## Responsive admin design standard

### Human operator first

This is a console for a human platform owner/operator, not a database browser. Design from the operator's question or task: find a person or business, understand an event or purchase, resolve an issue, inspect performance, and take an authorized action. Primary navigation opens the relevant human-facing directory or workflow. Do not make the operator choose database record types from a generic “Records” dropdown before they can work.

Find memberships, invitations, referrals, purchases and admission activity by opening the related person, business, event or purchase. Use clear contextual tabs and labels; preserve search, date filters, pagination and return context. Surface identity, status, important dates, location and the next useful actions first. Keep IDs, versions, storage/provider fields and audit mechanics secondary or internal. Retain the underlying granular capabilities and server authorization; simpler presentation must not remove operational controls or require bulk loading.

Review every future admin change against this principle, in addition to the mobile/desktop requirements below. This standard remains in force until the platform owner changes it.

Every admin UI change must work at both a 390px phone viewport and a 1440px desktop viewport. Start with a readable single-column mobile layout, then use CSS Grid to group related information and make productive use of desktop space. Desktop is a required design target, not a stretched mobile stack. Avoid unexplained empty space, repeated record titles or raw database-field lists.

Record headers put the identity, state and essential context together. Event headers include a proportional thumbnail, local date/time and physical location, with contextual controls alongside on desktop and within reach on mobile. Flyers stay compact and uncropped; missing or unavailable artwork has a clear fallback. Description, admission settings, related records and administrative metadata are separate groups. IDs, versions and history timestamps are secondary, not the dominant content.

Use semantic headings, associated form labels, visible keyboard focus, meaningful image alternatives and at least 44px touch targets on mobile. Preserve reading order when introducing desktop columns. Text and controls must wrap without page-level horizontal overflow; large tables may scroll inside their own labeled container. Loading, empty, error and retry states must remain usable at both sizes.

Directories and relationship choices use searchable server pagination. Do not replace a paged directory with an enormous selector or download all relationships into the browser. Canonical record navigation retains the originating report or parent-record context. Keep Business styling and shared creator capabilities intact, and verify interactions plus responsive geometry in both iPhone/WebKit and desktop/Chromium coverage. This standard does not authorize new service-worker or offline behavior.

Search is explicit: typing updates a draft only; click Search or press Enter to apply it and return to page one. This applies to directories, analytics, support, related records and choices inside forms. Enter inside a choice search must not submit its enclosing edit/onboarding form. People search supports name, email, phone (ignoring punctuation) and an exact user ID. Status filters are multiselects wherever offered, including Businesses, Events, People and Support cases; selected states are combined with OR, and clearing the selection shows all states. Editing an individual record still chooses one status.

Businesses, Events and People use the same desktop search input/button widths, search icon and placeholder styling, with Businesses as the reference. Status sits above the search, left-aligned. Search and Sort by/Direction share a desktop row; sorting is right-aligned. Events groups compact Start/End dates beside sorting on the right, wrapping safely on narrower screens. Selecting or clearing a valid date applies immediately without applying or discarding a pending text-search draft. There are no Apply dates or Reset dates buttons. Mobile controls remain readable, at least 44px tall, and free of horizontal overflow.

Motion should clarify changes, not delay operation: use short dialog/content transitions and clear loading feedback. Honor `prefers-reduced-motion`, avoid animating large tables or every row, and preserve form state, focus, touch-target sizes and layout stability throughout transitions.
