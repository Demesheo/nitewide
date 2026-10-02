const { randomUUID } = require('node:crypto');

// Test-only identity; never use a user's contact details for sandbox fixtures.
function createStripeTestIdentity(scenario = 'connect-onboarding', now = new Date()) {
  const label = scenario.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'connect-test';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
  const testIdentifier = `${label}-${day}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  return { testIdentifier, email: `test+${testIdentifier}@nitewide.com` };
}

module.exports = { createStripeTestIdentity };
