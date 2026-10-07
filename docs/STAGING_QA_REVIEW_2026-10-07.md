# Staging application review October 7 2026

Four new synthetic accounts completed normal staging signup: customer, organization manager without finance access, organization employee, and event-only promoter. Core free admission, guestlist approval, referral sharing, admission, and organizer messaging journeys passed on the reviewed release. Three deployed workflow defects need correction before launch; two additional recovery risks were identified in source review. No paid transaction or live payment was performed.

## Release verification

| Evidence | Result |
| --- | --- |
| Review commit and image digest | `ec82adde94e068435c222404b44202e0f9f1e2e5`; `sha256:2452867c6910a936968cb87da2d39b9c571596570382adfdaa12b39e18f258bd` |
| GitHub CI for that commit | [Run 37660597470](https://github.com/Demesheo/nitewide/actions/runs/37660597470) succeeded October 7 at 17:44 UTC, with overall elapsed time 6m 16s: unit/API, four browser lanes, image build, verification, publication and staging deployment. |
| Render API on that revision | Matching digest live: `dep-db389e142hec738th7hg`. |
| Render worker on the same revision | Matching digest live: `dep-db389p2d0e5s73ff0bng`. |
| Staging readiness requiring the worker | Independently checked HTTP 200 at 17:44 UTC; `x-nitewide-environment: staging` and exact commit in `x-nitewide-revision`. Customer, Business and Admin entry pages and all referenced JS/CSS assets returned 200. |
| Local readiness checks | Business unit checks 216/216, including 7/7 editor checks; API unit checks 639/639; all 33 PostgreSQL 18 integration suites passed, including 25/25 selected payment-account checks. Business production build and API contract check passed. |

The exact image and API/worker release were verified before account creation. Two transient worker-readiness responses during the rolling deployment resolved once the new worker became ready. Deployment health does not establish payment readiness. See [Render release setup](RENDER_RELEASE_SETUP.md) and the [production launch checklist](PRODUCTION_LAUNCH_CHECKLIST.md).

## Test accounts and credentials

The customer registered normally. The Staging Test owner issued copied invitations for the manager, employee and promoter. Each new invitation opened signup automatically, and each recipient accepted using the invited identity after explicit user approval for terms acceptance and the scoped grants. Unique `@nitewide.test` addresses prevent real email delivery. No demo seeding, reset endpoint or administrative role shortcut was used.

The manager has no finance permission. The employee has organization-level access. The promoter has only the dedicated QA event, no organization membership, and zero commission. The manager assigned four guestlist spots through normal event controls; the promoter used two for a synthetic personal invitation. The original Test Friday Night event and its existing customer booking were not modified.

Credentials, account scopes and fixture details are in the private local file `test-results/staging-qa-2026-10-07/credentials.md`, covered by the existing Git ignore with file mode `0600`. Private invitation and pass-link files are also Git-ignored and owner-readable only. Passwords, session tokens and private invitation/pass links are excluded from this report. Screenshots and detailed persona notes remain in the same private artifact directory.

## Deployed role journeys

| Role | Completed workflow | Observed permission boundaries | Result |
| --- | --- | --- | --- |
| Customer | Signup, login/logout, discovery/search, free claim, five-spot guestlist request, approval notification, four distinct passes, organizer message/reply, support case | No My events navigation; Business sign-in explicitly refuses customer-only access; sign-out removes private booking content | Passed; booking-list cache issue below |
| Manager | Invitation signup/acceptance; Overview; dedicated event creation/publication; paid-tier save with automatic readiness; approval from five spots to four; promoter allocation; organizer reply | Merchant finance/account/delegation controls absent; personal commissions remain separate; role choices do not include Owner; Admissions excludes events outside the admission window | Passed; custom-address editor issue below |
| Employee | Invitation signup/acceptance; own event/referral views; manual check-in; duplicate-entry prevention; Customer My events and own operation summary | No event creation/editing, finance or allocation management; own attributed guestlist empty despite other QA guests; Customer Booked empty | Passed; invitation landing issue below |
| Promoter | Invitation signup/acceptance; referral copy; two-spot personal invitation; signed-out private-link pass view; own approved guestlist; Customer My events; logout | Exactly one assigned QA event; unrelated event deep link returns Event not found; no organization management, event editing or merchant finance; only own team row and guests | Passed on desktop; signed-in phone review remains open |

At a 390px phone viewport, Customer booking/profile/message controls and Manager navigation/editor were usable without document overflow; Employee check-in completed at phone width. The Customer message dialog stayed within the viewport and used internal scrolling. Temporary viewport overrides and QA-only tabs were cleaned up. Browser viewport checks do not establish physical iPhone behavior.

## Shared customer and event journey

The dedicated QA event was published for October 7, 6–10 PM America/New_York, using a synthetic custom address. The manager added a $10 paid tier and saved it in place with automatic Stripe readiness; no trip to Payments was required. Customer-facing paid pricing showed the upfront $11.64 total and $1.64 fee, while the free tier showed Free without a fee. Free claim displayed no card, wallet or payment form.

The customer claimed one free ticket and requested five direct guestlist spots. The manager reduced approval to four. The notification said the customer was approved for four spots for the QA event; the detail view exposed exactly four independently identified ready passes and disabled Next after the fourth. The employee admitted the free ticket once; a second attempt displayed Already admitted and Do not admit again. The customer view updated automatically to Checked in.

The promoter copied a referral and created a two-spot personal guest invitation from the four-spot allocation. The private link opened while signed out and showed two distinct ready passes, confirming that no guest account is required. Both promoter guest passes remain unused.

The customer sent a synthetic booking-linked organizer message; the non-finance manager replied and the customer received the reply. A separate Nitewide support case retained the QA event, organization and selected free booking, with status open. Organizer messages and support conversations remained in separate inboxes. Admin-side case reply and status resolution were not exercised in this persona review.

## Reproduced workflow defects

### Custom address events reopen as unavailable saved venues

P2, Business Manager. Initial creation selected the organization's legacy Test Spot even though no linked Business Venue was available, producing Business venue not found. Choosing a custom address allowed publication. Reopening that address-based QA event again selected Use saved business venue and showed Selected venue unavailable / Business venue not found despite the saved address remaining correct. Choosing custom address is a workaround; the re-edit was canceled without rewriting the event location.

Initial creation definitively seeds the organization location in `apps/business/src/lib/business.js:84` without checking that it has an OrganizationVenue link. `EventLocationStep.jsx:8` then treats the populated Location ID as saved mode, while the venue API requires that organization link. The custom-address re-edit failure was reproduced, but the precise reason for its saved-mode selection needs further tracing: `editorDraft` already attempts to distinguish address locations from managed venues. Avoid unresolvable defaults and preserve valid address-mode editing. Local evidence: `manager-mobile-edit-unavailable-venue.png`.

### Employee acceptance lands on an unavailable management page

P2, Business Employee. Signup and invitation acceptance succeeded, then the app opened Organization/Team and displayed Team and venue management are available only where you are an owner or authorized manager. Access restrictions were correct; the successful onboarding destination was wrong.

`apps/business/src/App.jsx:200` chooses Team for every organization invitation, although the accepted role is available. Route employees and organization promoters to Overview or their events, retaining Team for roles permitted to manage it. Local evidence: `employee-accepted-landing.jpg`.

### Booked summaries retain the old spot quantity and event date

P2, Customer. After opening the four-spot approval notification, the detail showed four correct passes and the current event date. Back to my nights still displayed Approved with five guests and the event's previous date. Refresh bookings corrected both fields. No fifth pass was issued.

`apps/customer/src/components/account-dialog.jsx` stores booking-list data separately from fresh pass detail. Notification/detail loads do not reconcile the list, and pass polling merges only guestlist status at line 69. Back at line 214 returns to the old list; Refresh at line 229 reloads it. Reconcile the complete fresh booking and invalidate/revalidate the list on notification and return, preserving scroll and date-period sorting. Test request five → approve four plus a date change, then notification → Back without manual refresh.

## Recovery risks from source review

These paths were not induced on deployed staging and are distinct from the reproduced defects.

1. P2: invitation acceptance can commit before `/auth/me` fails. `apps/business/src/components/Team.jsx:238` retries the entire acceptance, but `apps/api/src/services/team-service.js:211` rejects an already-consumed invitation. Preserve the accepted result/session and retry identity refresh only, for both existing-account and new-account acceptance.
2. P2: `apps/business/src/components/Guestlists.jsx:83` copies fetch failures into independent local error state without clearing them after recovery. The initial failure can also present You're all caught up at line 257 without a list/pool retry. Separate mutation and fetch errors, expose retry controls and avoid success-like empty states after a failed load.

## Smaller polish findings

- A free claim increased the Manager Sales label Paid orders to one while sales remained $0. Free fulfillment correctly stores a completed order with `status=paid` and `paymentProvider=free`; the reporting count uses status only. Rename the metric Orders or split paid orders and free claims, without breaking the free fulfillment status.
- The organizer-side send confirmation says The organizer's reply will appear here even when the manager is the organizer-side responder. Use role-appropriate confirmation text.
- A new promoter's personal Payments page leads with dense provider/reconciliation explanations before the empty commission state. A shorter actionable empty state would improve first use.
- The public Business landing page still describes working messaging, Stripe onboarding and QR admission as planned/in development. Align product copy with launch scope without claiming that live payments have been verified.
- The long event artwork puts the booking action below the fold. Consider a compact sticky action on phones after validating that it does not obscure content or dialogs.

## Coverage limits and follow up

The role journeys above establish deployed behavior only for the stated synthetic organization/event and reviewed revision. Historical/past-event workflows, export persistence, forced network-failure recovery and mobile promoter-specific pages remain follow-up checks. Cross-account private booking/message deep-link denial tests require additional explicit scope confirmation and were not performed. Ordinary own-attributed views and the promoter's unrelated event denial passed. See [automated browser testing](UI_TESTING.md), [customer account behavior](CUSTOMER_ACCOUNT.md), [event operations](EVENT_OPERATIONS.md) and [admissions](ADMISSIONS.md).

Regular staging runs with `NODE_ENV=production`, which disables `/api/admin/demo-users`. Copied invitations worked while the essential-only mail policy suppresses team/promoter invitation email. Synthetic `.test` identities cannot verify actual verification-email or password-reset delivery. Cross-domain authentication is origin-scoped; signing into Customer does not automatically sign into Business. Customer login also shares local storage between tabs on the same browser profile, so persona testing must coordinate exclusive ownership of that origin or use separate browser profiles.

README currently describes manager invitations as owner-only, while the Business Team UI and invitation service permit an organization member with management access to invite a manager. Confirm the intended policy and align its documentation; this discrepancy is code evidence, not a deployed authorization finding.

## Remaining production checks

Physical iPhone camera permission, autofocus and low-light QR scanning remain required before door operations; desktop or phone viewport emulation cannot prove them. Real verification/reset delivery, provider-confirmed sandbox checkout/webhooks/refunds, production resources, backup/restore and production release approval require their own evidence. This staging review does not approve production launch or enable live payments.
