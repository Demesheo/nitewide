import test from 'node:test';
import assert from 'node:assert/strict';
import { nextReportKind, reportPath, reportRecord, reportRequest } from '../src/lib/report-state.js';
test('primary drill path scopes business then event then canonical offering', () => {
  const params = new URLSearchParams({ period: '90', reportPage: '3', reportSort: 'name_asc', drill: JSON.stringify([{ kind: 'businesses', id: 'b', label: 'Club' }, { kind: 'events', id: 'e', label: 'Friday' }, { kind: 'offerings', id: 'o', label: 'VIP' }]) });
  const query = new URLSearchParams(reportRequest(params, { includePaging: true }));
  assert.equal(query.get('businessId'), 'b'); assert.equal(query.get('eventId'), 'e'); assert.equal(query.get('offeringId'), 'o'); assert.equal(query.get('page'), '3'); assert.equal(query.get('sort'), 'name_asc');
  assert.deepEqual(['businesses', 'events', 'offerings'].map(nextReportKind), ['events', 'offerings', 'purchases']);
});
test('custom ranges wait for complete ordered dates', () => {
  assert.equal(reportRequest(new URLSearchParams('period=custom&startDate=2026-10-01')), null);
  assert.equal(reportRequest(new URLSearchParams('period=custom&startDate=2026-10-02&endDate=2026-10-01')), null);
  assert.equal(new URLSearchParams(reportRequest(new URLSearchParams('period=custom&startDate=2026-10-01&endDate=2026-10-01'))).get('days'), null);
});
test('aggregate location keys never become record editing IDs', () => {
  assert.equal(reportRecord('venues', { id: 'aggregate', organizationId: 'b' }), null);
  assert.equal(reportRecord('regions', { id: 'Orlando' }), null);
  assert.equal(reportRecord('events', { id: 'aggregate' }), null);
  assert.deepEqual(reportRecord('events', { id: 'aggregate', eventId: 'canonical' }), ['events', 'canonical']);
  assert.deepEqual(reportRecord('purchases', { orderId: 'order' }), ['orders', 'order']);
  assert.deepEqual(reportRecord('businesses', { id: 'creator:u', creatorUserId: 'u' }), ['users', 'u']);
});
test('invalid serialized drill state is discarded and optional people entries scope purchases', () => {
  assert.deepEqual(reportPath(new URLSearchParams('drill=%7Bbad')), []);
  const params = new URLSearchParams({ drill: JSON.stringify([{ kind: 'customers', id: 'c', label: 'Customer' }]) });
  assert.equal(new URLSearchParams(reportRequest(params)).get('customerId'), 'c');
  assert.equal(nextReportKind('customers'), 'purchases');
});
