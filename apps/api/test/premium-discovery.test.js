const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublicController } = require('../src/controllers/public-controller');
const { eventSummary } = require('../src/services/customer-account-service');

for (const [tier, expected] of [['premium', true], ['free', false], [null, false]]) {
  test(`discovery and wallet Premium decoration follows host plan: ${tier}`, async () => {
    const event = { id: 'event', status: 'published', endsAt: new Date(Date.now() + 86400000), organization: tier ? { name: 'Venue', planTier: tier } : null, offerings: [], toJSON() { return { id: this.id, organization: this.organization }; } };
    const queries = [];
    const models = { Event: { findAll: async q => { queries.push(q); return [event]; }, findByPk: async (id, q) => { queries.push(q); return event; } }, Organization: {}, Location: {}, Offering: {} };
    const controller = createPublicController({ models });
    let result;
    const res = { json: payload => { result = payload.data; } };
    await controller.listEvents({ query: {} }, res);
    assert.equal(result[0].isPremiumHost, expected);
    await controller.getEvent({ params: { eventId: 'event' } }, res);
    assert.equal(result.isPremiumHost, expected);
    assert.equal(eventSummary(event).isPremiumHost, expected);
    for (const q of queries) assert.ok(q.include.find(x => x.as === 'organization').attributes.includes('planTier'));
  });
}
