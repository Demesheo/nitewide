const { TEMPLATES } = require('./email-templates');

// Staging exercises account recovery and reviewed business onboarding, not
// customer receipts, guestlist notices, team campaigns or welcome emails.
const ESSENTIAL_TEMPLATES = Object.freeze([
  TEMPLATES.verifyEmail, TEMPLATES.passwordReset, 'nitewide-account-setup',
]);

function emailDeliveryPolicy(config = {}) {
  const policy = config.EMAIL_DELIVERY_POLICY || (config.APP_ENVIRONMENT === 'staging' ? 'essential' : 'all');
  if (!['disabled', 'essential', 'all'].includes(policy)) throw new Error('Invalid email delivery policy');
  if (config.APP_ENVIRONMENT === 'staging' && policy === 'all') throw new Error('Staging email delivery must be essential or disabled');
  return policy;
}

function allowsEmailTemplate(policy, template) {
  return policy === 'all' || (policy === 'essential' && ESSENTIAL_TEMPLATES.includes(template));
}

module.exports = { ESSENTIAL_TEMPLATES, emailDeliveryPolicy, allowsEmailTemplate };
