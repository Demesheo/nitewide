# Staging application review October 7 2026

This review covers Customer and Business workflows for synthetic customers, managers, employees and promoters on the staging domains. Deployment verification must finish before creating test accounts or accepting role invitations. The current status is preparation: no review accounts have been created and no signed-in staging journeys have been completed.

## Release verification

| Evidence | Result |
| --- | --- |
| Review commit and image digest | Pending |
| GitHub CI for that commit | Pending |
| Render API on that revision | Pending |
| Render worker on the same revision | Pending |
| Staging readiness requiring the worker | Pending |
| Local readiness checks | Business unit checks 216/216, including 7/7 editor checks; API unit checks 639/639; all 33 PostgreSQL 18 integration suites passed, including 25/25 selected payment-account checks. Business production build and API contract check passed. |

Successful CI must publish the reviewed image, and `/health/ready?requireWorker=true` must confirm the expected staging revision and a current matching worker before account creation. Deployment health alone does not establish payment readiness. See [Render release setup](RENDER_RELEASE_SETUP.md) and the [production launch checklist](PRODUCTION_LAUNCH_CHECKLIST.md).

## Test accounts and credentials

Create a customer through normal registration. Use the existing synthetic Staging Test organization and its owner's copied invitations for manager, employee and promoter access. Use unique `@nitewide.test` addresses; the email service refuses sends to that domain. Invitation acceptance must use the invited identity. New accounts require current terms acceptance. Do not use demo seeding, reset endpoints or administrative role shortcuts.

A new manager receives no finance permission. Organization employee invitations do not require a managed venue. An event-only promoter receives access to the selected event without organization membership; new promoter invitations start with zero commission and zero guestlist allocation. Any capacity needed for the review must be explicitly configured through normal event controls. Confirm the actual chosen promoter scope in the results.

Store credentials only in the private local file `test-results/staging-qa-2026-10-07/credentials.md`, which is covered by the existing Git ignore, with file mode `0600`. Record each role, email, generated unique password, organization/event scope and reviewed release there. Passwords, session tokens and private invitation/pass links must not appear in this committed report. The credential file has not yet been created.

## Planned role journeys

| Role | Workflow | Permission and isolation checks | Deployed result |
| --- | --- | --- | --- |
| Customer | Register; discover/search/date; save; request guestlist; open Booked and notification; view pass; contact organizer/support | Business and My events access denied; another customer's booking, pass and messages inaccessible; unpaid checkout produces no admission | Not executed |
| Manager | Accept invitation; review Overview; inspect/edit event; manage Team; approve guestlist and create copied invitation; admit guest; inspect Analytics/export | Finance controls absent by default; finance delegation unavailable; unrelated organization/event inaccessible; past event configuration read-only | Not executed |
| Employee | Accept invitation; inspect personal performance and My events; copy referral; manage own referred guestlist; admit assigned event guests | No event creation/editing or commission changes; direct and other referrer sales/guest contacts inaccessible; unrelated organization inaccessible | Not executed |
| Promoter | Accept scoped invitation; inspect own performance/referral; manage referred guestlist; open assigned Admissions | Event-only access does not create organization membership; no event editing, other referrer sales or other people's earnings | Not executed |

Exercise the shared application checks once: deep-link reload, browser Back, search/pagination persistence, empty/error/retry states, clipboard recovery and profile/session logout. Inspect the distinct role pages on desktop and a 390px phone viewport for readable controls, keyboard focus, dialog dismissal, internal table scrolling, touch targets, QR visibility and fixed-navigation overlap.

One shared guestlist journey should connect the roles: customer request, manager approval, exact customer notification/pass, employee or promoter admission, duplicate admission rejection and customer status refresh. Paid offering checks must retain honest unavailable messaging when Stripe is disabled or unready; free and guestlist workflows should remain usable. Do not infer successful payment from a healthy deployment or a checkout redirect.

## Code and offline evidence

Current code and isolated browser coverage support registration, invitation acceptance/renewal, customer booking and pass recovery, guestlist approvals, promoter scope, admissions, manager finance denial and mobile/desktop layouts. This coverage uses disposable fixtures and does not establish that those journeys work on the deployed staging domains. See [automated browser testing](UI_TESTING.md), [customer account behavior](CUSTOMER_ACCOUNT.md), [event operations](EVENT_OPERATIONS.md) and [admissions](ADMISSIONS.md).

Regular staging runs with `NODE_ENV=production`, which disables `/api/admin/demo-users`. Normal copied team invitations remain available when staging's essential-only mail policy suppresses team/promoter invitation email. Synthetic `.test` identities cannot verify actual verification-email or password-reset delivery. Cross-domain authentication is origin-scoped; signing into Customer does not automatically sign into Business.

README currently describes manager invitations as owner-only, while the Business Team UI and invitation service permit an organization member with management access to invite a manager. Confirm the intended policy and align its documentation; this discrepancy is code evidence, not a deployed authorization finding.

## Deployed observations and findings

No deployed role findings yet. Record each confirmed issue with role, page/workflow, expected behavior, observed behavior, reproduction, severity and supporting screenshot or response evidence. Keep speculative polish suggestions separate from reproduced failures. Record passed journeys and remaining blockers against the reviewed release.

## Remaining production checks

Physical iPhone camera permission, autofocus and low-light QR scanning remain required before door operations; desktop or phone viewport emulation cannot prove them. Real verification/reset delivery, provider-confirmed sandbox checkout/webhooks/refunds, production resources, backup/restore and production release approval require their own evidence. This staging review does not approve production launch or enable live payments.
