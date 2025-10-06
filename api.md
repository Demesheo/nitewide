Admin Dashboard API
│
├─ /users
│   ├─ GET /users                   → list all users
│   ├─ POST /users                  → create a new user
│   ├─ GET /users/:id               → get user details
│   ├─ PUT /users/:id               → update user info
│   ├─ DELETE /users/:id            → soft delete user
│   └─ PATCH /users/:id/admin       → toggle global admin flag
│
├─ /organizations
│   ├─ GET /organizations           → list all organizations
│   ├─ POST /organizations          → create organization (assign owner)
│   ├─ GET /organizations/:id       → get organization details
│   ├─ PUT /organizations/:id       → update organization
│   ├─ DELETE /organizations/:id    → soft delete organization
│   └─ /:id/affiliates
│       ├─ POST                     → add org affiliate (management/staff)
│       ├─ GET                      → list org affiliates
│       └─ DELETE /:affiliateId     → remove org affiliate
│
├─ /events
│   ├─ GET /events                   → list all events
│   ├─ POST /events                  → create event (assign owner/org)
│   ├─ GET /events/:id               → get event details
│   ├─ PUT /events/:id               → update event
│   ├─ DELETE /events/:id            → soft delete event
│   └─ /:id/affiliates
│       ├─ POST                     → add event affiliate (promoter/host)
│       ├─ GET                      → list event affiliates
│       └─ DELETE /:affiliateId     → remove event affiliate
│
├─ /guestlists
│   ├─ GET /guestlists?eventId=...  → list guests for an event
│   ├─ POST /guestlists             → add guest (user or non-user)
│   ├─ PUT /guestlists/:id          → update guest info
│   └─ DELETE /guestlists/:id       → remove guest
│
└─ /tickets
    ├─ GET /tickets?eventId=...     → list tickets for event
    ├─ POST /tickets                → create ticket
    ├─ PUT /tickets/:id             → update ticket (status, buyer)
    └─ DELETE /tickets/:id          → soft delete ticket
