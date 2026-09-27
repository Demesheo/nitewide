// Resend template aliases are stable contracts between the application and the
// editable templates in the Resend dashboard.
const TEMPLATES = Object.freeze({
  welcome: 'nitewide-welcome',
  verifyEmail: 'nitewide-verify-email',
  passwordReset: 'nitewide-password-reset',
  purchaseReceipt: 'nitewide-purchase-receipt',
  guestlistReceived: 'nitewide-guestlist-received',
  guestlistApproved: 'nitewide-guestlist-approved',
  guestlistDeclined: 'nitewide-guestlist-declined',
  guestlistWaitlisted: 'nitewide-guestlist-waitlisted',
  eventCancelled: 'nitewide-event-cancelled',
  eventTimeChange: 'nitewide-event-time-change',
  eventVenueChange: 'nitewide-event-venue-change',
  eventInstructions: 'nitewide-event-instructions',
  teamInvitation: 'nitewide-team-invitation',
  promoterInvitation: 'nitewide-promoter-invitation',
  accessAccepted: 'nitewide-access-accepted',
  accessChanged: 'nitewide-access-changed',
  eventTermsChanged: 'nitewide-event-terms-changed',
  guestlistReviewNeeded: 'nitewide-guestlist-review-needed',
  businessEventStatus: 'nitewide-business-event-status',
  instructionsSent: 'nitewide-instructions-sent',
});

module.exports = { TEMPLATES };
