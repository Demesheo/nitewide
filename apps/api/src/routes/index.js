const express = require('express');
const { createBusinessService } = require('../services/business-service');
const { createAdminService } = require('../services/admin-service');
const { createTeamService } = require('../services/team-service');
const { createEventWorkspaceService } = require('../services/event-workspace-service');
const { createReferralLinkService } = require('../services/referral-link-service');
const { createCustomerAccountService } = require('../services/customer-account-service');
const { createCustomerSavedService } = require('../services/customer-saved-service');
const { createAdmissionsService } = require('../services/admissions-service');
const { createBusinessReadService } = require('../services/business-read-service');
const { createBusinessEventReadService } = require('../services/business-event-read-service');
const { createBusinessInstructionsReadService } = require('../services/business-instructions-read-service');
const { createBusinessReportService } = require('../services/business-report-service');
const { createReportExportService } = require('../services/report-export-service');
const { createAdminReportService } = require('../services/admin-report-service');
const { createBusinessTeamReadService } = require('../services/business-team-read-service');
const { createBusinessEventReuseService } = require('../services/business-event-reuse-service');

function createRouter(options) {
  const { publicController, managementController, commerceController, authController, auth, requireUser, models, permissions, invitations, notifications, email, customerAppUrl = 'http://localhost:5173', businessAppUrl = 'http://localhost:5174/', qrTokenSecret, deliveryTrackingConfigured = false } = options;
  const router = require('./contract-router').instrumentRouter(express.Router(), { requireUser, permissions });
  const { environment = process.env.NODE_ENV || 'development', hostedDemo = false } = options;
  const { stripe, paymentMode = 'test', paymentAccounts, paymentConfiguration = require('../payments/stripe-client').stripeConfiguration({ NODE_ENV: environment, hostedDemo }) } = options;
  const unavailable = async () => { throw new (require('../domain/errors').DomainError)('Payments are not configured', { code: 'PAYMENTS_NOT_ENABLED', status: 503 }); };
  const paymentController = options.paymentController || Object.fromEntries(['prepare', 'verify', 'cancel', 'refund', 'adminRefund'].map(name => [name, unavailable]));
  const business = createBusinessService({ models, permissions, email, customerAppUrl, businessAppUrl, environment, hostedDemo, stripe });
  const businessRead = createBusinessReadService({ models, email, stripe, deliveryTrackingConfigured });
  const businessReports = createBusinessReportService({ models, businessRead });
  const adminReports = createAdminReportService({ models, permissions, businessRead, reports: businessReports });
  const reportExports = createReportExportService({ models, businessRead, reports: businessReports, historicalReports: adminReports.reports });
  router.reportExports = reportExports;
  const businessTeamRead = createBusinessTeamReadService({ models, permissions, stripe });
  const businessEventReuse = createBusinessEventReuseService({ models, permissions });
  const businessEventRead = createBusinessEventReadService({ models, stripe });
  const businessInstructionsRead = createBusinessInstructionsReadService({ models, permissions, email, deliveryTrackingConfigured });
  const admin = createAdminService({ models, permissions });
  const adminSupport = require('../services/admin-support-service').createAdminSupportService({ models, permissions,notifications });
  const team = createTeamService({ models, permissions, email, businessAppUrl, stripe });
  const eventWorkspace = createEventWorkspaceService({ models, permissions, email, businessAppUrl, stripe });
  const referralLinks = createReferralLinkService({ models });
  // Customer event operations use the same internal scope as event detail;
  // reports.view remains the unchanged Business/reporting collection default.
  const customerEventRead = createBusinessReadService({ models, internalReadPermission: 'events.manage' });
  const myEvents = require('../services/customer-my-events-service').createCustomerMyEventsService({ models, businessRead: customerEventRead, businessEventRead,
    invitations, referralLinks, reviewGuestlist: options.reviewGuestlist });
  const rundowns = require('../services/rundown-service').createRundownService({ models, permissions, customerAppUrl });
  const account = createCustomerAccountService({ models, tokenSecret: qrTokenSecret });
  const saved = createCustomerSavedService({ models });
  const admissions = createAdmissionsService({ models, permissions });
  const organizerMessages = require('../services/organizer-message-service').createOrganizerMessageService({ models, notifications, refunds: options.refunds });
  const context = { router, publicController, managementController, commerceController, authController, auth, requireUser, models, permissions, invitations, notifications, email, customerAppUrl, businessAppUrl, qrTokenSecret, deliveryTrackingConfigured, business, businessRead, businessReports, adminReports, reportExports, businessTeamRead, businessEventReuse, businessEventRead, businessInstructionsRead, admin, adminSupport, team, eventWorkspace, referralLinks, myEvents, account, saved, admissions, stripe, paymentMode, paymentAccounts, paymentController };
  require('./public').registerPublicRoutes(context);
  require('./account').registerAccountRoutes(context);
  require('./business-access').registerBusinessAccessRoutes(context);
  // Publishable configuration contains no secret keys. Discovery can fetch it
  // before sign-in; all order/account mutations below require a real session.
  router.get('/customer/payment-config', (_req, res) => res.set('Cache-Control', 'no-store').json({ data: paymentConfiguration }));
  require('./customer-my-events').registerCustomerMyEventsRoutes(context);
  require('./rundowns').registerRundownRoutes({ ...context, rundowns });
  require('./customer').registerCustomerRoutes(context);
  require('./organizer-messages').registerOrganizerMessageRoutes({ ...context, organizerMessages });
  const supportMessages = require('../services/support-message-service').createSupportMessageService({ models,permissions,notifications,sequelize: options.sequelize });
  require('./support-messages').registerSupportMessageRoutes({ ...context,supportMessages });
  const commissionSettings = require('../services/commission-settings-service').createCommissionSettingsService({ models, permissions, stripe });
  const commissionSchemas = require('../http/commission-schemas');
  router.patch('/business/organizations/:organizationId/people/:userId/commission-settings', requireUser, require('./contract-router').validate(commissionSchemas.organizationPersonCommissionSettings), require('./contract-router').asyncHandler(async (req,res) => {
    res.json({ data: await commissionSettings.personRate(req.userId,req.params.organizationId,req.params.userId,req.body) });
  }));
  for (const target of ['organizations', 'events']) {
    const name = target === 'organizations' ? 'organization' : 'event';
    const id = target === 'organizations' ? 'organizationId' : 'eventId';
    const path = `/business/${target}/:${id}/commission-settings`;
    const { asyncHandler, validate } = require('./contract-router');
    router.get(path, requireUser, asyncHandler(async (req, res) => res.json({ data: await commissionSettings[name](req.userId, req.params[id]) })));
    router.patch(path, requireUser, validate(commissionSchemas[`${name}CommissionSettings`]), asyncHandler(async (req, res) => res.json({ data: await commissionSettings[name](req.userId, req.params[id], req.body) })));
  }
  require('./payments').registerPaymentRoutes(context);
  require('./business-payments').registerBusinessPaymentRoutes(context);
  require('./commission-payments').registerCommissionPaymentRoutes({ ...context, commissionPayments: options.commissionPayments, individualCommissionProfiles: options.individualCommissionProfiles });
  router.get('/account/commission-earnings', requireUser, require('./contract-router').asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: await require('../services/business-payment-overview-service').createBusinessPaymentOverviewService({ models, stripe, paymentMode }).earnings(req.userId, req.query) });
  }));
  require('./admissions').registerAdmissionsRoutes(context);
  require('./reporting').registerReportingRoutes(context);
  require('./business').registerBusinessRoutes(context);
  require('./admin').registerAdminRoutes({ ...context, environment, hostedDemo });
  require('./admin-events').registerAdminEventRoutes(context);
  require('./admin-support').registerAdminSupportRoutes(context);
  require('./business-venues').registerVenueRoutes({ ...context, asyncHandler: require('./contract-router').asyncHandler });
  let openApi;
  router.get('/openapi.json', (_req, res) => {
    openApi ||= require('../http/api-contract').generateOpenApi(router.contracts);
    res.json(openApi);
  });
  return router;
}
module.exports = { createRouter };
