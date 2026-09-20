# Nitewide implementation plan

Nitewide remains the nightlife-facing brand while the domain model uses generic event, organization, offering, location, commerce, and admission concepts.

## Architecture decisions

- One `User` identity acquires capabilities through relationships, not a single global role.
- Every event has a creator. An event may optionally belong to an organization with one or more owners.
- `OrgAffiliate` stores organization defaults. `EventAffiliate` selects a person for an event and overrides those defaults when a field is supplied. Rates never stack.
- `Offering` is sellable inventory; `OrderItem` is the immutable purchase snapshot; `Ticket` is an admission credential. This allows one tier to sell repeatedly and one package to generate multiple credentials.
- Event guestlist capacity limits all accepted direct and affiliate guestlist entries. Affiliate allocation is an additional, narrower limit.
- Inventory reservations, order creation, guestlist allocation, and check-in use database transactions and row locks.
- Money is stored as integer cents and rates as basis points.
- Locations are reusable, geocodable, PostGIS-indexed, and can hide their exact address until an appropriate lifecycle point.
- Audit records capture sensitive state changes without coupling the core models to nightlife.

## Milestones

1. **Foundation and schema** — workspace, environment validation, PostgreSQL/PostGIS migration, Sequelize models, associations, indexes, and realistic seed.
2. **Domain services** — pricing, affiliate precedence, transactional checkout/inventory, guestlists, QR credentials, check-in, and audit writes.
3. **REST API and permissions** — public discovery plus customer, business, and internal routes with request validation and automated API/domain tests.
4. **Three web apps** — runnable Nitewide customer, Nitewide Business, and Nitewide Admin shells connected to the API, followed by build/test verification and exact operating documentation.

## Deferred behind explicit interfaces

Production payment capture/refunds, authentication, email/SMS, wallet passes, ticket transfer, payouts, subscription billing, and boost auction logic are integration boundaries rather than mocked claims of production readiness.

