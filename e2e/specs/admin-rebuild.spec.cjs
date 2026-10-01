const { test, expect, login, adminSection, businessSection, expectNoOverflow } = require('../fixtures.cjs');

const uuid = (number) => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const business = { id: uuid(1), name: 'Evolve Promo', slug: 'evolve-promo', status: 'active', lifecycleState: 'active', version: 3, venueIds: [], createdAt: '2026-09-01T12:00:00Z' };
const event = { id: uuid(2), title: 'Friday at Evolve', organizationId: business.id, creatorUserId: uuid(3), locationId: null, status: 'published', lifecycleState: 'active', version: 4, startsAt: '2026-10-10T23:00:00Z', endsAt: '2026-10-11T03:00:00Z', summary: 'A night together', description: 'Doors at seven.', guestlistCapacity: 20, capacity: 200, isDiscoverable: true, location: { name: 'Guest venue', addressLine1: '1 Main St', city: 'Orlando', region: 'FL', countryCode: 'US', timezone: 'America/New_York', privacy: 'public' }, offerings: [{ id: uuid(4), name: 'General admission', kind: 'ticket', priceCents: 1500, quantityTotal: 50, quantitySold: 2, inventoryMode: 'finite', entriesPerUnit: 1, minPerOrder: 1, maxPerOrder: 10, isActive: true, visibility: 'public' }] };
const fields = [{ key: 'displayName', label: 'Display name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email', required: true }, { key: 'phone', label: 'Phone', type: 'tel' }];
const resources = [{ key: 'organizations', label: 'Businesses', title: 'name', canEdit: true, canCreate: false, fields: [], editFields: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'locationId', label: 'Saved location', type: 'reference', resource: 'locations' }, { key: 'venueIds', label: 'Associated venues', type: 'references', resource: 'locations' }, { key: 'businessType', label: 'Business type', type: 'select', options: ['organization', 'venue'] }], actions: [{ id: 'suspend', lifecycle: true }, { id: 'archive', lifecycle: true }, { id: 'restore', lifecycle: true }] }, { key: 'users', label: 'People', title: 'displayName', canEdit: true, canCreate: true, fields, editFields: fields, actions: [{ id: 'suspend', lifecycle: true }, { id: 'archive', lifecycle: true }, { id: 'restore', lifecycle: true }] }, { key: 'events', label: 'Events', title: 'title', canEdit: true, canCreate: false, fields: [], editFields: [], actions: [{ id: 'cancel', label: 'Cancel event' }, { id: 'archive', lifecycle: true }] }, ...['offerings', 'orders', 'audit', 'locations', 'onboarding_invitations', 'email_outbox'].map((key) => ({ key, label: key, title: 'name', canEdit: key === 'locations', canCreate: false, fields: [], editFields: [], actions: [] }))];

function matchesStatus(record, status, resource) {
  if (['suspended', 'archived'].includes(status)) return record.lifecycleState === status || (resource === 'organizations' && record.status === status);
  if (resource === 'users') return record.lifecycleState === 'active' && (status === 'disabled' ? record.isActive === false : record.isActive !== false);
  return record.status === status && (!['active', 'draft', 'published'].includes(status) || record.lifecycleState === 'active');
}

