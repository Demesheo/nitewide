const express = require('express');
const { asyncHandler, validate } = require('../http/middleware');
const schemas = require('../http/schemas');
const businessSchemas = require('../http/business-schemas');
const { createBusinessService } = require('../services/business-service');
const { createAdminService } = require('../services/admin-service');
const adminSchemas = require('../http/admin-schemas');
const { analyticsQuery } = require('../http/analytics-schemas');
const { createAnalyticsService } = require('../services/analytics-service');
const { createTeamService } = require('../services/team-service');
const { createEventWorkspaceService } = require('../services/event-workspace-service');
const { createReferralLinkService } = require('../services/referral-link-service');
const { z } = require('zod');
const { optionalPhone } = require('../domain/phone');
const { createCustomerAccountService } = require('../services/customer-account-service');
const { createCustomerSavedService } = require('../services/customer-saved-service');
const { createAdmissionsService } = require('../services/admissions-service');
const { sendAttendeeInstructions } = require('../services/attendee-instructions-service');
const { createBusinessReadService } = require('../services/business-read-service');
const { createBusinessEventReadService } = require('../services/business-event-read-service');
const { createBusinessInstructionsReadService } = require('../services/business-instructions-read-service');
const { createBusinessReportService } = require('../services/business-report-service');
const { createBusinessTeamReadService } = require('../services/business-team-read-service');
const { createBusinessEventReuseService } = require('../services/business-event-reuse-service');

