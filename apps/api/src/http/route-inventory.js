// Closed inventory: route registration fails if a new operation lacks review.
// Generated artifact parity tests also detect removals or schema drift.
const routeInventory = [
  { method: 'get', path: '/customer/rundowns', successStatuses: [200] },
  { method: 'get', path: '/customer/rundowns/preview', successStatuses: [200] },
  { method: 'post', path: '/customer/rundowns', successStatuses: [200] },
  { method: 'get', path: '/rundowns/:id', successStatuses: [200] },
  { method: 'get', path: '/discovery/areas', successStatuses: [200] },
  { method: 'post',path: '/support/requests',successStatuses: [200] },
  { method: 'post',path: '/support/access-requests',successStatuses: [200] },
  { method: 'get',path: '/support/access-requests/:id',successStatuses: [200] },
  { method: 'post',path: '/support/access-requests/:id/replies',successStatuses: [200] },
  { method: 'post',path: '/support/access-requests/:id/read',successStatuses: [200] },
  { method: 'get',path: '/support/messages',successStatuses: [200] },
  { method: 'get',path: '/support/messages/:id',successStatuses: [200] },
  { method: 'post',path: '/support/messages/:id/replies',successStatuses: [200] },
  { method: 'post',path: '/support/messages/:id/read',successStatuses: [200] },
  { method: 'get',path: '/admin/support/messages',successStatuses: [200] },
  { method: 'get',path: '/admin/support/messages/:id',successStatuses: [200] },
  { method: 'post',path: '/admin/support/messages/:id/replies',successStatuses: [200] },
  { method: 'post',path: '/admin/support/messages/:id/read',successStatuses: [200] },
{"method":"get","path":"/account/commission-payment-profile","successStatuses":[200]},
{"method":"post","path":"/account/commission-payment-profile","successStatuses":[201]},
{"method":"post","path":"/account/commission-payment-profile/onboarding","successStatuses":[200]},
{"method":"post","path":"/account/commission-payment-profile/synchronize","successStatuses":[200]},
{"method":"post","path":"/account/commission-payment-profile/disable","successStatuses":[200]},
{"method":"post","path":"/account/commission-payment-profile/resume","successStatuses":[200]},
{"method":"post","path":"/account/commission-payment-profile/disconnect","successStatuses":[200]},
{"method":"get","path":"/account/commission-payment-profile/dashboard","successStatuses":[200]},
{"method":"get","path":"/account/commissions","successStatuses":[200]},
{"method":"get","path":"/account/commission-earnings","successStatuses":[200]},
{"method":"get","path":"/business/organizations/:organizationId/commission-statements","successStatuses":[200]},
{"method":"post","path":"/business/organizations/:organizationId/commission-statements/:statementId/approve","successStatuses":[200]},
{"method":"post","path":"/business/organizations/:organizationId/commission-payments/quote","successStatuses":[200]},
{"method":"post","path":"/business/organizations/:organizationId/commission-payments","successStatuses":[201]},
{"method":"get","path":"/business/organizations/:organizationId/commission-payments/:paymentId","successStatuses":[200]},
{"method":"post","path":"/business/organizations/:organizationId/commission-payments/:paymentId/reconcile","successStatuses":[200]},
{"method":"post","path":"/business/organizations/:organizationId/commission-payments/:paymentId/invoicing-fee-review","successStatuses":[200]},
{"method":"patch","path":"/business/organizations/:organizationId/people/:userId/commission-settings","successStatuses":[200]},
  { method: 'get', path: '/customer/messages', successStatuses: [200] },
  { method: 'get', path: '/business/messages', successStatuses: [200] },
  { method: 'get', path: '/customer/messages/:threadId', successStatuses: [200] },
  { method: 'get', path: '/business/messages/:threadId', successStatuses: [200] },
  { method: 'post', path: '/customer/messages/:threadId/replies', successStatuses: [200] },
  { method: 'post', path: '/business/messages/:threadId/replies', successStatuses: [200] },
  { method: 'post', path: '/customer/messages/:threadId/read', successStatuses: [200] },
  { method: 'post', path: '/business/messages/:threadId/read', successStatuses: [200] },
  { method: 'post', path: '/customer/orders/:orderId/messages', successStatuses: [200] },
  { method: 'patch', path: '/business/orders/:orderId/refund-request', successStatuses: [200] },
  { method: 'get', path: '/business/organizations/:organizationId/commission-settings', successStatuses: [200] },
  { method: 'patch', path: '/business/organizations/:organizationId/commission-settings', successStatuses: [200] },
  { method: 'get', path: '/business/events/:eventId/commission-settings', successStatuses: [200] },
  { method: 'patch', path: '/business/events/:eventId/commission-settings', successStatuses: [200] },
  { method: 'get', path: '/customer/my-events/access', successStatuses: [200] },
  { method: 'get', path: '/customer/my-events', successStatuses: [200] },
  { method: 'get', path: '/customer/my-events/:eventId', successStatuses: [200] },
  { method: 'get', path: '/customer/my-events/:eventId/referral-link', successStatuses: [200] },
  { method: 'get', path: '/customer/my-events/:eventId/guestlist-invite-pools', successStatuses: [200] },
  { method: 'get', path: '/customer/my-events/:eventId/guestlist-page', successStatuses: [200] },
  { method: 'get', path: '/customer/my-events/:eventId/guestlist-page/:entryId', successStatuses: [200] },
  { method: 'get', path: '/customer/my-events/:eventId/guestlist/:entryId/invitation-link', successStatuses: [200] },
  { method: 'post', path: '/customer/my-events/:eventId/guestlist-invitations', successStatuses: [201] },
  { method: 'post', path: '/customer/my-events/:eventId/guestlist/:entryId/decision', successStatuses: [200] },
  { method: 'get', path: '/customer/payment-config', successStatuses: [200] },
  { method: 'post', path: '/customer/payment-checkouts', successStatuses: [200] },
  { method: 'post', path: '/customer/payment-checkouts/:orderId/resume', successStatuses: [200] },
  { method: 'post', path: '/customer/payment-checkouts/:orderId/verify', successStatuses: [200] },
  { method: 'post', path: '/customer/payment-checkouts/:orderId/cancel', successStatuses: [200] },
  { method: 'post', path: '/business/orders/:orderId/refunds', successStatuses: [200] },
  { method: 'post', path: '/admin/orders/:orderId/refunds', successStatuses: [200] },
  { method: 'get', path: '/business/organizations/:organizationId/payment-accounts', successStatuses: [200] },
  { method: 'get', path: '/business/organizations/:organizationId/payment-overview', successStatuses: [200] },
  { method: 'get', path: '/business/payments/earnings', successStatuses: [200] },
  { method: 'get', path: '/business/organizations/:organizationId/payment-accounts/:accountId/disconnect-impact', successStatuses: [200] },
  { method: 'post', path: '/business/organizations/:organizationId/payment-accounts/:accountId/disable', successStatuses: [200] },
  { method: 'post', path: '/business/organizations/:organizationId/payment-accounts/:accountId/resume', successStatuses: [200] },
  { method: 'post', path: '/business/organizations/:organizationId/payment-accounts/:accountId/disconnect', successStatuses: [200] },
  { method: 'put', path: '/business/organizations/:organizationId/members/:userId/payment-disconnect', successStatuses: [200] },
  { method: 'post', path: '/business/organizations/:organizationId/payment-accounts', successStatuses: [201] },
  { method: 'post', path: '/business/organizations/:organizationId/payment-accounts/:accountId/onboarding', successStatuses: [200] },
  { method: 'post', path: '/business/organizations/:organizationId/payment-accounts/:accountId/synchronize', successStatuses: [200] },
  { method: 'put', path: '/business/organizations/:organizationId/payment-accounts/default', successStatuses: [200] },
  { method: 'put', path: '/business/events/:eventId/payment-account', successStatuses: [200] },
  { method: 'get', path: '/customer/checkout-attempts/:idempotencyKey', successStatuses: [200] },
  { method: 'post', path: '/auth/business/sign-in', successStatuses: [200] },
  { method: 'post', path: '/business/access-requests', successStatuses: [202] },
  { method: 'post', path: '/account/organization-requests', successStatuses: [202] },
  { method: 'get', path: '/account/organization-requests', successStatuses: [200] },
  { method: 'get', path: '/admin/business-access/requests', successStatuses: [200] },
  { method: 'get', path: '/admin/business-access/requests/:id', successStatuses: [200] },
  { method: 'post', path: '/admin/business-access/requests/:id/approve', successStatuses: [200] },
  { method: 'post', path: '/admin/business-access/requests/:id/decline', successStatuses: [200] },
  { method: 'get', path: '/admin/businesses/:id/ownership', successStatuses: [200] },
  { method: 'post', path: '/admin/businesses/:id/ownership/invitations', successStatuses: [201] },
  { method: 'post', path: '/admin/businesses/:id/ownership/:userId/remove', successStatuses: [200] },
  { method: 'post', path: '/admin/businesses/:id/ownership/recovery', successStatuses: [200] },
  { method: 'put', path: '/admin/businesses/:id/finance/:userId', successStatuses: [200] },
  { method: 'put', path: '/business/organizations/:id/members/:userId/finance', successStatuses: [200] },
  { method: 'get', path: '/admin/events/:id/editor', successStatuses: [200] },
  { method: 'get', path: '/admin/businesses/:id/editor-options', successStatuses: [200] },
  { method: 'get', path: '/admin/reports/exports', successStatuses: [200] },
  { method: 'get', path: '/admin/reports/exports/:id', successStatuses: [200] },
  { method: 'get', path: '/admin/reports/exports/:id/download', successStatuses: [200] },
  { method: 'post', path: '/admin/reports/exports/:id/retry', successStatuses: [200] },
  { method: 'get', path: '/admin/events/:id/notification-preview', successStatuses: [200] },
  { method: 'post', path: '/admin/events', successStatuses: [201] },
  { method: 'put', path: '/admin/events/:id', successStatuses: [200] },
  { method: 'get', path: '/admin/support/cases', successStatuses: [200] },
  { method: 'post', path: '/admin/support/cases', successStatuses: [201] },
  { method: 'get', path: '/admin/support/cases/:id', successStatuses: [200] },
  { method: 'get', path: '/admin/support/cases/:id/history', successStatuses: [200] },
  { method: 'patch', path: '/admin/support/cases/:id', successStatuses: [200] },
  { method: 'get', path: '/admin/overview/needs-attention', successStatuses: [200] },
  {
    "method": "post",
    "path": "/admin/demo-users",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "get",
    "path": "/admin/management/:resource",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/admin/management/:resource",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "get",
    "path": "/admin/management/:resource/:id",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "patch",
    "path": "/admin/management/:resource/:id",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/admin/management/:resource/:id/actions/:action",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/admin/management/resources",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/admin/management/users/:id/scoped-role",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/admin/onboarding",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "post",
    "path": "/admin/onboarding/:id/resend",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/admin/onboarding/:id/revoke",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/admin/operations",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/admin/overview",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/admin/reports/:table",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/admin/reports/bootstrap",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/admin/reports/export.csv",
    "successStatuses": [
      200,
      202
    ]
  },
  {
    "method": "get",
    "path": "/admin/reports/summary",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/admin/workspace",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/email/resend",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/email/verify",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/logout",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/auth/me",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/auth/notification-preferences",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "patch",
    "path": "/auth/notification-preferences",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/onboarding/accept",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/auth/onboarding/preview",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/password-reset/complete",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/password-reset/request",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/password/change",
    "successStatuses": [200]
  },
  {
    "method": "patch",
    "path": "/auth/profile",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/register",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "get",
    "path": "/auth/sessions",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "delete",
    "path": "/auth/sessions/:sessionId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/sessions/revoke-all",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/auth/sign-in",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/admissions/events",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/admissions/events/:eventId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/bootstrap",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/events",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "put",
    "path": "/business/events/:eventId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "patch",
    "path": "/business/events/:eventId/affiliates/:eventAffiliateId/guestlist-allocation",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/analytics",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/attendees",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/attendees/:attendeeId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/events/:eventId/copy-access",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/detail",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/guestlist",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "patch",
    "path": "/business/events/:eventId/guestlist-capacity",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/events/:eventId/guestlist-invitations",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/guestlist-invite-pools",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/guestlist-page",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/guestlist-page/:entryId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/guestlist-settings",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/guestlist-settings-page",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/events/:eventId/guestlist/:entryId/decision",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/events/:eventId/instructions",
    "successStatuses": [
      202
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/instructions/history",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/events/:eventId/instructions/preview",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/invitations",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/events/:eventId/invitations",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "delete",
    "path": "/business/events/:eventId/invitations/:invitationId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "put",
    "path": "/business/events/:eventId/people",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/people-page",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/purchases",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/referral-link",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/summary",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/organizations/:organizationId/invitations",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "get",
    "path": "/business/organizations/:organizationId/invitations-page",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "delete",
    "path": "/business/organizations/:organizationId/invitations/:invitationId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/organizations/:organizationId/invitations/:invitationId/resend",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/organizations/:organizationId/team",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/organizations/:organizationId/team-page",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "delete",
    "path": "/business/organizations/:organizationId/team/:userId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "patch",
    "path": "/business/organizations/:organizationId/team/:userId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/overview",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/overview/needs-attention",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/reports/:table",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/reports/export.csv",
    "successStatuses": [
      200,
      202
    ]
  },
  {
    "method": "get",
    "path": "/business/reports/exports",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/reports/exports/:id",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/reports/exports/:id/download",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/business/reports/exports/:id/retry",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/business/reports/summary",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/check-ins",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "get",
    "path": "/customer/bookings",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/customer/connections",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/customer/connections/people",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/customer/connections/summary",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/customer/events/:eventId/guestlist",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "delete",
    "path": "/customer/guestlists/:entryId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "patch",
    "path": "/customer/guestlists/:entryId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/customer/guestlists/:id/pass",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "patch",
    "path": "/customer/profile",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/customer/purchases/:id/tickets",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/customer/saved",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "delete",
    "path": "/customer/saved/:eventId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "put",
    "path": "/customer/saved/:eventId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/customer/saved/ids",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/customer/saved/merge",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/customer/tickets/:id",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/events",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/events",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "get",
    "path": "/events/:eventId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/events/:eventId/affiliates",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "post",
    "path": "/events/:eventId/guestlist",
    "successStatuses": [
      202
    ]
  },
  {
    "method": "post",
    "path": "/events/:eventId/offerings",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "post",
    "path": "/events/:eventId/referral-visits",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/events/batch",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/guestlist-invitations/:token/claim",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/guestlist-invitations/:token/pass",
    "successStatuses": [200]
  },
  {
    "method": "get",
    "path": "/business/events/:eventId/guestlist/:entryId/invitation-link",
    "successStatuses": [200]
  },
  {
    "method": "delete",
    "path": "/notifications",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/notifications",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "delete",
    "path": "/notifications/:id",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/notifications/:id/read",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "get",
    "path": "/openapi.json",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/orders",
    "successStatuses": [
      200,
      201
    ]
  },
  {
    "method": "get",
    "path": "/orders/:orderId",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/organizations",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "post",
    "path": "/organizations/:organizationId/affiliates",
    "successStatuses": [
      201
    ]
  },
  {
    "method": "get",
    "path": "/team/invitations/:token",
    "successStatuses": [
      200
    ]
  },
  {
    "method": "post",
    "path": "/team/invitations/:token/accept",
    "successStatuses": [
      200
    ]
  }
];
for (const prefix of ['/admin/businesses/:id/venues', '/business/organizations/:id/venues']) {
  for (const path of [prefix, `${prefix}/:locationId`, `${prefix}/:locationId/team`, `${prefix}/:locationId/candidates`]) routeInventory.push({ method: 'get', path, successStatuses: [200] });
  routeInventory.push({ method: 'post', path: prefix, successStatuses: [201] });
  routeInventory.push({ method: 'patch', path: `${prefix}/:locationId`, successStatuses: [200] });
  routeInventory.push({ method: 'put', path: `${prefix}/:locationId/team/:userId`, successStatuses: [200] });
  for (const action of ['archive', 'suspend', 'restore']) routeInventory.push({ method: 'post', path: `${prefix}/:locationId/${action}`, successStatuses: [200] });
}
module.exports = { routeInventory };