async function mockAdmin(page, { role = 'platform_owner' } = {}) {
  const user = { id: uuid(90), email: 'staff@example.test', displayName: 'Admin Staff', isInternalAdmin: true, isActive: true, lifecycleState: 'active', internalAdminRole: role };
  const session = { user, roles: ['internal_admin'], accessToken: 'mocked-local-session' };
  await page.addInitScript((value) => sessionStorage.setItem('nitewide.admin.session', JSON.stringify(value)), session);
  const people = Array.from({ length: 30 }, (_, index) => ({ id: uuid(100 + index), displayName: `Person ${index + 1}`, email: `person${index + 1}@example.test`, phone: '', isActive: true, lifecycleState: 'active', version: 0, createdAt: '2026-09-01T12:00:00Z' }));
  const state = { requests: [], people, cases: [], relatedRows: {}, business: structuredClone(business), venues: [], venueTeam: [], event: structuredClone(event), ownership: { ...business, owners: [{ id: uuid(30), userId: uuid(3), displayName: 'Current Owner', email: 'owner@example.test', isActive: true, financeAuthorized: true }], managers: [], invitations: [] } };
  const summary = { summary: { salesCents: 1500, orders: 1, customers: 1, units: 1, admissions: 1 }, financial: { faceValueSalesCents: 1500, addedBuyerFeesCents: 200, customerPaidCents: 1700, recordedCommissionsCents: 0, businessProceedsBeforeProviderCents: 1500, modeledProcessingCents: 90, modeledContributionCents: 110, unknownModeledOrders: 0 }, daily: [] };
  const paged = (items, params, size = 25) => { const pageNumber = Number(params.get('page') || 1); const pageSize = Number(params.get('pageSize') || size); return { items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), total: items.length, page: pageNumber, pageSize, hasMore: pageNumber * pageSize < items.length }; };
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace('/api', ''); const method = request.method();
    const body = ['POST', 'PATCH', 'PUT'].includes(method) ? request.postDataJSON() : null;
    state.requests.push({ path, method, body, query: url.search });
    let data;
    if (path === '/auth/me') data = session;
    else if (path === '/admin/management/resources') data = [...resources, ...['owners', 'employees', 'venue_access', 'guestlist', 'tickets', 'check_ins', 'team_invitations', 'guestlist_invitations', 'organization_affiliates', 'event_affiliates', 'attributions', 'notifications', 'credentials', 'account_tokens', 'order_items', 'payments'].map((key) => ({ key, label: key.replaceAll('_', ' '), title: 'name', canEdit: false, canCreate: false, fields: [], editFields: [], actions: [] }))].map((item) => role === 'platform_owner' ? item : { ...item, canEdit: false, canCreate: false, actions: [] });
    else if (path === '/admin/reports/bootstrap') data = { organizations: [{ id: business.id, label: business.name }], regions: ['Orlando, FL, US'], optionsTruncated: {} };
    else if (path === '/admin/reports/summary') data = summary;
    else if (path === '/admin/overview/needs-attention') data = paged([], url.searchParams);
    else if (path === '/admin/reports/exports') data = [];
    else if (path === '/admin/reports/businesses') data = paged([{ id: business.id, businessId: business.id, organizationId: business.id, label: business.name, orders: 1, salesCents: 1500, units: 1, ...summary.financial }], url.searchParams);
    else if (path === '/admin/reports/events') data = paged([{ id: event.id, eventId: event.id, businessId: business.id, organizationId: business.id, label: event.title, orders: 1, salesCents: 1500, units: 1 }], url.searchParams);
    else if (path === '/admin/reports/offerings') data = paged([{ id: uuid(4), offeringId: uuid(4), eventId: event.id, label: 'General admission', kind: 'ticket', orders: 1, salesCents: 1500, units: 1 }], url.searchParams);
    else if (path === '/admin/reports/purchases') data = paged([{ id: uuid(5), orderId: uuid(5), eventId: event.id, customerId: people[0].id, label: people[0].displayName, orders: 1, salesCents: 1500, units: 1, paidAt: '2026-10-01T12:00:00Z', ...summary.financial }], url.searchParams);
    else if (/^\/admin\/reports\//.test(path)) data = paged([], url.searchParams);
    else if (path === '/admin/onboarding') data = { id: uuid(40), organizationId: business.id, delivery: 'queued', role: body.recipient.role, financeAuthorized: body.recipient.financeAuthorized };
    else if (path === `/admin/events/${event.id}/editor`) data = { event: state.event, organizations: [{ ...business, canManage: true }], venues: [] };
    else if (path === `/admin/events/${event.id}` && method === 'PUT') { Object.assign(state.event, body, { version: state.event.version + 1 }); data = state.event; }
    else if (path === `/admin/events/${event.id}/notification-preview`) data = { recipients: 12, message: 'Event notices use attendee delivery workflow.' };
    else if (path.startsWith(`/admin/businesses/${business.id}/venues`)) {
      const suffix = path.replace(`/admin/businesses/${business.id}/venues`, '').split('/').filter(Boolean);
      const venue = state.venues.find((item) => item.id === suffix[0]);
      if (suffix[1] === 'team' && method === 'PUT') {
        const person = people.find((item) => item.id === suffix[2]);
        let member = state.venueTeam.find((item) => item.locationId === venue.id && item.userId === person.id);
        if (member) Object.assign(member, body, { version: member.version + 1 });
        else { member = { ...body, id: uuid(4000 + state.venueTeam.length), organizationId: business.id, locationId: venue.id, userId: person.id, displayName: person.displayName, email: person.email, version: 0 }; state.venueTeam.push(member); }
        data = member;
      } else if (suffix[1] === 'team') data = paged(state.venueTeam.filter((item) => item.locationId === venue.id && `${item.displayName} ${item.email}`.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase())), url.searchParams);
      else if (suffix[1] === 'candidates') data = paged(people.filter((item) => `${item.displayName} ${item.email}`.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase())), url.searchParams);
      else if (method === 'POST') { const saved = { ...body.venue, id: uuid(2000 + state.venues.length), organizationId: business.id, lifecycleState: 'active', version: 0 }; state.venues.push(saved); state.business.version++; state.business.venueCount = state.venues.length; data = { venue: saved, organizationVersion: state.business.version }; }
      else if (method === 'PATCH') { Object.assign(venue, body, { version: venue.version + 1 }); data = venue; }
      else if (suffix.length === 1) data = venue;
      else data = paged(state.venues.filter((item) => `${item.name} ${item.addressLine1} ${item.city}`.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase())), url.searchParams);
    }
    else if (path === `/admin/businesses/${business.id}/ownership`) data = state.ownership;
    else if (path === `/admin/businesses/${business.id}/ownership/invitations`) data = { id: uuid(41), delivery: 'queued' };
    else if (path === '/admin/support/cases' && method === 'POST') { const saved = { ...body, id: uuid(50), status: 'open', version: 0, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' }; state.cases.push(saved); data = saved; }
    else if (path === '/admin/support/cases') data = paged(state.cases.filter((item) => (!url.searchParams.getAll('statuses').length || url.searchParams.getAll('statuses').includes(item.status)) && item.title.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase())), url.searchParams);
    else if (/^\/admin\/support\/cases\//.test(path)) { const id = path.split('/')[4]; const saved = state.cases.find((item) => item.id === id); if (method === 'PATCH') { Object.assign(saved, body, { version: saved.version + 1 }); data = saved; } else data = { case: saved, history: [{ id: uuid(60), action: 'admin.support.created', after: { adminReason: 'Booking investigation' }, createdAt: saved?.createdAt }], historyMeta: { total: 1, page: 1, pageSize: 50 } }; }
    else if (/^\/admin\/management\//.test(path)) {
      const [, , , resource, id, actions, action] = path.split('/');
      let rows = state.relatedRows[resource] || (resource === 'users' ? people : resource === 'organizations' ? [state.business] : resource === 'locations' ? state.venues : resource === 'events' ? [state.event] : resource === 'offerings' ? event.offerings : resource === 'orders' ? [{ id: uuid(5), totalCents: 1700, status: 'paid', eventId: event.id }] : []);
      const record = rows.find((item) => item.id === id);
      if (id && method === 'PATCH') { Object.assign(record, body, { version: record.version + 1 }); data = record; }
      else if (actions === 'actions') { record.lifecycleState = action === 'restore' ? 'active' : action === 'archive' ? 'archived' : 'suspended'; record.version++; data = record; }
      else if (id) data = record;
      else { const needle = (url.searchParams.get('search') || '').toLowerCase(); rows = rows.filter((item) => [item.displayName, item.name, item.title, item.email, item.phone, item.organization?.name, item.location?.name, item.id].join(' ').toLowerCase().includes(needle)); if (url.searchParams.getAll('statuses').length) rows = rows.filter((item) => url.searchParams.getAll('statuses').some((status) => matchesStatus(item, status, resource))); if (url.searchParams.get('userId')) { const userId = url.searchParams.get('userId'); if (['team_invitations', 'guestlist_invitations'].includes(resource)) rows = rows.filter((item) => url.searchParams.get('relation') === 'sent' ? item.invitedByUserId === userId : item.acceptedByUserId === userId || item.email === people.find((person) => person.id === userId)?.email); else if (resource !== 'audit') rows = rows.filter((item) => (item.userId || item.buyerUserId || item.holderUserId) === userId); } if (resource === 'events' && (url.searchParams.get('startDate') || url.searchParams.get('endDate'))) rows = rows.filter((item) => { const day = new Intl.DateTimeFormat('en-CA', { timeZone: url.searchParams.get('timezone') || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(item.startsAt)); return (!url.searchParams.get('startDate') || day >= url.searchParams.get('startDate')) && (!url.searchParams.get('endDate') || day <= url.searchParams.get('endDate')); }); data = paged(rows, url.searchParams); }
    }
    else return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: `Unmocked endpoint ${method} ${path}` } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  return state;
}

test('consolidated admin navigation and directories work at phone and desktop widths', async ({ page }) => {
  await mockAdmin(page); await page.goto('/');
  for (const section of ['Overview', 'Businesses', 'Events', 'People', 'Support', 'Analytics', 'Audit']) {
    await adminSection(page, section); await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible(); await expectNoOverflow(page);
  }
});

test('onboarding a manager needs no venue and does not grant ownership', async ({ page }) => {
  const state = await mockAdmin(page); await page.goto('/?section=businesses'); await page.getByRole('button', { name: 'Onboard business', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Onboard business' });
  await dialog.getByLabel('Full name').fill('Morgan Manager'); await dialog.getByLabel('Email', { exact: true }).fill('manager@example.test'); await dialog.getByLabel('Phone', { exact: true }).fill('+14075550199'); await dialog.getByLabel('Initial business role').selectOption('manager');
  await dialog.getByLabel('Grant separate finance permission').check(); await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByLabel('Business name').fill('Evolve Promo'); await expect(dialog.getByLabel('Public slug')).toHaveCount(0); await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog).toContainText('No saved venues'); await expect(dialog).toContainText('Manager with finance permission');
  await dialog.getByLabel('I have confirmed the contact’s authority to represent this business.').check(); await dialog.getByLabel('Required audit reason').fill('Verified business representative'); await dialog.getByRole('button', { name: 'Prepare and invite recipient' }).click();
  await expect(dialog).toContainText('Ownership has not been granted.');
  const sent = state.requests.find((item) => item.path === '/admin/onboarding').body;
  expect(sent).toMatchObject({ kind: 'organization', recipient: { role: 'manager', financeAuthorized: true }, venues: [], confirmedAuthority: true }); expect(JSON.stringify(sent)).not.toContain('password'); await expectNoOverflow(page);
});

test('record page edits use its version and returning restores directory pagination', async ({ page }) => {
  const state = await mockAdmin(page); await page.goto('/?section=people');
  await expect(page.getByText('30 people', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Next', exact: true }).click(); await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await page.getByTestId('admin-record').first().getByRole('button', { name: 'View person' }).click(); await expect(page.getByRole('heading', { name: 'Person 26', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit details', exact: true }).click(); await page.getByLabel(/^Display name/).fill('Person Updated'); await page.getByLabel('Required audit reason').fill('Verified profile correction'); await page.getByRole('button', { name: 'Save audited changes' }).click();
  await expect(page.getByRole('heading', { name: 'Person Updated', exact: true })).toBeVisible(); expect(state.requests.find((item) => item.method === 'PATCH').body).toMatchObject({ version: 0, displayName: 'Person Updated', reason: 'Verified profile correction' });
  await page.getByRole('button', { name: 'Back to results' }).click(); await expect(page.getByText('Page 2 of 2')).toBeVisible(); await expect(page.getByTestId('admin-record').first()).toContainText('Person Updated');
});

test('report drill-down and canonical record navigation retain filters and context', async ({ page }) => {
  const state = await mockAdmin(page); await page.goto('/?section=analytics&period=90&reportSort=name_asc');
  await expect(page.getByRole('heading', { name: 'Businesses', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore events', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Events', exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Explore offerings', exact: true }).click(); await page.getByRole('button', { name: 'Explore purchases', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Purchases', exact: true })).toBeVisible(); const reportUrl = page.url();
  await page.getByRole('button', { name: 'View record', exact: true }).click(); await expect(page.getByRole('heading', { name: `Purchases ${uuid(5).slice(0, 8)}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to report' }).click(); await expect(page).toHaveURL(reportUrl); await expect(page.getByRole('heading', { name: 'Purchases', exact: true })).toBeVisible();
  const purchaseRequest = state.requests.find((item) => item.path === '/admin/reports/purchases'); expect(new URLSearchParams(purchaseRequest.query).get('offeringId')).toBe(uuid(4)); await expectNoOverflow(page);
});

test('secure owner transfer requires explicit outgoing role and acceptance', async ({ page }) => {
  const state = await mockAdmin(page); await page.goto(`/?section=businesses&resource=organizations&record=${business.id}`); await page.getByRole('tab', { name: 'Ownership & finance' }).click();
  await page.getByRole('button', { name: 'Transfer ownership', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Transfer ownership', exact: true });
  await dialog.getByLabel('Incoming owner name').fill('Incoming Owner'); await dialog.getByLabel('Incoming owner email').fill('incoming@example.test'); await dialog.getByLabel('Outgoing owner’s access').selectOption('employee'); await dialog.getByLabel('Required audit reason').fill('Verified authorized ownership transfer');
  await expect(dialog.getByRole('button', { name: 'Prepare secure invitation' })).toBeDisabled(); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Prepare secure invitation' }).click();
  await expect(dialog).toContainText('outgoing owner retains ownership'); expect(state.requests.find((item) => item.path.endsWith('/ownership/invitations')).body).toMatchObject({ outgoingOwnerUserId: uuid(3), outgoingRole: 'employee', version: 3 }); expect(state.ownership.owners).toHaveLength(1);
});

test('support case resolution requires a resolution and versioned audit reason', async ({ page }) => {
  const state = await mockAdmin(page); await page.goto('/?section=support'); await page.getByRole('button', { name: 'Create support case' }).click();
  let dialog = page.getByRole('dialog'); await dialog.getByLabel('Case title').fill('Paid booking cannot admit'); await dialog.getByLabel('Issue description').fill('Customer needs admission support.'); await dialog.getByLabel('Required audit reason').fill('Booking investigation'); await dialog.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paid booking cannot admit' })).toBeVisible(); await page.getByRole('button', { name: 'Update case' }).click(); dialog = page.getByRole('dialog'); await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption('resolved'); await dialog.getByLabel('Resolution', { exact: true }).fill('Confirmed valid booking and restored admission.'); await dialog.getByLabel('Required audit reason').fill('Support resolution verified'); await dialog.getByRole('button', { name: 'Save case changes' }).click();
  await expect(page.getByRole('heading', { name: 'Resolution', exact: true })).toBeVisible(); expect(state.requests.find((item) => item.path.startsWith('/admin/support/cases/') && item.method === 'PATCH').body).toMatchObject({ version: 0, status: 'resolved' }); expect(state.requests.find((item) => item.path === '/admin/support/cases' && item.method === 'GET').query).toContain('category=all');
});

test('read-only staff can view records but cannot onboard or alter ownership', async ({ page }) => {
  const state = await mockAdmin(page, { role: 'read_only' }); state.relatedRows.onboarding_invitations = [{ id: uuid(42), email: 'pending@example.test', userId: state.people[0].id, version: 0, expiresAt: '2027-01-01T12:00:00Z', acceptedAt: null, revokedAt: null }]; await page.goto('/?section=businesses'); await expect(page.getByRole('button', { name: 'Onboard business', exact: true })).toHaveCount(0);
  await page.getByTestId('admin-record').getByRole('button', { name: 'View business' }).click(); await expect(page.getByRole('button', { name: 'Edit details', exact: true })).toHaveCount(0); await expect(page.getByRole('tab', { name: 'Ownership & finance' })).toHaveCount(0);
  await adminSection(page, 'Support'); await expect(page.getByRole('button', { name: 'Create support case', exact: true })).toHaveCount(0);
  await page.goto(`/?section=businesses&resource=onboarding_invitations&record=${uuid(42)}`); await expect(page.getByRole('heading', { name: 'pending@example.test', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Resend setup email', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Revoke setup invitation', exact: true })).toHaveCount(0);
});

test('authenticated API identity enables authorized admin controls', async ({ page, fixture }) => {
  await login(page, fixture, 'admin');
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nitewide.admin.session')));
  expect(session.user.isInternalAdmin).toBe(true);
  await adminSection(page, 'Businesses');
  await expect(page.getByRole('button', { name: 'Onboard business', exact: true })).toBeVisible();
  await adminSection(page, 'Analytics');
  await expect(page.getByRole('heading', { name: 'Businesses', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shared event editor retains ticket controls and confirms affected attendee count', async ({ page }) => {
  const state = await mockAdmin(page); await page.goto(`/?section=events&resource=events&record=${event.id}`); await page.getByRole('button', { name: 'Edit details', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event', exact: true });
  await editor.getByLabel('Starts at (venue time)').fill('2026-10-10T20:00'); await editor.getByLabel('Reason for this change').fill('Verified event schedule change'); await editor.getByRole('button', { name: 'Continue', exact: true }).click(); await editor.getByRole('button', { name: 'Continue', exact: true }).click();
  await editor.locator('summary').filter({ hasText: 'General admission' }).click(); await expect(editor.getByLabel('Price per unit ($)')).toBeVisible(); await expect(editor.getByLabel('Guests per unit')).toBeDisabled(); await expectNoOverflow(page);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click(); const confirmation = page.getByRole('dialog', { name: 'Confirm significant event change' }); await expect(confirmation).toContainText('12 affected attendees');
  expect(state.requests.filter((item) => item.path === `/admin/events/${event.id}` && item.method === 'PUT')).toHaveLength(0); await confirmation.getByRole('button', { name: 'Confirm change and notify' }).click(); await expect(editor).toHaveCount(0);
  expect(state.requests.find((item) => item.path === `/admin/events/${event.id}` && item.method === 'PUT').body).toMatchObject({ version: 4, adminReason: 'Verified event schedule change', offerings: [expect.objectContaining({ id: uuid(4), entriesPerUnit: 1 })] });
});

test('transient session verification preserves sign-in and hides cached workspace until retry', async ({ page }) => {
  await mockAdmin(page); let attempts = 0;
  await page.route('**/api/auth/me', (route) => ++attempts === 1 ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Session verification temporarily unavailable' } }) }) : route.fallback());
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Unable to verify your session' })).toBeVisible(); expect(await page.evaluate(() => Boolean(sessionStorage.getItem('nitewide.admin.session')))).toBe(true); await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry verification' }).click(); await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible(); expect(attempts).toBe(2);
});

test('event record shows the flyer and a clear fallback when no image exists', async ({ page }) => {
  const state = await mockAdmin(page);
  state.event.imageUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#440327"/><text x="30" y="180" fill="#fff">Friday flyer</text></svg>');
  await page.goto(`/?section=events&resource=events&record=${event.id}`); const flyer = page.getByRole('img', { name: `${event.title} event flyer`, exact: true }); await expect(flyer).toBeVisible();
  expect(await flyer.evaluate((img) => img.naturalWidth)).toBe(240); const bounds = await flyer.boundingBox(); expect(bounds.width).toBeLessThanOrEqual(page.viewportSize().width <= 720 ? 120 : 160); expect(bounds.height).toBeLessThanOrEqual(page.viewportSize().width <= 720 ? 180 : 240); await expectNoOverflow(page);
  const header = page.getByRole('region', { name: 'Event summary' }); await expect(header).toContainText('Guest venue'); await expect(header).toContainText('1 Main St'); await expect(page.getByRole('heading', { name: event.title, exact: true })).toHaveCount(1);
  const geometry = await header.evaluate((node) => ({ display: getComputedStyle(node).display, height: node.getBoundingClientRect().height })); expect(geometry.display).toBe('grid'); if (page.viewportSize().width >= 900) { expect(geometry.height).toBeLessThan(260); expect((await page.getByRole('heading', { name: event.title, exact: true }).boundingBox()).x).toBeGreaterThan(bounds.x + bounds.width); }
  await expect(page.getByRole('heading', { name: 'Event information', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Admission & discovery', exact: true })).toBeVisible();
  state.event.imageUrl = null; await page.getByRole('button', { name: 'Refresh record', exact: true }).click(); await expect(page.getByText('No event flyer has been added.')).toBeVisible(); await expect(flyer).toHaveCount(0);
});

test('business venues use scoped search and paging instead of redundant business selectors', async ({ page }) => {
  const state = await mockAdmin(page);
  state.venues = Array.from({ length: 1030 }, (_, index) => ({ id: uuid(2000 + index), organizationId: business.id, name: `Venue ${String(index + 1).padStart(4, '0')}`, addressLine1: `${index + 1} Main Street`, city: 'Orlando', region: 'FL', countryCode: 'US', timezone: 'America/New_York', privacy: 'public', lifecycleState: 'active', version: 0 }));
  Object.assign(state.business, { venueCount: 1030, venueIds: state.venues.map((item) => item.id), locationId: state.venues[0].id, businessType: 'venue' });
  await page.goto(`/?section=businesses&resource=organizations&record=${business.id}`);
  await expect(page.getByRole('button', { name: 'View venue', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit details', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Edit business' });
  await expect(dialog.getByLabel('Saved location')).toHaveCount(0); await expect(dialog.getByLabel('Associated venues')).toHaveCount(0); await expect(dialog.getByLabel('Business type')).toHaveCount(0); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Venues', exact: true }).click(); await expect(page.getByTestId('business-venue')).toHaveCount(25); await expect(page.getByText('1030 venues match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click(); await expect(page.getByText('Page 2 of 42')).toBeVisible(); const businessUrl = page.url();
  await page.getByTestId('business-venue').first().getByRole('button', { name: 'View venue', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Venue 0026', exact: true })).toBeVisible(); await page.getByRole('button', { name: /Back to business$/ }).click(); await expect(page).toHaveURL(businessUrl);
  await page.getByRole('textbox', { name: 'Search business venues', exact: true }).fill('Venue 1029'); await page.getByRole('search', { name: 'Search business venues' }).getByRole('button', { name: 'Search', exact: true }).click(); await expect(page.getByTestId('business-venue')).toHaveCount(1); await expect(page.getByTestId('business-venue')).toContainText('Venue 1029');
  const query = new URLSearchParams(state.requests.findLast((item) => item.path.endsWith('/venues') && item.method === 'GET').query); expect(query.get('pageSize')).toBe('25'); expect(query.get('search')).toBe('Venue 1029'); await expectNoOverflow(page);
});

test('business can create and rename its own venue and assign venue-only staff', async ({ page }) => {
  const state = await mockAdmin(page); await page.goto(`/?section=businesses&resource=organizations&record=${business.id}&tab=venues`); await expect(page.getByText('No venues linked to this business.')).toBeVisible();
  await page.getByRole('button', { name: 'Create venue', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Create business venue' });
  await dialog.getByLabel('Venue name', { exact: true }).fill('Grand Room'); await dialog.getByLabel('Street address', { exact: true }).fill('100 Main Street'); await dialog.getByLabel('City', { exact: true }).fill('Orlando'); await dialog.getByLabel('Required audit reason').fill('Verified business venue setup'); await dialog.getByRole('button', { name: 'Create venue', exact: true }).click();
  await expect(page.getByTestId('business-venue')).toContainText('Grand Room'); const created = state.requests.find((item) => item.path.endsWith('/venues') && item.method === 'POST'); expect(created.body).toMatchObject({ version: 3, venue: { name: 'Grand Room', city: 'Orlando' } }); expect(created.body).not.toHaveProperty('locationId');
  await page.getByRole('button', { name: 'Edit venue', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Edit venue', exact: true }); await dialog.getByLabel('Venue name', { exact: true }).fill('Grand Hall'); await dialog.getByLabel('Required audit reason').fill('Confirmed venue name update'); await dialog.getByRole('button', { name: 'Save venue changes' }).click(); await expect(page.getByTestId('business-venue')).toContainText('Grand Hall');
  expect(state.requests.find((item) => item.path.includes('/venues/') && item.method === 'PATCH').body).toMatchObject({ name: 'Grand Hall', version: 0 });
  await page.getByRole('button', { name: 'Venue team', exact: true }).click(); await page.getByRole('button', { name: 'Add venue team member', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Add venue team member', exact: true });
  await dialog.getByLabel('Person', { exact: true }).selectOption(state.people[0].id); await dialog.getByRole('combobox', { name: 'Venue role', exact: true }).selectOption('promoter'); await dialog.getByLabel('Required audit reason').fill('Approved venue promoter access'); await dialog.getByRole('button', { name: 'Add team member', exact: true }).click(); await expect(page.getByTestId('venue-team-member')).toContainText('promoter · active');
  expect(state.requests.find((item) => item.path.includes('/team/') && item.method === 'PUT').body).toMatchObject({ role: 'promoter', status: 'active', version: null });
  await page.getByRole('button', { name: 'Update venue access', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Update venue access', exact: true }); await dialog.getByRole('combobox', { name: 'Venue access', exact: true }).selectOption('inactive'); await dialog.getByLabel('Required audit reason').fill('Revoked venue-only access'); await dialog.getByRole('button', { name: 'Save venue access' }).click(); await expect(page.getByTestId('venue-team-member')).toContainText('promoter · inactive');
  expect(state.requests.findLast((item) => item.path.includes('/team/') && item.method === 'PUT').body).toMatchObject({ status: 'inactive', version: 0 }); await expectNoOverflow(page);
});

test('event saved-venue picker looks up selected records and searches beyond its first page', async ({ page }) => {
  const state = await mockAdmin(page);
  state.venues = Array.from({ length: 1030 }, (_, index) => ({ id: uuid(2000 + index), organizationId: business.id, name: `Venue ${String(index + 1).padStart(4, '0')}`, addressLine1: `${index + 1} Main Street`, city: 'Orlando', region: 'FL', countryCode: 'US', timezone: 'America/New_York', privacy: 'public', lifecycleState: 'active', version: 0 }));
  state.event.locationId = state.venues[1029].id; state.event.location = state.venues[1029]; state.event.isManagedVenue = true;
  await page.goto(`/?section=events&resource=events&record=${event.id}`); await page.getByRole('button', { name: 'Edit details', exact: true }).click(); const editor = page.getByRole('dialog', { name: 'Edit event', exact: true });
  await editor.getByLabel('Reason for this change').fill('Verified event venue selection'); await editor.getByRole('button', { name: 'Continue', exact: true }).click();
  const choices = editor.getByRole('combobox', { name: 'Saved venue', exact: true }); await expect(choices).toHaveValue(state.venues[1029].id); await expect(choices.getByRole('option', { name: 'Venue 1030', exact: true })).toHaveCount(1); expect(await choices.locator('option').count()).toBeLessThanOrEqual(27);
  await editor.getByRole('textbox', { name: 'Search business venues', exact: true }).fill('Venue 0101'); await editor.getByRole('search', { name: 'Search business venues' }).getByRole('button', { name: 'Search', exact: true }).click(); await expect(choices.getByRole('option', { name: 'Venue 0101 · Orlando, FL', exact: true })).toBeAttached(); await choices.selectOption(state.venues[100].id); await expect(editor.locator('.venue-address-card')).toContainText('101 Main Street');
  expect(state.requests.filter((item) => item.path === `/admin/events/${event.id}` && item.method === 'PUT')).toHaveLength(0); await expectNoOverflow(page);
});

test('business-facing venue creation and venue-only staff use the real scoped API', async ({ page, fixture }) => {
  await login(page, fixture, 'business'); await businessSection(page, 'Organization'); const venues = page.getByRole('region', { name: 'Business venues', exact: true });
  await venues.getByRole('button', { name: 'Create venue', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Create business venue' }); await dialog.getByLabel('Venue name', { exact: true }).fill('Second Business Hall'); await dialog.getByLabel('Street address', { exact: true }).fill('200 Example Street'); await dialog.getByLabel('City', { exact: true }).fill('Orlando'); await dialog.getByLabel('Required audit reason').fill('Verified scoped venue creation'); await dialog.getByRole('button', { name: 'Create venue', exact: true }).click();
  const row = venues.getByTestId('business-venue').filter({ hasText: 'Second Business Hall' }); await expect(row).toBeVisible(); await row.getByRole('button', { name: 'Edit venue', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Edit venue', exact: true }); await dialog.getByLabel('Venue name', { exact: true }).fill('Renamed Business Hall'); await dialog.getByLabel('Required audit reason').fill('Confirmed scoped venue rename'); await dialog.getByRole('button', { name: 'Save venue changes' }).click();
  await venues.getByTestId('business-venue').filter({ hasText: 'Renamed Business Hall' }).getByRole('button', { name: 'Venue team', exact: true }).click(); await page.getByRole('button', { name: 'Add venue team member', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Add venue team member', exact: true }); await dialog.getByRole('textbox', { name: 'Search people', exact: true }).fill(fixture.accounts.promoter.email); await dialog.getByRole('search', { name: 'Search people' }).getByRole('button', { name: 'Search', exact: true }).click(); await dialog.getByRole('combobox', { name: 'Person', exact: true }).selectOption(fixture.accounts.promoter.id); await expect(dialog.getByRole('option', { name: 'Manager', exact: true })).toHaveCount(0); await dialog.getByRole('combobox', { name: 'Venue role', exact: true }).selectOption('promoter'); await dialog.getByLabel('Required audit reason').fill('Approved venue-scoped promoter'); await dialog.getByRole('button', { name: 'Add team member', exact: true }).click();
  await expect(page.getByTestId('venue-team-member')).toContainText('Leo Promoter'); await expect(page.getByTestId('venue-team-member')).toContainText('promoter · active'); await expectNoOverflow(page); await expect(page.getByRole('alert')).toHaveCount(0);
});

test('flyer preview expands proportionally within viewport bounds and closes accessibly', async ({ page }, testInfo) => {
  const state = await mockAdmin(page); state.event.imageUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="2700"><defs><linearGradient id="bg"><stop stop-color="#280727"/><stop offset="1" stop-color="#091832"/></linearGradient></defs><rect width="1800" height="2700" fill="url(#bg)"/><circle cx="950" cy="1250" r="550" fill="#6f416f" opacity=".5"/><text x="150" y="500" font-size="160" fill="#eee">FRIDAY</text><text x="150" y="690" font-size="135" fill="#c4a5e0">AT EVOLVE</text><text x="150" y="2250" font-size="80" fill="#eee">ORLANDO · DOORS AT SEVEN</text></svg>');
  await page.goto(`/?section=events&resource=events&record=${event.id}`); const thumbnail = page.getByRole('button', { name: 'View event flyer', exact: true }); await expect(thumbnail).toBeVisible(); const small = await thumbnail.getByRole('img').boundingBox(); const device = testInfo.project.name.includes('iphone') ? 'mobile-390' : 'desktop-1440'; await page.screenshot({ path: `/private/tmp/nitewide-event-record-${device}.png`, fullPage: true }); await page.screenshot({ path: `/private/tmp/nitewide-event-record-viewport-${device}.png`, fullPage: false, scale: 'css' });
  await thumbnail.click(); const dialog = page.getByRole('dialog', { name: 'Event flyer', exact: true }); await expect(dialog).toBeVisible(); const image = dialog.getByRole('img', { name: `${event.title} event flyer`, exact: true }); const large = await image.boundingBox(); const popup = await dialog.boundingBox(); const viewport = page.viewportSize(); expect(large.height).toBeGreaterThan(small.height); expect(large.width).toBeGreaterThan(small.width); expect(large.height).toBeLessThanOrEqual(Math.min(viewport.height * (viewport.width <= 720 ? .68 : .72), viewport.width <= 720 ? 560 : 720) + 1); expect(large.width / large.height).toBeCloseTo(2 / 3, 2); expect(popup.x).toBeGreaterThanOrEqual(0); expect(popup.y).toBeGreaterThanOrEqual(0); expect(popup.x + popup.width).toBeLessThanOrEqual(viewport.width + 1); expect(popup.y + popup.height).toBeLessThanOrEqual(viewport.height + 1);
  const closeBounds = await dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox(); expect(closeBounds.width).toBeGreaterThanOrEqual(44); expect(closeBounds.height).toBeGreaterThanOrEqual(44); await page.screenshot({ path: `/private/tmp/nitewide-event-flyer-${device}.png`, fullPage: true }); await page.screenshot({ path: `/private/tmp/nitewide-event-flyer-viewport-${device}.png`, fullPage: false, scale: 'css' }); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(thumbnail).toBeFocused();
  await thumbnail.click(); await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(thumbnail).toBeFocused(); await expectNoOverflow(page);
  await thumbnail.click(); await expect(dialog).toBeVisible(); await dialog.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => null)))); await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 4, y: 4 } }); await expect(dialog).toHaveCount(0); await expect(thumbnail).toBeFocused();
  await page.route('**/broken-flyer.png', (route) => route.fulfill({ status: 404, body: 'Missing image' })); state.event.imageUrl = '/broken-flyer.png'; await page.getByRole('button', { name: 'Refresh record', exact: true }).click(); await expect(page.getByText('Event flyer is unavailable.')).toBeVisible(); await expect(thumbnail).toHaveCount(0);
});

test('event dates apply immediately without submitting text drafts and stay compact', async ({ page }, testInfo) => {
  const state = await mockAdmin(page); await page.goto('/?section=events&resource=events&page=3'); const form = page.getByRole('search', { name: 'Search events', exact: true }); await expect(form).toBeVisible();
  const search = form.getByRole('searchbox', { name: 'Search events', exact: true }); const start = form.getByLabel('Start date', { exact: true }); const end = form.getByLabel('End date', { exact: true }); const submit = form.getByRole('button', { name: 'Search', exact: true });
  await expect(page.getByText('Includes events starting within these dates. The end date includes the whole day.', { exact: true })).toHaveCount(0);
  const before = state.requests.filter((item) => item.path === '/admin/management/events' && item.method === 'GET').length; await search.fill('Friday'); expect(state.requests.filter((item) => item.path === '/admin/management/events' && item.method === 'GET')).toHaveLength(before);
  await start.fill('2026-10-01'); await expect(page).toHaveURL(/startDate=2026-10-01/); await expect(page).toHaveURL(/page=1/); await expect(search).toHaveValue('Friday'); expect(new URL(page.url()).searchParams.has('search')).toBe(false);
  await end.fill('2026-10-02'); await expect(page.getByTestId('admin-record')).toHaveCount(0); const requests = state.requests.filter((item) => item.path === '/admin/management/events').length; await start.fill('2026-10-10'); await expect(form.getByRole('alert')).toContainText('End date must be'); expect(state.requests.filter((item) => item.path === '/admin/management/events')).toHaveLength(requests);
  await end.fill('2026-10-10'); await expect(page.getByTestId('admin-record')).toHaveCount(1); await expect(form.getByRole('alert')).toHaveCount(0); await expect(search).toHaveValue('Friday'); expect(new URLSearchParams(state.requests.findLast((item) => item.path === '/admin/management/events').query).get('search')).toBe('');
  await submit.click(); await expect(page).toHaveURL(/search=Friday/); const origin = page.url(); const sent = new URLSearchParams(state.requests.findLast((item) => item.path === '/admin/management/events').query); expect(sent.get('startDate')).toBe('2026-10-10'); expect(sent.get('endDate')).toBe('2026-10-10'); expect(sent.get('timezone')).toBeTruthy();
  const bounds = await Promise.all([search, submit, start, end].map((control) => control.boundingBox())); bounds.forEach((box) => expect(box.height).toBe(44));
  if (page.viewportSize().width >= 900) { const sortFields = await Promise.all([form.getByRole('combobox', { name: 'Sort records by' }), form.getByRole('combobox', { name: 'Sort direction' })].map((field) => field.boundingBox())); const cluster = [bounds[2], bounds[3], ...sortFields]; for (let index = 1; index < cluster.length; index++) expect(cluster[index].x - cluster[index - 1].x - cluster[index - 1].width).toBe(12); }
  if (page.viewportSize().width >= 900) { expect(bounds[2].width).toBe(160); expect(bounds[3].width).toBe(160); expect(bounds[0].width).toBeGreaterThan(300); expect(bounds[1].x + bounds[1].width - bounds[0].x).toBe(480); bounds.slice(1).forEach((box) => expect(Math.abs(box.y - bounds[0].y)).toBeLessThan(1)); expect(bounds[2].x).toBeGreaterThan(bounds[1].x + bounds[1].width); const sortBounds = await form.getByRole('group', { name: 'Sort records' }).boundingBox(); expect(sortBounds.x).toBeGreaterThan(bounds[3].x + bounds[3].width); expect(Math.abs(sortBounds.x + sortBounds.width - (await form.boundingBox()).x - (await form.boundingBox()).width)).toBeLessThan(1); } else { expect(bounds[2].y).toBeGreaterThan(bounds[0].y + bounds[0].height); expect(Math.abs(bounds[2].y - bounds[3].y)).toBeLessThan(1); expect(bounds[2].width).toBeGreaterThanOrEqual(150); expect(bounds[3].width).toBeGreaterThanOrEqual(150); }
  await expect(page.getByRole('button', { name: 'Apply dates', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Reset dates', exact: true })).toHaveCount(0); await expectNoOverflow(page); const device = testInfo.project.name.includes('iphone') ? 'mobile-390' : 'desktop-1440'; await page.screenshot({ path: `/private/tmp/nitewide-events-dates-viewport-${device}.png`, fullPage: false, scale: 'css' }); console.log('Event search geometry', testInfo.project.name, JSON.stringify(bounds));
  await page.getByTestId('admin-record').getByRole('button', { name: 'View event', exact: true }).click(); await expect(page.getByRole('heading', { name: event.title, exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Back to results' }).click(); await expect(page).toHaveURL(origin); await expect(start).toHaveValue('2026-10-10'); await expect(end).toHaveValue('2026-10-10');
  await start.fill(''); await expect(page).not.toHaveURL(/startDate=/); await expect(page).toHaveURL(/endDate=2026-10-10/); await end.fill(''); await expect(page).not.toHaveURL(/endDate=|timezone=/); await search.fill('Nothing matches'); await search.press('Enter'); await expect(page.getByTestId('admin-record')).toHaveCount(0); await expectNoOverflow(page);
  if (page.viewportSize().width >= 900) { for (const width of [1200, 1024]) { await page.setViewportSize({ width, height: 900 }); await expectNoOverflow(page); const dates = await end.boundingBox(); const sort = await form.getByRole('group', { name: 'Sort records' }).boundingBox(); expect(Math.abs(dates.x + dates.width - sort.x - sort.width)).toBeLessThan(1); expect(dates.y).toBeLessThan(sort.y); } }
});

test('People has a compact submitted search and multiple account status filters', async ({ page }, testInfo) => {
  const state = await mockAdmin(page); state.people[1].isActive = false; state.people[2].lifecycleState = 'suspended'; state.people[3].lifecycleState = 'archived';
  await page.goto('/?section=people&resource=employees'); await expect(page.getByText('30 people', { exact: true })).toBeVisible(); await expect(page.getByRole('combobox', { name: 'Records', exact: true })).toHaveCount(0);
  const search = page.getByRole('search', { name: 'Search people', exact: true }); const input = search.getByRole('textbox'); await expect(input).toHaveAttribute('placeholder', 'Search'); await expect(input).toHaveAccessibleDescription('Search by name, phone, email or ID.');
  const before = state.requests.filter((request) => request.path === '/admin/management/users').length; await input.fill('Person 2'); expect(state.requests.filter((request) => request.path === '/admin/management/users')).toHaveLength(before); expect(new URL(page.url()).searchParams.has('search')).toBe(false);
  await search.getByRole('button', { name: 'Search', exact: true }).click(); await expect(page.getByText('11 people', { exact: true })).toBeVisible(); await input.fill(''); await input.press('Enter'); await expect(page.getByText('30 people', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Status', exact: true }).click(); await page.getByRole('checkbox', { name: 'Disabled', exact: true }).check(); await expect(page.getByText('1 person', { exact: true })).toBeVisible(); await page.getByRole('checkbox', { name: 'Suspended', exact: true }).check(); await page.keyboard.press('Escape'); await expect(page.getByTestId('admin-record')).toHaveCount(2); expect(new URL(page.url()).searchParams.getAll('statuses')).toEqual(['disabled', 'suspended']);
  const direction = page.getByRole('combobox', { name: 'Sort direction', exact: true }); await expect(direction.getByRole('option')).toHaveText(['Ascending', 'Descending']); await direction.selectOption('asc'); const origin = page.url(); await page.getByTestId('admin-record').first().getByRole('button', { name: 'View person' }).click(); await expect(page.getByRole('heading', { name: 'Contact details', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Back to results' }).click(); await expect(page).toHaveURL(origin);
  await page.getByRole('button', { name: 'Status', exact: true }).click(); await page.getByRole('button', { name: 'Clear', exact: true }).click(); await page.keyboard.press('Escape'); await expect(page.getByText('30 people', { exact: true })).toBeVisible();
  const searchBounds = await search.boundingBox(); const inputBounds = await input.boundingBox(); const buttonBounds = await search.getByRole('button', { name: 'Search', exact: true }).boundingBox(); expect(searchBounds.width).toBeLessThanOrEqual(520); expect(inputBounds.width).toBeGreaterThan(page.viewportSize().width < 720 ? 190 : 250); expect(Math.abs(inputBounds.y - buttonBounds.y)).toBeLessThan(1); expect(inputBounds.height).toBe(44); expect(buttonBounds.height).toBe(44); await expectNoOverflow(page);
  await page.screenshot({ path: `/private/tmp/nitewide-people-${testInfo.project.name.includes('iphone') ? 'mobile-390' : 'desktop-1440'}.png`, fullPage: true });
});

test('workspace statuses support multiple choices and Clear across businesses, events and cases', async ({ page }) => {
  const state = await mockAdmin(page);
  state.relatedRows.organizations = [state.business, { ...business, id: uuid(810), name: 'Closed workspace', status: 'closed' }, { ...business, id: uuid(811), name: 'Suspended workspace', status: 'suspended' }];
  state.relatedRows.events = [state.event, { ...event, id: uuid(812), title: 'Draft event', status: 'draft' }, { ...event, id: uuid(813), title: 'Completed event', status: 'completed' }];
  state.cases = ['open', 'in_progress', 'resolved'].map((status, index) => ({ id: uuid(820 + index), title: `${status} case`, category: 'admission', priority: 'normal', status, createdAt: '2026-10-01T12:00:00Z' }));
  await page.goto('/?section=businesses');
  for (const [section, choices, path, recordCount] of [['Businesses', ['Active', 'Closed'], '/admin/management/organizations', '2 businesses'], ['Events', ['Published', 'Draft'], '/admin/management/events', '2 events'], ['Support', ['Open', 'In progress'], '/admin/support/cases', '2 cases']]) {
    await adminSection(page, section); await page.getByRole('button', { name: 'Status', exact: true }).click();
    for (const choice of choices) await page.getByRole('checkbox', { name: choice, exact: true }).check();
    await expect(page.getByText(recordCount, { exact: true })).toBeVisible(); const query = new URLSearchParams(state.requests.findLast((item) => item.path === path).query); expect(query.getAll('statuses')).toHaveLength(2); expect(query.get('status') || '').toBe('');
    await page.getByRole('button', { name: 'Clear', exact: true }).click(); await page.keyboard.press('Escape'); expect(new URL(page.url()).searchParams.has('statuses')).toBe(false); await expect(page.getByText(section === 'Support' ? '3 cases' : `3 ${section.toLowerCase()}`, { exact: true })).toBeVisible(); await expectNoOverflow(page);
  }
});

test('sorting stays grouped at the right edge on every existing Admin sort surface', async ({ page }, testInfo) => {
  await mockAdmin(page); await page.goto('/?section=businesses');
  let canonicalSearch; let canonicalAppearance;
  for (const section of ['Businesses', 'Events', 'People', 'Audit']) {
    await adminSection(page, section); const group = page.getByRole('group', { name: 'Sort records', exact: true }); await expect(group).toBeVisible();
    const bounds = await group.boundingBox(); const toolbar = await page.locator('.directory-toolbar').boundingBox(); const fields = await Promise.all([group.getByRole('combobox', { name: 'Sort records by' }), group.getByRole('combobox', { name: 'Sort direction' })].map((field) => field.boundingBox()));
    expect(Math.abs(fields[0].y - fields[1].y)).toBeLessThan(1); fields.forEach((field) => expect(field.height).toBe(44));
    const search = page.getByRole('search', { name: `Search ${section === 'Audit' ? 'change history' : section.toLowerCase()}`, exact: true }); const input = await search.locator('input:not([type=date])').boundingBox(); const submit = await search.getByRole('button', { name: 'Search', exact: true }).boundingBox(); const sizes = { input: input.width, button: submit.width, group: submit.x + submit.width - input.x };
    if (section === 'Businesses') canonicalSearch = sizes; else if (['Events', 'People'].includes(section)) { expect(sizes.input).toBe(canonicalSearch.input); expect(sizes.button).toBe(canonicalSearch.button); expect(sizes.group).toBe(canonicalSearch.group); }
    if (section !== 'Audit') { await expect(search.locator('input:not([type=date])')).toHaveAttribute('placeholder', 'Search'); const icon = await search.locator('label>svg').boundingBox(); expect(icon.width).toBe(18); expect(Math.abs(icon.x - input.x - 12)).toBeLessThan(1); const appearance = await search.locator('input:not([type=date])').evaluate((node) => ({ color: getComputedStyle(node, '::placeholder').color, opacity: getComputedStyle(node, '::placeholder').opacity })); const iconColor = await search.locator('label>svg').evaluate((node) => getComputedStyle(node).color); appearance.iconColor = iconColor; if (section === 'Businesses') canonicalAppearance = appearance; else expect(appearance).toEqual(canonicalAppearance); }
    if (page.viewportSize().width >= 900) { expect(Math.abs(bounds.x + bounds.width - toolbar.x - toolbar.width)).toBeLessThan(1); expect(Math.abs(fields[0].y - input.y)).toBeLessThan(1); }
    if (section !== 'Audit') { const status = await page.getByRole('button', { name: 'Status', exact: true }).boundingBox(); expect(status.y + status.height).toBeLessThan(input.y); expect(Math.abs(status.x - input.x)).toBeLessThan(1); }
    await group.getByRole('combobox', { name: 'Sort direction' }).selectOption('asc'); await expect(page).toHaveURL(/direction=asc/); await expectNoOverflow(page);
    const device = testInfo.project.name.includes('iphone') ? 'mobile-390' : 'desktop-1440'; await page.screenshot({ path: `/private/tmp/nitewide-${section.toLowerCase()}-toolbar-viewport-${device}.png`, fullPage: false, scale: 'css' });
  }
  console.log('Canonical primary search', testInfo.project.name, JSON.stringify({ geometry: canonicalSearch, appearance: canonicalAppearance })); await adminSection(page, 'Analytics'); const group = page.getByRole('group', { name: 'Sort report', exact: true }); await expect(group).toBeVisible(); const bounds = await group.boundingBox(); const heading = await page.locator('.report-table-heading').boundingBox(); if (page.viewportSize().width >= 900) expect(Math.abs(bounds.x + bounds.width - heading.x - heading.width + 20)).toBeLessThan(1); await group.getByRole('combobox', { name: 'Sort by' }).selectOption('name_asc'); await expect(page).toHaveURL(/reportSort=name_asc/); await expectNoOverflow(page);
});

test('People activity stays scoped, human-readable and returns to its original list', async ({ page }) => {
  const state = await mockAdmin(page); const person = state.people[0];
  state.relatedRows.owners = [{ id: uuid(701), userId: person.id, organizationId: business.id, role: 'admin', organization: { id: business.id, name: business.name }, user: { id: person.id, displayName: person.displayName, email: person.email } }];
  state.relatedRows.team_invitations = [{ id: uuid(702), email: person.email, role: 'employee', invitedByUserId: uuid(999), organizationId: business.id }, { id: uuid(703), email: 'someone@example.test', role: 'employee', invitedByUserId: person.id, organizationId: business.id }];
  await page.goto('/?section=people'); await page.getByTestId('admin-record').first().getByRole('button', { name: 'View person', exact: true }).click(); await page.getByRole('tab', { name: 'Business & venue roles', exact: true }).click(); await expect(page.getByTestId('admin-record')).toContainText('Evolve Promo — Manager');
  await page.getByRole('tab', { name: 'Invitations', exact: true }).click(); await expect(page.getByTestId('admin-record')).toContainText(person.email); let query = new URLSearchParams(state.requests.findLast((request) => request.path === '/admin/management/team_invitations').query); expect(query.get('userId')).toBe(person.id); expect(query.get('relation')).toBe('received');
  await page.getByRole('button', { name: 'Sent by this person', exact: true }).click(); await expect(page.getByTestId('admin-record')).toContainText('someone@example.test'); query = new URLSearchParams(state.requests.findLast((request) => request.path === '/admin/management/team_invitations').query); expect(query.get('relation')).toBe('sent'); const personUrl = page.url();
  await page.getByTestId('admin-record').getByRole('button', { name: 'View record', exact: true }).click(); await page.getByRole('button', { name: 'Back to person', exact: false }).click(); await expect(page).toHaveURL(personUrl); await expect(page.getByTestId('admin-record')).toContainText('someone@example.test');
  const related = page.getByRole('search', { name: 'Search team invitations', exact: true }); const before = state.requests.filter((request) => request.path === '/admin/management/team_invitations').length; await related.getByRole('textbox').fill('nothing-matches'); expect(state.requests.filter((request) => request.path === '/admin/management/team_invitations')).toHaveLength(before); await related.getByRole('button', { name: 'Search', exact: true }).click(); await expect(page.getByTestId('admin-record')).toHaveCount(0); await expectNoOverflow(page);
});

test('analytics, support and reference searches wait for Search or Enter', async ({ page }) => {
  const state = await mockAdmin(page); await page.goto('/?section=analytics'); await expect(page.getByRole('heading', { name: 'Businesses', exact: true })).toBeVisible();
  const analytics = page.getByRole('search', { name: 'Search analytics', exact: true }); let before = state.requests.filter((request) => request.path === '/admin/reports/summary').length; await analytics.getByRole('textbox').fill('Evolve'); expect(state.requests.filter((request) => request.path === '/admin/reports/summary')).toHaveLength(before); await analytics.getByRole('button', { name: 'Search', exact: true }).click(); await expect(page).toHaveURL(/reportSearch=Evolve/); await analytics.getByRole('textbox').fill('Unsaved draft'); await page.getByRole('button', { name: 'Reset', exact: true }).click(); await expect(analytics.getByRole('textbox')).toHaveValue('');
  await adminSection(page, 'Support'); await expect(page.getByText('0 cases', { exact: true })).toBeVisible(); const support = page.getByRole('search', { name: 'Search cases', exact: true }); before = state.requests.filter((request) => request.path === '/admin/support/cases').length; await support.getByRole('textbox').fill('admission'); expect(state.requests.filter((request) => request.path === '/admin/support/cases')).toHaveLength(before); await support.getByRole('textbox').press('Enter'); await expect(page).toHaveURL(/search=admission/);
  await adminSection(page, 'Events'); await page.getByRole('button', { name: 'Create event', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Create event for a business' }); const reference = dialog.getByRole('search', { name: 'Search Event business choices', exact: true }); await expect(dialog.getByRole('option', { name: /Evolve Promo/ })).toHaveCount(1); before = state.requests.filter((request) => request.path === '/admin/management/organizations').length; await reference.getByRole('textbox').fill('not-a-business'); expect(state.requests.filter((request) => request.path === '/admin/management/organizations')).toHaveLength(before); await reference.getByRole('button', { name: 'Search', exact: true }).click(); await expect(dialog.getByRole('option', { name: /Evolve Promo/ })).toHaveCount(0); await expectNoOverflow(page);
});

test('reduced motion keeps interactions usable without content or flyer animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); const state = await mockAdmin(page); state.event.imageUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#440327"/></svg>');
  await page.goto(`/?section=events&resource=events&record=${event.id}`); await expect(page.getByRole('region', { name: 'Event summary', exact: true })).toBeVisible(); const contentMotion = await page.locator('.record-section-grid').evaluate((node) => getComputedStyle(node).animationDuration); expect(contentMotion).toBe('0s'); await page.getByRole('button', { name: 'View event flyer', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Event flyer', exact: true }); await expect(dialog).toBeVisible(); expect(await dialog.evaluate((node) => getComputedStyle(node).animationDuration)).toBe('0s'); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: 'View event flyer', exact: true })).toBeFocused(); await expectNoOverflow(page);
});

test('workspace header actions align with the page title on desktop and wrap on phones', async ({ page }, testInfo) => {
  await mockAdmin(page); await page.goto('/');
  for (const [section, action] of [['Overview', null], ['Businesses', 'Onboard business'], ['Events', 'Create event'], ['People', 'Invite person']]) {
    await adminSection(page, section); const header = page.getByRole('region', { name: `${section} workspace`, exact: true }); await expect(header).toBeVisible(); const title = await header.getByRole('heading', { name: section, exact: true }).boundingBox(); const refresh = await header.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
    expect(refresh.height).toBe(44); await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(1); if (action) await expect(header.getByRole('button', { name: action, exact: true })).toBeVisible();
    if (page.viewportSize().width >= 900) { expect(Math.abs(title.y + title.height / 2 - refresh.y - refresh.height / 2)).toBeLessThan(1); expect(refresh.x).toBeGreaterThan(title.x + title.width); } else { expect(refresh.y).toBeGreaterThan(title.y + title.height); }
    await expectNoOverflow(page);
  }
  const device = testInfo.project.name.includes('iphone') ? 'mobile-390' : 'desktop-1440'; await page.screenshot({ path: `/private/tmp/nitewide-people-viewport-${device}.png`, fullPage: false, scale: 'css' });
});

test('support reference fields have unique IDs and search labels focus the correct input', async ({ page }) => {
  await mockAdmin(page); await page.goto('/?section=support'); await page.getByRole('button', { name: 'Create support case', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Create support case', exact: true });
  const ids = await dialog.locator('input[id], select[id], textarea[id]').evaluateAll((nodes) => nodes.map((node) => node.id)); expect(new Set(ids).size).toBe(ids.length); expect(ids.some((id) => id.includes('undefined'))).toBe(false);
  for (const search of await dialog.getByRole('search').all()) { const label = search.locator('label'); const input = search.getByRole('textbox'); await label.click(); await expect(input).toBeFocused(); }
  await expectNoOverflow(page);
});
