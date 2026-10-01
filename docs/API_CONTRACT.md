# API contract and domain boundaries

The executable contract is available at `GET /api/openapi.json`. Its reviewed,
deterministic OpenAPI 3.1 artifact is [api/openapi.json](api/openapi.json).
Generation is local and offline: it constructs model metadata and route
registrations without connecting to PostgreSQL, loading secrets, or sending email.

```sh
npm run api:contract        # regenerate after reviewing a route/schema change
npm run api:contract:check  # fail if the committed artifact is stale
npm run test:api:unit
npm run test:api:integration -- --suite api-domain-contract-integration.test.js
```

The ordinary unit suite checks artifact parity, registration parity, unique
operation IDs, local schema references, and shared validator identity. These tests
run in the normal CI gate; no quota-consuming email command is invoked.

## Registration and shared rules

`apps/api/src/routes/index.js` composes account, customer, business, admissions,
reporting, admin, and public modules. It retains the existing paths, service
injection interface, and export-service lifecycle hook. App-level health, media,
webhook, background-job, and diagnostic operations have supplemental contracts.
No external documentation renderer or CDN is required.

Every domain operation must appear in the closed route inventory. Registration
captures the actual body validator and references the shared query and parameter
validators. Adding an undocumented operation fails at startup. Success statuses
are explicit, including immediate CSV responses and accepted asynchronous exports.
Retired bulk-report routes remain documented as deprecated HTTP 410 operations.

Legacy management controllers delegate to domain services rather than writing
records themselves. Both event-editor and legacy event creation use the same
transaction-aware authorization, lifecycle, offering, capacity, audit, and email
outbox primitives. Event-person changes use the event-workspace service. Existing
sold-offering protections and historical records remain intact. Legacy omitted
commission values retain their previous zero default; no pricing policy changes
are introduced here. Guestlist pool usage is calculated in one grouped aggregate,
not one query per affiliate.

Authentication runs before request validation. Internal-admin authorization also
runs before validating internal operations; mutation services repeat authorization
inside the transaction fence. This avoids exposing internal validation details to
ordinary business or customer accounts. Structured failures include a domain code,
safe message, optional details, and request ID.

## Coverage and limits

Core response schemas validate IDs, dates, money/count integers, event and offering
states, sessions, guestlist results, admissions, report pages and summaries, export
jobs, and errors. Dynamic admin bodies expose the same resource-specific creation
and editing schemas used by services, with a resource/action schema map. Service
selection and authorization remain authoritative; a union in OpenAPI does not
grant permission to edit another resource.

Some heterogeneous bootstrap, connection, booking, onboarding, and editor
responses currently use extensible JSON-object/array schemas rather than complete
field-by-field models. This is partial response-field coverage, not a claim that
all client payloads are fully typed. Cross-field refinements, lifecycle rules,
conditional setup-password requirements, allocation limits, and authorization
cannot all be represented by JSON Schema and are enforced at runtime.

The isolated PostgreSQL HTTP suite exercises legacy and modern creation, checkout,
guestlist approval, admissions projections, all six reporting table categories,
summary and immediate CSV output, structured invalid/unauthorized requests, and a
concurrent removal that blocks writes through both API generations. The existing
export integration suite retains snapshot/concurrent-purchase and scale coverage
with 1,200 additional events, 24,000 orders/items, and 12,000 distinct buyers.
These fixtures use disposable test databases and disabled email delivery. They do
not establish production latency or throughput guarantees; measure production-like
query plans and workloads separately before making capacity claims.
