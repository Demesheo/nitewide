const { DomainError, conflict } = require('../domain/errors');
const { controllerMatches } = require('../services/business-payment-account-service');

// Accounts v2 IDs have a v1 projection. Only Standard/full-dashboard,
// Stripe-liable accounts can use OAuth deauthorization. Never close, delete or
// reject an account as a substitute for removing the platform connection.
function createStripeDisconnect(stripe, clientId) {
  const enabled = /^ca_[A-Za-z0-9]+$/.test(clientId || '');
  async function disconnect(accountId) {
    if (!enabled) throw new DomainError('Stripe disconnect is not configured. New payments can still be disabled.', { code: 'DISCONNECT_NOT_CONFIGURED', status: 503 });
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId || '')) throw conflict('Invalid merchant account.', 'DISCONNECT_NOT_SUPPORTED');
    const remote = await stripe.v2.core.accounts.retrieve(accountId, { include: ['defaults'] });
    const standard = await stripe.accounts.retrieve(accountId);
    if (remote.id !== accountId || remote.livemode !== false || remote.closed || !controllerMatches(remote)
      || standard.id !== accountId || standard.type !== 'standard'
      || standard.controller?.stripe_dashboard?.type !== 'full' || standard.controller?.losses?.payments !== 'stripe') {
      throw conflict('Stripe does not support self-service disconnection for this account configuration.', 'DISCONNECT_NOT_SUPPORTED');
    }
    // Losing access while a dispute is open prevents platform assistance. This
    // check is bounded; an unverifiable large scope fails closed, not silently.
    let startingAfter;
    for (let page = 0; page < 10; page += 1) {
      const disputes = await stripe.disputes.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) }, { stripeAccount: accountId });
      if (disputes.data.some(d => ['needs_response','under_review','warning_needs_response','warning_under_review'].includes(d.status))) {
        throw conflict('Resolve open Stripe disputes before disconnecting. New payments remain disabled.', 'DISCONNECT_OBLIGATIONS');
      }
      if (!disputes.has_more) break;
      startingAfter = disputes.data.at(-1)?.id;
      if (!startingAfter || page === 9) throw conflict('Stripe dispute history could not be fully checked. New payments remain disabled.', 'DISCONNECT_OBLIGATIONS');
    }
    let result;
    try { result = await stripe.oauth.deauthorize({ client_id: clientId, stripe_user_id: accountId }); }
    catch (error) {
      if (error.rawType === 'no_deauth_on_controlled_account' || error.code === 'no_deauth_on_controlled_account') {
        throw conflict('Stripe does not permit deauthorization of this controlled account. No account was closed or removed.', 'DISCONNECT_NOT_SUPPORTED');
      }
      throw error; // Unknown outcomes remain pending; never infer success.
    }
    if (result.stripe_user_id !== accountId) throw new Error('Stripe disconnect acknowledgment did not match.');
    return { disconnected: true };
  }
  return { enabled, disconnect };
}
module.exports = { createStripeDisconnect };