function createRouter({ publicController, managementController, commerceController, authController, auth, requireUser, models, permissions, invitations, notifications, email, customerAppUrl = 'http://localhost:5173', businessAppUrl = 'http://localhost:5174/app', qrTokenSecret, deliveryTrackingConfigured = false }) {
  const router = express.Router();
  const requireSession = (req, _res, next) => req.authSessionId ? next() : next(new (require('../domain/errors').DomainError)('A signed-in session is required', { code: 'UNAUTHENTICATED', status: 401 }));
  router.post('/auth/logout', requireUser, requireSession, asyncHandler(async (req, res) => res.json({ data: await auth.revoke(req.userId, req.authSessionId) })));
  router.get('/auth/sessions', requireUser, requireSession, asyncHandler(async (req, res) => res.json({ data: await auth.sessions(req.userId, req.authSessionId) })));
  router.post('/auth/sessions/revoke-all', requireUser, requireSession, asyncHandler(async (req, res) => res.json({ data: await auth.revoke(req.userId) })));
  router.delete('/auth/sessions/:sessionId', requireUser, requireSession, asyncHandler(async (req, res) => res.json({ data: await auth.revoke(req.userId, z.uuid().parse(req.params.sessionId)) })));
  const business = createBusinessService({ models, permissions, email, customerAppUrl, businessAppUrl });
  const businessRead = createBusinessReadService({ models, email, deliveryTrackingConfigured });
  const businessReports = createBusinessReportService({ models, businessRead });
  const businessTeamRead = createBusinessTeamReadService({ models, permissions });
  const businessEventReuse = createBusinessEventReuseService({ models, permissions });
  const businessEventRead = createBusinessEventReadService({ models });
  const businessInstructionsRead = createBusinessInstructionsReadService({ models, permissions, email, deliveryTrackingConfigured });
  const admin = createAdminService({ models, permissions, email, customerAppUrl });
  const analytics = createAnalyticsService({ models, permissions });
  const team = createTeamService({ models, permissions, email, businessAppUrl });
  const eventWorkspace = createEventWorkspaceService({ models, permissions, email, businessAppUrl });
  const referralLinks = createReferralLinkService({ models });
  const account = createCustomerAccountService({ models, tokenSecret: qrTokenSecret });
  const saved = createCustomerSavedService({ models });
  const admissions = createAdmissionsService({ models, permissions });
  require('./admin-onboarding').registerAdminOnboarding({ router, models, permissions, email, customerAppUrl, businessAppUrl, auth, requireUser, asyncHandler });
  router.use('/business/admissions', requireUser, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/business/admissions/events', asyncHandler(async (req, res) => res.json({ data: await admissions.events(req.userId, z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20), search: z.string().trim().max(120).default('') }).parse(req.query)) })));
  router.get('/business/admissions/events/:eventId', asyncHandler(async (req, res) => res.json({ data: await admissions.roster(req.userId, z.string().uuid().parse(req.params.eventId), z.object({ search: z.string().trim().max(120).default(''), page: z.coerce.number().int().min(1).max(10000).default(1), status: z.enum(['all', 'ready', 'admitted']).default('all') }).parse(req.query)) })));
  router.use('/customer', requireUser, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/customer/bookings', asyncHandler(async (req, res) => res.json({ data: await account.bookings(req.userId, z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), period: z.enum(['upcoming', 'past']).default('upcoming') }).parse(req.query)) })));
  router.get('/customer/saved', asyncHandler(async (req, res) => res.json({ data: await saved.list(req.userId, z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(30).default(9) }).parse(req.query)) })));
  router.get('/customer/saved/ids', asyncHandler(async (req, res) => {
    const ids = z.string().min(1).max(2000).transform((value) => value.split(',')).pipe(z.array(z.uuid()).min(1).max(50)).parse(req.query.eventIds);
    res.json({ data: await saved.ids(req.userId, [...new Set(ids)]) });
  }));
  router.post('/customer/saved/merge', validate(z.object({ eventIds: z.array(z.uuid()).max(100) }).strict()), asyncHandler(async (req, res) => res.json({ data: await saved.merge(req.userId, req.body.eventIds) })));
  router.put('/customer/saved/:eventId', asyncHandler(async (req, res) => res.json({ data: await saved.save(req.userId, z.uuid().parse(req.params.eventId)) })));
  router.delete('/customer/saved/:eventId', asyncHandler(async (req, res) => res.json({ data: await saved.remove(req.userId, z.uuid().parse(req.params.eventId)) })));
  router.get('/customer/tickets/:id', asyncHandler(async (req, res) => res.json({ data: await account.ticket(req.userId, z.string().uuid().parse(req.params.id)) })));
  router.get('/customer/purchases/:id/tickets', asyncHandler(async (req, res) => res.json({ data: await account.purchaseTickets(req.userId, z.string().uuid().parse(req.params.id)) })));
  router.get('/customer/guestlists/:id/pass', asyncHandler(async (req, res) => res.json({ data: await account.guestlistPass(req.userId, z.string().uuid().parse(req.params.id)) })));
  router.get('/customer/events/:eventId/guestlist', asyncHandler(async (req, res) => res.json({ data: await account.guestlistStatus(req.userId, z.uuid().parse(req.params.eventId), z.object({ affiliateCode: z.string().max(48).optional() }).parse(req.query)) })));
  router.patch('/customer/guestlists/:entryId', validate(z.object({ partySize: z.number().int().min(1).max(20) }).strict()), asyncHandler(async (req, res) => res.json({ data: await account.updatePendingGuestlist(req.userId, z.uuid().parse(req.params.entryId), req.body.partySize) })));
  router.delete('/customer/guestlists/:entryId', asyncHandler(async (req, res) => res.json({ data: await account.withdrawPendingGuestlist(req.userId, z.uuid().parse(req.params.entryId)) })));
  router.get('/customer/connections', asyncHandler(async (req, res) => {
    const query = z.object({ eventId: z.uuid().optional(), page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(30).default(9),
      city: z.string().trim().max(120).default(''), query: z.string().trim().max(120).default(''),
      personIds: z.string().max(2000).default('').transform((value) => value ? value.split(',') : []).pipe(z.array(z.uuid()).max(50)) }).parse(req.query);
    const legacyEventPicker = query.eventId && req.query.page === undefined && req.query.pageSize === undefined;
    res.json({ data: legacyEventPicker ? await account.connections(req.userId, { eventId: query.eventId }) : await account.connectionsPage(req.userId, query) });
  }));
  const connectionPeopleQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20), search: z.string().trim().max(120).default('') });
  const connectionPeople = asyncHandler(async (req, res) => res.json({ data: await account.connectionHistory(req.userId, connectionPeopleQuery.parse(req.query)) }));
  router.get('/customer/connections/summary', connectionPeople);
  router.get('/customer/connections/people', connectionPeople);
  router.patch('/customer/profile', validate(z.object({ displayName: z.string().trim().min(1).max(120), phone: optionalPhone, confirmPhone: optionalPhone.optional(), marketingConsent: z.boolean(), transactionalSmsConsent: z.boolean(), marketingSmsConsent: z.boolean() }).strict()), asyncHandler(async (req, res) => res.json({ data: await account.updateProfile(req.userId, req.body) })));
  router.patch('/auth/profile', requireUser, validate(z.object({ displayName: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email().max(320), confirmEmail: z.string().trim().toLowerCase().email().max(320).optional(), phone: optionalPhone, confirmPhone: optionalPhone.optional() }).strict()), asyncHandler(async (req, res) => {
    const prior = await models.User.findByPk(req.userId, { attributes: ['email'] });
    const updated = await account.updateIdentity(req.userId, req.body);
    if (prior?.email !== updated.email) {
      try {
        const delivery = await auth.requestEmailVerification(req.userId);
        return res.json({ data: { ...updated, verificationEmailQueued: delivery.verificationEmailQueued,
          verificationMessage: delivery.verificationEmailQueued
            ? 'Email updated. Check your new inbox to verify the address.'
            : 'Email updated, but verification could not be queued. Retry verification from your profile.' } });
      } catch (error) {
        console.error('Profile email updated, but verification could not be queued:', error);
        return res.json({ data: { ...updated, verificationEmailQueued: false,
          verificationMessage: 'Email updated, but verification could not be sent. Retry verification from your profile.' } });
      }
    }
    res.json({ data: updated });
  }));
  const eventPerson = z.object({ userId: z.string().uuid().optional(), email: z.string().trim().email().optional(), commissionBps: z.number().int().min(0).max(4000), status: z.enum(['active', 'inactive']).default('active') }).refine((v) => Boolean(v.userId) !== Boolean(v.email), 'Provide a user or an email');
  const eventPage = (req) => businessSchemas.eventPageQuery.parse(req.query);
  router.get('/business/events/:eventId/summary', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessEventRead.summary(req.userId, z.uuid().parse(req.params.eventId)) })));
  router.get('/business/events/:eventId/purchases', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessEventRead.purchases(req.userId, z.uuid().parse(req.params.eventId), eventPage(req)) })));
  router.get('/business/events/:eventId/attendees', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessEventRead.attendees(req.userId, z.uuid().parse(req.params.eventId), eventPage(req)) })));
  router.get('/business/events/:eventId/attendees/:attendeeId', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessEventRead.attendee(req.userId, z.uuid().parse(req.params.eventId), z.uuid().parse(req.params.attendeeId), eventPage(req)) })));
  router.get('/business/events/:eventId/people-page', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessEventRead.people(req.userId, z.uuid().parse(req.params.eventId), eventPage(req)) })));
  router.get('/business/events/:eventId/guestlist-page', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessEventRead.guestlist(req.userId, z.uuid().parse(req.params.eventId), eventPage(req)) })));
  router.get('/business/events/:eventId/guestlist-page/:entryId', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessEventRead.guestlistEntry(req.userId, z.uuid().parse(req.params.eventId), z.uuid().parse(req.params.entryId)) })));
  router.get('/business/events/:eventId/guestlist-settings-page', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessEventRead.guestlistSettings(req.userId, z.uuid().parse(req.params.eventId), eventPage(req)) })));
  router.get('/business/events/:eventId/detail', requireUser, asyncHandler(async (req, res) => res.json({ data: await eventWorkspace.detail(req.userId, req.params.eventId) })));
  router.get('/business/events/:eventId/referral-link', requireUser, asyncHandler(async (req, res) => res.json({ data: await referralLinks.ownLink(req.userId, req.params.eventId) })));
  router.post('/events/:eventId/referral-visits', validate(z.object({ code: z.string().min(3).max(48), sessionKey: z.string().uuid().optional() })), asyncHandler(async (req, res) => res.json({ data: await referralLinks.visit(req.params.eventId, req.body.code, req.body.sessionKey) })));
  router.put('/business/events/:eventId/people', requireUser, validate(eventPerson), asyncHandler(async (req, res) => res.json({ data: await eventWorkspace.savePerson(req.userId, req.params.eventId, req.body) })));
  const inviteInput = z.object({ email: z.string().trim().email().max(320), phone: optionalPhone, role: z.enum(['manager', 'employee', 'affiliate']) });
  router.get('/business/events/:eventId/invitations',requireUser,asyncHandler(async (req,res) => res.json({data:await team.eventInvitations(req.userId,req.params.eventId)})));
  router.post('/business/events/:eventId/invitations',requireUser,validate(inviteInput.pick({email:true,phone:true}).extend({commissionBps:z.number().int().min(0).max(4000).default(0)})),asyncHandler(async (req,res) => res.status(201).json({data:await team.inviteEvent(req.userId,req.params.eventId,req.body)})));
  router.delete('/business/events/:eventId/invitations/:invitationId',requireUser,asyncHandler(async (req,res) => res.json({data:await team.revokeEvent(req.userId,req.params.eventId,req.params.invitationId)})));
  router.get('/business/organizations/:organizationId/team', requireUser, asyncHandler(async (req, res) => res.json({ data: await team.roster(req.userId, req.params.organizationId) })));
  const organizationTeamPage = z.object({ page: businessSchemas.page.page, pageSize: businessSchemas.page.pageSize, timezone: businessSchemas.reportTimezone,
    search: z.string().trim().max(120).default(''), role: z.enum(['all', 'Owner', 'Manager', 'Employee', 'Promoter']).default('all'),
    roles: z.preprocess((value) => value === undefined ? [] : Array.isArray(value) ? value : [value],
      z.array(z.enum(['Owner', 'Manager', 'Employee', 'Promoter'])).max(4).default([])),
    sort: z.enum(['name_asc', 'name_desc', 'role_asc', 'role_desc', 'email_asc', 'email_desc', 'status_asc', 'status_desc', 'sales_desc', 'sales_asc', 'orders_desc', 'orders_asc', 'customers_desc', 'customers_asc']).default('name_asc') });
  router.get('/business/organizations/:organizationId/team-page', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessTeamRead.page(req.userId,
    z.uuid().parse(req.params.organizationId), organizationTeamPage.parse(req.query)) })));
  router.get('/business/organizations/:organizationId/invitations-page', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessTeamRead.invitations(req.userId,
    z.uuid().parse(req.params.organizationId), z.object(businessSchemas.page).parse(req.query)) })));
  router.patch('/business/organizations/:organizationId/team/:userId', requireUser, validate(z.object({ role: z.enum(['manager', 'employee', 'affiliate']) })), asyncHandler(async (req, res) => res.json({ data: await team.changeRole(req.userId, req.params.organizationId, req.params.userId, req.body.role) })));
  router.delete('/business/organizations/:organizationId/team/:userId', requireUser, asyncHandler(async (req, res) => res.json({ data: await team.removeMember(req.userId, req.params.organizationId, req.params.userId) })));
  router.post('/business/organizations/:organizationId/invitations', requireUser, validate(inviteInput), asyncHandler(async (req, res) => res.status(201).json({ data: await team.invite(req.userId, req.params.organizationId, req.body) })));
  router.delete('/business/organizations/:organizationId/invitations/:invitationId', requireUser, asyncHandler(async (req, res) => res.json({ data: await team.revoke(req.userId, req.params.organizationId, req.params.invitationId) })));
  router.post('/business/organizations/:organizationId/invitations/:invitationId/resend', requireUser, asyncHandler(async (req, res) => res.json({ data: await team.resend(req.userId, req.params.organizationId, req.params.invitationId) })));
  router.get('/team/invitations/:token', asyncHandler(async (req, res) => res.json({ data: await team.invitation(req.params.token) })));
  router.post('/team/invitations/:token/accept', requireUser, asyncHandler(async (req, res) => res.json({ data: await team.accept(req.userId, req.params.token) })));
  router.get('/admin/analytics', requireUser, asyncHandler(async (req, res) => res.json({ data: await analytics.adminReport(req.userId, analyticsQuery.parse(req.query)) })));
  router.get('/business/analytics', requireUser, asyncHandler(async (req, res) => res.json({ data: await analytics.businessReport(req.userId, analyticsQuery.parse(req.query)) })));
  router.get('/admin/workspace', requireUser, asyncHandler(async (req, res) => res.json({ data: await admin.workspace(req.userId, adminSchemas.reportQuery.parse(req.query)) })));
  require('./admin-management').registerAdminManagement({ router, models, permissions, email, customerAppUrl, businessAppUrl, requireUser, asyncHandler });
  router.get('/admin/operations', requireUser, asyncHandler(async (req, res) => res.json({ data: await admin.operations(req.userId, adminSchemas.operationsQuery.parse(req.query)) })));
  for (const entity of ['users', 'organizations', 'events']) router.patch(`/admin/${entity}/:id`, requireUser, asyncHandler(async (req) => {
    await permissions.assertInternal(req.userId);
    throw require('../domain/errors').conflict('Use the versioned Management editor or lifecycle actions.', 'LEGACY_ADMIN_EDIT_DISABLED');
  }));
  router.post('/admin/demo-users', requireUser, validate(adminSchemas.demoUser), asyncHandler(async (req, res) => res.status(201).json({ data: await admin.createDemoUser(req.userId, req.body) })));
  router.get('/business/workspace', requireUser, asyncHandler(async (req, res) => res.json({ data: await business.workspace(req.userId, businessSchemas.reportQuery.parse(req.query)) })));
  router.get('/business/bootstrap', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessRead.bootstrap(req.userId) })));
  router.get('/business/events', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessRead.events(req.userId, businessSchemas.eventListQuery.parse(req.query)) })));
  router.get('/business/overview', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessRead.overview(req.userId, businessSchemas.reportQuery.parse(req.query)) })));
  router.get('/business/overview/needs-attention', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessRead.needsAttention(req.userId, businessSchemas.reportQuery.parse(req.query)) })));
  router.get('/business/reports/summary', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessReports.summary(req.userId, businessSchemas.reportDetailQuery.parse(req.query)) })));
  router.get('/business/reports/export.csv', requireUser, asyncHandler(async (req, res) => businessReports.exportCsv(req.userId, businessSchemas.reportDetailQuery.parse(req.query), res)));
  router.get('/business/reports/:table', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessReports.table(req.userId,
    z.enum(['regions', 'venues', 'events', 'offerings', 'team', 'customers']).parse(req.params.table), businessSchemas.reportDetailQuery.parse(req.query)) })));
  router.post('/business/events', requireUser, validate(businessSchemas.eventEditor), asyncHandler(async (req, res) => res.status(201).json({ data: await business.saveEvent(req.userId, null, req.body) })));
  router.post('/business/events/:eventId/copy-access', requireUser,
    validate(z.object({ sourceEventId: z.uuid(), copyTeam: z.literal(true), copyAllocations: z.boolean().default(false) }).strict()),
    asyncHandler(async (req, res) => res.json({ data: await businessEventReuse.copyAccess(req.userId,
      z.uuid().parse(req.params.eventId), req.body) })));
  router.put('/business/events/:eventId', requireUser, validate(businessSchemas.eventEditor), asyncHandler(async (req, res) => res.json({ data: await business.saveEvent(req.userId, req.params.eventId, req.body) })));
  router.post('/business/events/:eventId/instructions/preview', requireUser, validate(z.object({ instructions: z.string().trim().min(3).max(1800) }).strict()), asyncHandler(async (req, res) => {
    res.json({ data: await businessInstructionsRead.preview(req.userId, z.uuid().parse(req.params.eventId), req.body.instructions) });
  }));
  router.get('/business/events/:eventId/instructions/history', requireUser, asyncHandler(async (req, res) => {
    res.json({ data: await businessInstructionsRead.history(req.userId, z.uuid().parse(req.params.eventId), z.object(businessSchemas.page).parse(req.query)) });
  }));
  router.post('/business/events/:eventId/instructions', requireUser, validate(z.object({ instructions: z.string().trim().min(3).max(1800), idempotencyKey: z.uuid().optional() }).strict()), asyncHandler(async (req, res) => {
    res.status(202).json({ data: await sendAttendeeInstructions({ models, permissions, email, customerAppUrl, businessAppUrl, userId: req.userId, eventId: req.params.eventId, instructions: req.body.instructions, idempotencyKey: req.body.idempotencyKey }) });
  }));
  router.post('/auth/register', validate(schemas.register), asyncHandler(authController.register));
  router.post('/auth/sign-in', validate(schemas.signIn), asyncHandler(authController.signIn));
  router.post('/auth/password-reset/request', validate(z.object({ email: z.string().trim().email().max(320) }).strict()), asyncHandler(authController.requestPasswordReset));
  router.post('/auth/password-reset/complete', validate(z.object({ token: z.string().min(20).max(200), password: schemas.password }).strict()), asyncHandler(authController.resetPassword));
  router.post('/auth/email/verify', validate(z.object({ token: z.string().min(20).max(200) }).strict()), asyncHandler(authController.verifyEmail));
  router.post('/auth/email/resend', requireUser, asyncHandler(authController.requestEmailVerification));
  router.get('/auth/me', requireUser, asyncHandler(authController.me));
  router.get('/auth/notification-preferences', requireUser, asyncHandler(async (req, res) => {
    const user = await models.User.findByPk(req.userId, { attributes: ['notificationPreferences'] });
    res.json({ data: { reviewRequests: true, salesActivity: true, inventoryAlerts: true, ...user?.notificationPreferences } });
  }));
  router.patch('/auth/notification-preferences', requireUser,
    validate(z.object({ reviewRequests: z.boolean(), salesActivity: z.boolean(), inventoryAlerts: z.boolean() }).strict()),
    asyncHandler(async (req, res) => {
      const user = await models.User.findByPk(req.userId);
      await user.update({ notificationPreferences: req.body });
      res.json({ data: user.notificationPreferences });
    }));
  router.get('/events', asyncHandler(publicController.listEvents));
  router.get('/events/batch', asyncHandler(publicController.batchEvents));
  router.get('/events/:eventId', asyncHandler(publicController.getEvent));
  router.post('/organizations', requireUser, validate(schemas.organization), asyncHandler(managementController.createOrganization));
  router.post('/organizations/:organizationId/affiliates', requireUser, validate(schemas.orgAffiliate), asyncHandler(managementController.addOrgAffiliate));
  router.post('/events', requireUser, validate(schemas.event), asyncHandler(managementController.createEvent));
  router.post('/events/:eventId/offerings', requireUser, validate(schemas.offering), asyncHandler(managementController.addOffering));
  router.post('/events/:eventId/affiliates', requireUser, validate(schemas.eventAffiliate), asyncHandler(managementController.addEventAffiliate));
  router.patch('/business/events/:eventId/guestlist-capacity', requireUser, validate(schemas.guestlistCapacity), asyncHandler(managementController.updateGuestlistCapacity));
  router.patch('/business/events/:eventId/affiliates/:eventAffiliateId/guestlist-allocation', requireUser, validate(schemas.affiliateGuestlistAllocation), asyncHandler(managementController.updateAffiliateGuestlistAllocation));
  router.get('/business/events/:eventId/guestlist-settings', requireUser, asyncHandler(managementController.guestlistSettings));
  router.get('/business/events/:eventId/guestlist-invite-pools', requireUser, asyncHandler(async (req, res) => res.json({ data: await invitations.pools(req.userId, req.params.eventId) })));
  router.post('/business/events/:eventId/guestlist-invitations', requireUser, validate(schemas.guestlistInvite), asyncHandler(async (req, res) => res.status(201).json({ data: await invitations.invite(req.userId, req.params.eventId, req.body) })));
  router.post('/guestlist-invitations/:token/claim', requireUser, asyncHandler(async (req, res) => res.json({ data: await invitations.claim(req.params.token, req.userId) })));
  router.get('/notifications', requireUser, asyncHandler(async (req, res) => {
    if (req.query.page === undefined && req.query.pageSize === undefined) {
      const [items, unreadCount] = await Promise.all([notifications.list(req.userId), notifications.unreadCount(req.userId)]);
      return res.json({ data: { items, unreadCount } });
    }
    return res.json({ data: await notifications.page(req.userId,
      z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query)) });
  }));
  router.post('/notifications/:id/read', requireUser, asyncHandler(async (req, res) => res.json({ data: await notifications.markRead(req.userId, req.params.id) })));
  router.delete('/notifications', requireUser, asyncHandler(async (req, res) => res.json({ data: await notifications.clearAll(req.userId) })));
  router.delete('/notifications/:id', requireUser, asyncHandler(async (req, res) => res.json({ data: await notifications.dismiss(req.userId, req.params.id) })));
  router.post('/events/:eventId/guestlist', requireUser, validate(schemas.guestlist), asyncHandler(commerceController.requestGuestlist));
  router.get('/business/events/:eventId/guestlist', requireUser, asyncHandler(commerceController.listGuestlistRequests));
  router.post('/business/events/:eventId/guestlist/:entryId/decision', requireUser, validate(schemas.guestlistDecision), asyncHandler(commerceController.reviewGuestlist));
  router.post('/orders', requireUser, validate(schemas.checkout), asyncHandler(commerceController.checkout));
  router.get('/orders/:orderId', requireUser, asyncHandler(commerceController.getOrder));
  router.post('/check-ins', requireUser, validate(schemas.checkIn), asyncHandler(commerceController.checkIn));
  router.get('/business/events/:eventId/analytics', requireUser, asyncHandler(managementController.eventAnalytics));
  router.get('/admin/overview', requireUser, asyncHandler(managementController.adminOverview));
  return router;
}
module.exports = { createRouter };
