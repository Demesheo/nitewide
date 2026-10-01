import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedStatuses } from '../src/lib/status-filter.js';
import { supportCaseQuery } from '../src/lib/support-query.js';

test('status filters preserve repeated selections and compatible legacy links', () => {
  assert.deepEqual(selectedStatuses(new URLSearchParams('statuses=active&statuses=suspended')), ['active', 'suspended']);
  assert.deepEqual(selectedStatuses(new URLSearchParams('status=published')), ['published']);
  assert.deepEqual(selectedStatuses(new URLSearchParams('status=all')), []);
  assert.deepEqual(selectedStatuses(new URLSearchParams()), []);
});
test('support statuses use OR query selections while preserving search and pagination', () => {
  const query = new URLSearchParams(supportCaseQuery(new URLSearchParams('statuses=open&statuses=in_progress&search=admission&page=2&category=guestlist')));
  assert.deepEqual(query.getAll('statuses'), ['open', 'in_progress']);
  assert.equal(query.has('status'), false);
  assert.equal(query.get('search'), 'admission');
  assert.equal(query.get('page'), '2');
  assert.equal(query.get('category'), 'guestlist');
  assert.deepEqual(new URLSearchParams(supportCaseQuery(new URLSearchParams('status=resolved'))).getAll('statuses'), ['resolved']);
  assert.equal(new URLSearchParams(supportCaseQuery(new URLSearchParams())).has('statuses'), false);
});
