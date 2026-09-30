const { Webhook } = require('svix');

const deliveryTypes = new Set([
  'email.sent', 'email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed',
]);

function createResendWebhookService({ models, secret }) {
  const verifier = secret ? new Webhook(secret) : null;
  async function receive(rawBody, headers) {
    if (!verifier) return { status: 503, body: { error: 'Webhook verification is not configured' } };
    let event;
    try {
      if (!Buffer.isBuffer(rawBody) || !headers['svix-id'] || !headers['svix-timestamp'] || !headers['svix-signature']) throw new Error('Missing signed payload');
      const payload = rawBody.toString('utf8');
      verifier.verify(payload, {
        'svix-id': headers['svix-id'],
        'svix-timestamp': headers['svix-timestamp'],
        'svix-signature': headers['svix-signature'],
      });
      event = JSON.parse(payload);
    } catch {
      return { status: 400, body: { error: 'Invalid webhook signature' } };
    }
    if (!deliveryTypes.has(event?.type)) return { status: 204, body: null };
    const webhookId = headers['svix-id'];
    const providerMessageId = event.data?.email_id;
    const occurredAt = new Date(event.created_at);
    if (typeof webhookId !== 'string' || webhookId.length > 160 || typeof providerMessageId !== 'string' || providerMessageId.length > 100 || !providerMessageId || Number.isNaN(occurredAt.getTime())) {
      return { status: 400, body: { error: 'Invalid webhook event' } };
    }
    // Store only the signed event identity and normalized delivery state. An
    // event may arrive before the outbox has saved providerMessageId; joining
    // by that ID later preserves the delivery evidence without recipient PII.
    await models.EmailDeliveryEvent.findOrCreate({
      where: { webhookId },
      defaults: { webhookId, providerMessageId, eventType: event.type, occurredAt },
    });
    return { status: 204, body: null };
  }
  return { receive };
}
module.exports = { createResendWebhookService };
