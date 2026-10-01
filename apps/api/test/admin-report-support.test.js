const test = require('node:test');
const assert = require('node:assert/strict');
const { reportDetailQuery } = require('../src/http/admin-report-schemas');
const support = require('../src/http/admin-support-schemas');
const { defaultPriority,categoryRank } = require('../src/services/admin-support-service');
const format = require('../src/services/report-export-format');
test('admin report and case queries validate canonical identifiers and conservative workflow inputs',() => {
  const id = 'aad53314-3ba5-4113-9f03-a855b9700c4d';
  assert.equal(reportDetailQuery.parse({ businessId: id,offeringId: id,exportTable: 'purchases' }).exportTable,'purchases');
  assert.equal(reportDetailQuery.safeParse({ businessId: id,organizationId: id }).success,false);
  assert.equal(reportDetailQuery.safeParse({ offeringId: id,offeringKind: 'ticket',offeringName: 'VIP' }).success,false);
  assert.equal(reportDetailQuery.safeParse({ startDate: '2026-02-31',endDate: '2026-03-02' }).success,false);
  assert.equal(support.createCase.safeParse({ title: 'Help',description: 'A customer is unable to enter',category: 'admission',reason: 'Reported at door' }).success,true);
  assert.equal(support.updateCase.safeParse({ status: 'resolved',reason: 'Fixed' }).success,false);
  assert.equal(support.updateCase.safeParse({ version: 0,reason: 'Fixed' }).success,false);
  assert.equal(defaultPriority('paid_booking'),'high');
  assert.ok(categoryRank('admission') < categoryRank('account_access'));
  assert.ok(categoryRank('account_access') < categoryRank('reporting'));
});
test('admin CSVs preserve canonical IDs and leave unavailable modeled costs empty',() => {
  const metadata = { selected: 'purchases',audience: 'admin',range: { timezone: 'UTC',startDate: '2026-10-01',endDate: '2026-10-01' } };
  assert.match(format.header(metadata),/Purchase ID/);
  const row = { orderId: 'purchase-id',businessId: 'business-id',eventId: 'event-id',customerId: 'customer-id',label: '=Formula',salesCents: 1000,
    faceValueSalesCents: 1000,addedBuyerFeesCents: 200,customerPaidCents: 1200,recordedCommissionsCents: 0,businessProceedsBeforeProviderCents: 1000,
    modeledProcessingCents: null,modeledContributionCents: null,demo: true };
  assert.match(format.line('purchases',row,metadata),/"purchase-id","business-id","event-id","customer-id","'=Formula"/);
  assert.match(format.line('purchases',row,metadata),/"10.00","","","true"/);
});
test('support case status selections accept scalar or repeated values, clear to all, and reject ambiguous or unbounded input',() => {
  assert.deepEqual(support.caseQuery.parse({}).statuses,[]);
  assert.deepEqual(support.caseQuery.parse({ statuses: [] }).statuses,[]);
  assert.deepEqual(support.caseQuery.parse({ statuses: 'open' }).statuses,['open']);
  assert.deepEqual(support.caseQuery.parse({ statuses: ['open','in_progress','open'] }).statuses,['open','in_progress','open']);
  assert.deepEqual(support.caseQuery.parse({ status: 'all',statuses: ['resolved','closed'] }).statuses,['resolved','closed']);
  assert.equal(support.caseQuery.parse({ status: 'open' }).status,'open');
  assert.equal(support.caseQuery.parse({ status: 'open',statuses: [] }).status,'open');
  for (const input of [{ statuses: 'invalid' },{ statuses: ['open','invalid'] },{ statuses: ['all'] },{ statuses: '' },
    { statuses: ['open',null] },{ statuses: Array(9).fill('open') },{ status: 'open',statuses: ['open'] },{ status: 'resolved',statuses: ['closed'] }]) {
    assert.equal(support.caseQuery.safeParse(input).success,false,JSON.stringify(input));
  }
  assert.equal(support.caseQuery.parse({ statuses: Array(8).fill('open') }).statuses.length,8);
});
