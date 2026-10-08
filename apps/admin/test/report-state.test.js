import test from 'node:test';
import assert from 'node:assert/strict';
import { nextReportKind, reportDateIssue, reportPath, reportRecord, reportRequest } from '../src/lib/report-state.js';
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
test('custom report drafts retain invalid dates while calendar and inclusive span errors prevent requests', () => {
  for (const [startDate, endDate, expected] of [
    ['2026-02-31', '2026-03-03', /valid start date/],
    ['2026-02-28', '2026-02-29', /valid end date/],
    ['2024-01-01', '2025-01-01', /at most 366 calendar days/],
    ['2025-01-01', '2026-01-02', /at most 366 calendar days/],
    ['2026-10-02', '2026-10-01', /on or after start date/],
  ]) {
    const params = new URLSearchParams({ period: 'custom', startDate, endDate });
    const draft = params.toString();
    assert.match(reportDateIssue(params).message, expected);
    assert.equal(reportRequest(params), null);
    assert.equal(params.toString(), draft, 'validation leaves the draft editable');
  }
  for (const [startDate, endDate] of [['2024-02-29', '2024-02-29'], ['2024-01-01', '2024-12-31'], ['2025-01-01', '2026-01-01']]) {
    const params = new URLSearchParams({ period: 'custom', startDate, endDate });
    assert.equal(reportDateIssue(params), null);
    const query = new URLSearchParams(reportRequest(params));
    assert.equal(query.get('startDate'), startDate); assert.equal(query.get('endDate'), endDate);
    assert.equal(query.get('days'), null);
  }
  for (const period of ['7', '30', '90', '365']) {
    const params = new URLSearchParams({ period, startDate: 'invalid', endDate: 'invalid' });
    assert.equal(reportDateIssue(params), null);
    assert.equal(new URLSearchParams(reportRequest(params)).get('days'), period);
  }
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
