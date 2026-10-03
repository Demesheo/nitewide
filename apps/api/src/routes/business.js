const querySchemas = require('../http/domain-query-schemas');
const { asyncHandler, validate } = require('./contract-router');
const schemas = require('../http/schemas');
const businessSchemas = require('../http/business-schemas');
const { z } = require('zod');
const { optionalPhone } = require('../domain/phone');
const { sendAttendeeInstructions } = require('../services/attendee-instructions-service');

function registerBusinessRoutes({ router, managementController, commerceController, requireUser, models, permissions, invitations, email, customerAppUrl, businessAppUrl, business, businessRead, businessTeamRead, businessEventReuse, businessEventRead, businessInstructionsRead, team, eventWorkspace, referralLinks }) {
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
  router.put('/business/events/:eventId/people', requireUser, validate(eventPerson), asyncHandler(async (req, res) => res.json({ data: await eventWorkspace.savePerson(req.userId, req.params.eventId, req.body) })));
  const inviteInput = z.object({ email: z.string().trim().email().max(320), name: z.string().trim().min(1).max(120).optional(), phone: optionalPhone, role: z.enum(['manager', 'employee', 'affiliate']) });
  router.get('/business/events/:eventId/invitations',requireUser,asyncHandler(async (req,res) => res.set('Cache-Control', 'no-store').json({data:await team.eventInvitations(req.userId,req.params.eventId)})));
  router.post('/business/events/:eventId/invitations',requireUser,validate(inviteInput.pick({email:true,name:true,phone:true}).extend({commissionBps:z.number().int().min(0).max(4000).default(0)})),asyncHandler(async (req,res) => res.status(201).json({data:await team.inviteEvent(req.userId,req.params.eventId,req.body)})));
  router.delete('/business/events/:eventId/invitations/:invitationId',requireUser,asyncHandler(async (req,res) => res.json({data:await team.revokeEvent(req.userId,req.params.eventId,req.params.invitationId)})));
  router.get('/business/organizations/:organizationId/team', requireUser, asyncHandler(async (req, res) => res.set('Cache-Control', 'no-store').json({ data: await team.roster(req.userId, req.params.organizationId) })));
  router.get('/business/organizations/:organizationId/team-page', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessTeamRead.page(req.userId,
    z.uuid().parse(req.params.organizationId), querySchemas.organizationTeam.parse(req.query)) })));
  router.get('/business/organizations/:organizationId/invitations-page', requireUser, asyncHandler(async (req, res) => res.set('Cache-Control', 'no-store').json({ data: await businessTeamRead.invitations(req.userId,
    z.uuid().parse(req.params.organizationId), querySchemas.businessPage.parse(req.query)) })));
  router.patch('/business/organizations/:organizationId/team/:userId', requireUser, validate(z.object({ role: z.enum(['manager', 'employee', 'affiliate']) })), asyncHandler(async (req, res) => res.json({ data: await team.changeRole(req.userId, req.params.organizationId, req.params.userId, req.body.role) })));
  router.delete('/business/organizations/:organizationId/team/:userId', requireUser, asyncHandler(async (req, res) => res.json({ data: await team.removeMember(req.userId, req.params.organizationId, req.params.userId) })));
  router.post('/business/organizations/:organizationId/invitations', requireUser, validate(inviteInput), asyncHandler(async (req, res) => res.status(201).json({ data: await team.invite(req.userId, req.params.organizationId, req.body) })));
  router.delete('/business/organizations/:organizationId/invitations/:invitationId', requireUser, asyncHandler(async (req, res) => res.json({ data: await team.revoke(req.userId, req.params.organizationId, req.params.invitationId) })));
  router.post('/business/organizations/:organizationId/invitations/:invitationId/resend', requireUser, asyncHandler(async (req, res) => res.json({ data: await team.resend(req.userId, req.params.organizationId, req.params.invitationId) })));
  router.get('/team/invitations/:token', asyncHandler(async (req, res) => res.json({ data: await team.invitation(req.params.token) })));
  router.post('/team/invitations/:token/accept', requireUser, asyncHandler(async (req, res) => res.json({ data: await team.accept(req.userId, req.params.token) })));
  router.get('/business/bootstrap', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessRead.bootstrap(req.userId) })));
  router.get('/business/events', requireUser, asyncHandler(async (req, res) => res.json({ data: await businessRead.events(req.userId, businessSchemas.eventListQuery.parse(req.query)) })));
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
    res.json({ data: await businessInstructionsRead.history(req.userId, z.uuid().parse(req.params.eventId), querySchemas.businessPage.parse(req.query)) });
  }));
  router.post('/business/events/:eventId/instructions', requireUser, validate(z.object({ instructions: z.string().trim().min(3).max(1800), idempotencyKey: z.uuid().optional() }).strict()), asyncHandler(async (req, res) => {
    res.status(202).json({ data: await sendAttendeeInstructions({ models, permissions, email, customerAppUrl, businessAppUrl, userId: req.userId, eventId: req.params.eventId, instructions: req.body.instructions, idempotencyKey: req.body.idempotencyKey }) });
  }));
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
  router.get('/business/events/:eventId/guestlist/:entryId/invitation-link', requireUser, asyncHandler(async (req, res) => res.json({ data: await invitations.link(req.userId, req.params.eventId, req.params.entryId) })));
  router.get('/business/events/:eventId/guestlist', requireUser, asyncHandler(commerceController.listGuestlistRequests));
  router.post('/business/events/:eventId/guestlist/:entryId/decision', requireUser, validate(schemas.guestlistDecision), asyncHandler(commerceController.reviewGuestlist));
}
module.exports = { registerBusinessRoutes };
