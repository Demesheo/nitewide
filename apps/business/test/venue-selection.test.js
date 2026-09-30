import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('business workflows preserve scope, navigation, delivery confirmation, and recoverable editor changes', async (t) => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/app',
    pretendToBeVisual: true,
  });
  const originalGlobals = new Map();
  for (const key of ['window', 'document', 'navigator', 'sessionStorage', 'localStorage', 'HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = (query) => ({ matches: query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {} });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

  const orgA = '10000000-0000-4000-8000-000000000001';
  const orgB = '10000000-0000-4000-8000-000000000002';
  const venueA = 'a'.repeat(64);
  const venueB = 'b'.repeat(64);
  const venueC = 'c'.repeat(64);
  const eventA = '40000000-0000-4000-8000-000000000001';
  const eventB = '40000000-0000-4000-8000-000000000002';
  const buyerId = '50000000-0000-4000-8000-000000000001';
  const pendingEntryId = '60000000-0000-4000-8000-000000000001';
  const requests = [];
  const calls = [];
  let rejectEventUpdate = false;
  let teamInvitation = null;
  const teamMemberId = '30000000-0000-4000-8000-000000000009';
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), dom.window.location.href);
    requests.push(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method || 'GET', body });
    let data = {};
    if (url.pathname === '/api/business/bootstrap') {
      data = {
        organizations: [{ id: orgA, name: 'North Hall', canManage: true }, { id: orgB, name: 'South Hall', canManage: true }],
        venues: [
          { id: venueA, label: 'North Room', organizationId: orgA, locationIds: ['20000000-0000-4000-8000-000000000001'] },
          { id: venueB, label: 'South Room', organizationId: orgB, locationIds: ['20000000-0000-4000-8000-000000000002'] },
          { id: venueC, label: 'Studio West', organizationId: orgB, locationIds: ['20000000-0000-4000-8000-000000000003'], location: { name: 'Studio West', addressLine1: '3 Test Way', city: 'Denver', region: 'CO', postalCode: '80202', countryCode: 'US', privacy: 'public', timezone: 'America/Denver' } },
        ],
        capabilities: { emailConfigured: true, instructions: true, deliveryTrackingConfigured: true },
        scope: { canCreateIndependent: false, isInternalAdmin: false },
      };
    } else if (url.pathname === '/api/business/overview') {
      data = { summary: { salesCents: 0, orders: 0, checkedIn: 0, admissions: 0, guestlistPlaces: 0, commissionCents: 0 }, daily: [], range: { days: 30 } };
    } else if (url.pathname === '/api/business/overview/needs-attention') {
      data = { counts: { pendingGuestlist: 0, pendingInvitations: 0, upcomingEvents: 0, lowInventory: 0 }, items: [] };
    } else if (/^\/api\/business\/organizations\/[^/]+\/team-page$/.test(url.pathname)) {
      data = { items: [{ id: teamMemberId, name: 'Fixture Staff', email: 'fixture-staff@fixture.test', role: 'Employee', status: 'active', joined: new Date().toISOString(), salesCents: 0, commissionCents: 0, orders: 0, customers: 0 }], total: 1, page: Number(url.searchParams.get('page') || 1), pageSize: 20, hasMore: false, range: { timezone: 'UTC', basis: 'paidAt' } };
    } else if (/^\/api\/business\/organizations\/[^/]+\/invitations-page$/.test(url.pathname)) {
      data = { items: teamInvitation ? [{ ...teamInvitation, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), createdAt: new Date().toISOString() }] : [], total: teamInvitation ? 1 : 0, page: Number(url.searchParams.get('page') || 1), pageSize: 20, hasMore: false };
    } else if (/^\/api\/business\/organizations\/[^/]+\/invitations$/.test(url.pathname) && init.method === 'POST') {
      teamInvitation = { id: 'a0000000-0000-4000-8000-000000000001', email: body.email, phone: body.phone || null, role: body.role };
      data = { ...teamInvitation, token: 'synthetic-private-invitation-token' };
    } else if (/^\/api\/business\/organizations\/[^/]+\/invitations\/[^/]+\/resend$/.test(url.pathname)) {
      data = { token: 'synthetic-renewed-private-invitation-token' };
    } else if (/^\/api\/business\/organizations\/[^/]+\/team\/[^/]+$/.test(url.pathname) && init.method === 'PATCH') {
      data = { id: teamMemberId, role: body.role };
    } else if (url.pathname === '/api/business/reports/summary') {
      const scopedEvent = url.searchParams.get('eventId') === eventA;
      data = { range: { startDate: '2026-09-01', endDate: '2026-09-30', days: 30 },
        summary: { salesCents: 2500, commissionCents: 0, directSalesCents: 0, orders: 1, customers: 1, units: 1, admissions: 1, checkedIn: 0, guestlistPlaces: 0, events: 1, averageOrderCents: 2500 },
        event: scopedEvent ? { id: eventA, label: 'North Hall Preview', startsAt: '2026-09-27T01:00:00.000Z', venueTimezone: 'America/New_York' } : null,
        daily: [], offerings: [], eventMix: [{ id: eventA, label: 'North Hall Preview', startsAt: '2026-09-27T01:00:00.000Z', venueTimezone: 'America/New_York', salesCents: 2500 }] };
    } else if (/^\/api\/business\/reports\/(regions|venues|events|offerings|team|customers)$/.test(url.pathname)) {
      const page = Number(url.searchParams.get('page') || 1);
      const rows = url.pathname.endsWith('/regions') ? [{ id: 'orlando', label: 'Orlando, FL, US', events: 1, orders: 1, salesCents: 2500, checkedIn: 0 }] :
        url.pathname.endsWith('/venues') ? [{ id: venueA, label: 'North Room', events: 1, orders: 1, salesCents: 2500, checkedIn: 0 }] :
          url.pathname.endsWith('/events') ? [{ id: eventA, eventId: eventA, label: 'North Hall Preview', startsAt: new Date(Date.now() + 86_400_000).toISOString(), orders: 1, customers: 1, salesCents: 2500, checkedIn: 0 }] :
            url.pathname.endsWith('/offerings') ? [{ id: 'ticket:General Admission', label: 'General Admission', kind: 'ticket', units: 1, orders: 1, salesCents: 2500 }] : [];
      data = { items: rows, total: rows.length, page, pageSize: 20, hasMore: false };
    } else if (url.pathname === '/api/notifications') {
      data = { items: [], unreadCount: 0 };
    } else if (url.pathname === '/api/business/admissions/events') {
      data = { items: [], total: 0, page: Number(url.searchParams.get('page') || 1), pageSize: 20, hasMore: false,
        nextEvent: { id: eventA, title: 'North Hall Preview', startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
          unlockAt: new Date(Date.now() + 4 * 86_400_000).toISOString(), location: { name: 'North Room', timezone: 'America/New_York' } } };
    } else if (url.pathname === '/api/business/events') {
      const event = url.searchParams.get('organizationIds') === orgB ? {
        id: eventB, organizationId: orgB, locationId: '20000000-0000-4000-8000-000000000002', title: 'South Hall After Dark',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 100_800_000).toISOString(),
        status: 'published', canManage: true, canEdit: true, location: { name: 'South Room', timezone: 'America/Chicago' },
        lifetimeSales: { salesCents: 12500, paidOrders: 2 },
      } : {
        id: eventA, organizationId: orgA, locationId: '20000000-0000-4000-8000-000000000001', title: 'North Hall Preview',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 100_800_000).toISOString(),
        status: 'published', canManage: true, canEdit: true, location: { name: 'North Room', timezone: 'America/New_York' },
        lifetimeSales: { salesCents: 7500, paidOrders: 1 },
      };
      data = { items: [event], total: 1, page: Number(url.searchParams.get('page') || 1), pageSize: 20, hasMore: false };
    } else if (/^\/api\/business\/events\/(?:[0-9a-f-]+)\/summary$/.test(url.pathname)) {
      const id = url.pathname.split('/')[4];
      const isSouth = id === eventB;
      data = {
        event: {
          id, organizationId: isSouth ? orgB : orgA, locationId: isSouth ? '20000000-0000-4000-8000-000000000002' : '20000000-0000-4000-8000-000000000001',
          title: isSouth ? 'South Hall After Dark' : 'North Hall Preview', summary: 'A fixture event', description: '', status: 'published', version: 1,
          startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 100_800_000).toISOString(), canManage: true, canEdit: true,
          location: { name: isSouth ? 'South Room' : 'North Room', addressLine1: '1 Test Way', city: 'Orlando', region: 'FL', timezone: isSouth ? 'America/Chicago' : 'America/New_York' },
          offerings: [{ id: '70000000-0000-4000-8000-000000000001', name: 'General Admission', kind: 'ticket', priceCents: 2500, entriesPerUnit: 1, isActive: true, quantityTotal: 100, quantitySold: 1, saleState: 'on_sale' }],
        },
        scope: 'event',
        summary: { salesCents: 2500, commissionCents: 0, orders: 1, customers: 1, admissions: 1, checkedIn: 0, guestlistPlaces: 0 },
        tiers: [{ id: '70000000-0000-4000-8000-000000000001', name: 'General Admission', kind: 'ticket', units: 1, salesCents: 2500, admissions: 1 }],
        channels: [{ id: 'direct', name: 'Direct', salesCents: 2500, orders: 1 }],
      };
    } else if (url.pathname.endsWith('/referral-link')) {
      data = { code: 'FIXTURE-CODE' };
    } else if (url.pathname.endsWith('/guestlist-invite-pools')) {
      data = { open: false, direct: false, own: [] };
    } else if (url.pathname.endsWith('/attendees') && url.pathname.startsWith('/api/business/events/')) {
      data = { items: [{ id: buyerId, name: 'Buyer A', email: 'buyer-a@fixture.test', salesCents: 2500, orders: 1, admissions: 1, checkedIn: 0, guestlistPlaces: 0 }], total: 1, page: Number(url.searchParams.get('page') || 1), pageSize: 10, hasMore: false };
    } else if (url.pathname.endsWith(`/attendees/${buyerId}`)) {
      data = { id: buyerId, name: 'Buyer A', email: 'buyer-a@fixture.test', guestlistStatuses: [], purchases: { items: [{ id: '80000000-0000-4000-8000-000000000001', name: 'General Admission', quantity: 1, salesCents: 2500, paidAt: new Date().toISOString() }], total: 1, page: 1, pageSize: 10, hasMore: false } };
    } else if (url.pathname.endsWith('/purchases') && url.pathname.startsWith('/api/business/events/')) {
      data = { items: [{ id: '90000000-0000-4000-8000-000000000001', customer: 'Buyer A', items: '1 × General Admission', salesCents: 2500, paidAt: new Date().toISOString(), referredBy: 'Direct' }], total: 1, page: 1, pageSize: 20, hasMore: false };
    } else if (url.pathname.endsWith('/guestlist-page') && url.pathname.startsWith('/api/business/events/')) {
      data = { items: [{ id: pendingEntryId, eventId: eventB, userId: buyerId, source: 'event', partySize: 2, status: 'pending', createdAt: new Date().toISOString(), guestName: 'Buyer A', guestEmail: 'buyer-a@fixture.test', referrerName: null }], total: 1, page: Number(url.searchParams.get('page') || 1), pageSize: 20, hasMore: false };
    } else if (url.pathname.endsWith('/guestlist-settings-page')) {
      data = { direct: { used: 0, capacity: 20 }, promoters: { items: [], total: 0, page: 1, pageSize: 10, hasMore: false } };
    } else if (url.pathname.endsWith('/instructions/history')) {
      data = { items: [], total: 0, page: 1, pageSize: 10, hasMore: false, statusCounts: {}, trackingConfigured: true };
    } else if (url.pathname.endsWith('/instructions/preview')) {
      data = { eventId: eventB, audienceCount: 1, channel: 'email', delivery: 'configured', messagePreview: { subject: 'Instructions for South Hall After Dark', body: body?.instructions, note: 'The booking link will be included.' } };
    } else if (url.pathname.endsWith('/instructions')) {
      data = { queued: 1 };
    }
    const conflict = rejectEventUpdate && calls.at(-1)?.method === 'PUT' && url.pathname.startsWith('/api/business/events/');
    const status = conflict ? 409 : url.pathname.endsWith('/invitations') && init.method === 'POST' ? 201 : 200;
    return new Response(JSON.stringify(conflict ? { error: { message: 'This event changed elsewhere.' } } : { data }), { status, headers: { 'content-type': 'application/json' } });
  };

  let vite;
  let unmount;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({
      configFile: resolve(businessRoot, 'vite.config.js'),
      root: businessRoot,
      logLevel: 'silent',
      server: { middlewareMode: true },
      appType: 'custom',
    });
    const { default: App } = await vite.ssrLoadModule('/src/App.jsx');
    const React = await import('react');
    const { render, screen, waitFor } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    dom.window.sessionStorage.setItem('nitewide.business.session', JSON.stringify({
      accessToken: 'test-session-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: '30000000-0000-4000-8000-000000000001', displayName: 'Casey Test', isInternalAdmin: false },
    }));
    const view = render(React.createElement(App), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();

    await screen.findByRole('heading', { name: 'A clearer view of your business.' });
    await t.test('organization team access and analytics drilldown', async () => {
    await user.click(screen.getAllByRole('button', { name: 'Organization' })[0]);
    await screen.findByRole('heading', { name: 'Build your team' });
    await user.click(screen.getByRole('button', { name: 'Invite team member' }));
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'new-staff@fixture.test');
    await user.click(screen.getByRole('button', { name: 'Create invitation' }));
    await screen.findByRole('textbox', { name: 'Invitation link' });
    const invited = calls.find((call) => call.method === 'POST' && /\/organizations\/[^/]+\/invitations$/.test(call.url.pathname));
    assert.deepEqual([invited.body.email, invited.body.role], ['new-staff@fixture.test', 'employee']);
    await user.click(screen.getByText('Close', { selector: 'button' }));
    await screen.findByText('new-staff@fixture.test');
    await user.click(screen.getByRole('button', { name: 'Resend' }));
    await screen.findByDisplayValue(/synthetic-renewed-private-invitation-token/);
    assert.ok(calls.some((call) => call.method === 'POST' && call.url.pathname.endsWith('/resend')));
    await user.click(screen.getByText('Close', { selector: 'button' }));
    await user.click(screen.getByRole('button', { name: 'View Fixture Staff details' }));
    await user.click(screen.getByRole('button', { name: 'Edit member' }));
    await user.click(screen.getByRole('combobox', { name: 'Team member role' }));
    await user.click(await screen.findByRole('option', { name: 'Promoter' }));
    await user.click(screen.getByRole('button', { name: 'Save role' }));
    assert.ok(calls.some((call) => call.method === 'PATCH' && call.body.role === 'affiliate' && call.url.pathname.endsWith(`/team/${teamMemberId}`)));
    await user.click(screen.getAllByRole('button', { name: 'Analytics' })[0]);
    await screen.findByRole('heading', { name: 'Regions' });
    await user.click(await screen.findByRole('button', { name: 'Orlando, FL, US' }));
    await screen.findByRole('heading', { name: 'Venues & creators' });
    assert.equal(new URL(dom.window.location.href).searchParams.get('reportRegion'), 'Orlando, FL, US');
    assert.ok(requests.some((url) => url.pathname.endsWith('/reports/venues') && url.searchParams.get('regions') === 'Orlando, FL, US'));
    await user.click(await screen.findByRole('button', { name: 'North Room' }));
    await screen.findByRole('heading', { name: 'Events' });
    assert.equal(new URL(dom.window.location.href).searchParams.get('venueIds'), venueA);
    await user.click(await screen.findByRole('button', { name: 'North Hall Preview' }));
    await screen.findByRole('heading', { name: 'Tickets and packages' });
    assert.equal(new URL(dom.window.location.href).searchParams.get('section'), 'analytics');
    assert.equal(new URL(dom.window.location.href).searchParams.get('reportEvent'), eventA);
    assert.equal(new URL(dom.window.location.href).searchParams.has('event'), false, 'analytics drilldown stays out of event management');
    await waitFor(() => assert.ok(requests.some((url) => url.pathname.endsWith('/reports/summary') && url.searchParams.get('eventId') === eventA)));
    await waitFor(() => assert.ok(requests.some((url) => url.pathname.endsWith('/reports/offerings') && url.searchParams.get('eventId') === eventA)));
    await user.click(await screen.findByRole('button', { name: 'Back to event reports' }));
    await screen.findByRole('heading', { name: 'Events' });
    assert.equal(new URL(dom.window.location.href).searchParams.has('reportEvent'), false);
    await user.click(screen.getAllByRole('button', { name: 'Overview' })[0]);
    await screen.findByRole('heading', { name: 'A clearer view of your business.' });
    await user.click(screen.getByRole('tab', { name: 'Events' }));
    assert.match((await screen.findByRole('img', { name: /North Hall Preview/ })).getAttribute('aria-label'), /North Hall Preview · 09\/26\/2026/,
      'the rendered sales-mix legend keeps the event’s venue-local date');
    });
    await t.test('venue filters, event tabs, and instruction preview-before-queue', async () => {
    await user.click(screen.getByRole('button', { name: 'Venues' }));
    await user.click(screen.getByRole('checkbox', { name: 'North Room' }));
    await user.click(screen.getAllByRole('button', { name: 'Events' })[0]);

    assert.equal(new URL(dom.window.location.href).searchParams.has('venueIds'), false,
      'switching to Events clears the previous section’s venue filter');
    assert.equal(new URL(dom.window.location.href).searchParams.has('reportRegion'), false,
      'analytics drill scope never leaks into event management');
    await user.click(screen.getByRole('button', { name: 'Venues' }));
    await user.click(screen.getByRole('checkbox', { name: 'North Room' }));

    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/events' && url.searchParams.get('venueIds') === venueA)));
    const firstRequest = requests.find((url) => url.pathname === '/api/business/events' && url.searchParams.get('venueIds') === venueA);
    assert.equal(firstRequest.searchParams.get('pageSize'), '10');

    await user.click(screen.getByRole('button', { name: 'Organizations' }));
    await user.click(screen.getByRole('checkbox', { name: 'South Hall' }));
    await waitFor(() => assert.ok(requests.some((url) => url.pathname === '/api/business/events' && url.searchParams.get('organizationIds') === orgB && !url.searchParams.has('venueIds'))));
    assert.equal(screen.getByRole('button', { name: 'Venues' }).textContent.includes('selected'), false);

    await user.click(await screen.findByRole('button', { name: 'Open South Hall After Dark' }));
    await screen.findByRole('heading', { name: 'South Hall After Dark' });
    assert.equal(new URL(dom.window.location.href).searchParams.get('event'), eventB);
    await user.click(screen.getByRole('tab', { name: 'Offerings' }));
    await screen.findByRole('heading', { name: 'Every tier, accounted for' });
    assert.equal(new URL(dom.window.location.href).searchParams.get('tab'), 'tickets');
    await user.click(screen.getByRole('tab', { name: 'Guestlist' }));
    await screen.findByRole('heading', { name: 'Your guestlist' });
    assert.equal(new URL(dom.window.location.href).searchParams.get('tab'), 'guestlist');
    assert.ok(requests.some((url) => url.pathname.endsWith('/guestlist-page') && url.searchParams.get('statuses') === 'pending'));

    await user.click(screen.getByRole('button', { name: 'Send attendee instructions' }));
    await user.type(screen.getByRole('textbox', { name: 'Instructions' }), 'Use the south entrance after 9 PM.');
    await user.click(screen.getByRole('button', { name: 'Preview audience' }));
    await screen.findByText('1 eligible recipients');
    assert.equal(calls.filter((call) => call.url.pathname.endsWith('/instructions')).length, 0, 'preview alone never queues messages');
    await user.click(screen.getByRole('button', { name: 'Confirm and queue 1 emails' }));
    await screen.findByText('Instructions queued for 1 attendee.');
    const queuedCall = calls.find((call) => call.method === 'POST' && call.url.pathname.endsWith('/instructions'));
    assert.equal(queuedCall.body.instructions, 'Use the south entrance after 9 PM.');
    assert.match(queuedCall.body.idempotencyKey, /^[0-9a-f-]{36}$/i);

    await user.click(screen.getByRole('button', { name: 'All events' }));
    await screen.findByRole('heading', { name: 'Every event. The whole picture.' });
    assert.equal(new URL(dom.window.location.href).searchParams.has('event'), false);
    });
    await t.test('linked venue timezone and explicit draft recovery after close and 409', async () => {
    await user.click(await screen.findByRole('button', { name: 'Open South Hall After Dark' }));
    await screen.findByRole('heading', { name: 'South Hall After Dark' });
    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    const title = screen.getByRole('textbox', { name: 'Event name' });
    const originalWallClock = screen.getByLabelText('Starts at (venue time)').value;
    await user.clear(title);
    await user.type(title, 'Recovered South Hall Night');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('combobox', { name: 'Saved venue' }));
    await user.click(await screen.findByRole('option', { name: 'Studio West' }));
    assert.match(screen.getByText(/Uses the saved venue address/).textContent, /Changing venue keeps the local times/);
    assert.equal(screen.queryByText(/America\/Denver/), null, 'the venue zone affects conversion without being printed in the editor');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    assert.equal(screen.getByLabelText('Starts at (venue time)').value, originalWallClock, 'changing a saved venue preserves the event wall-clock time');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    rejectEventUpdate = true;
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => assert.ok(calls.some((call) => call.method === 'PUT' && call.url.pathname === `/api/business/events/${eventB}`)));
    const failedUpdate = calls.find((call) => call.method === 'PUT' && call.url.pathname === `/api/business/events/${eventB}`);
    assert.equal(failedUpdate.body.locationId, '20000000-0000-4000-8000-000000000003');
    assert.equal(failedUpdate.body.location.timezone, 'America/Denver');
    const draftKey = `nitewide:business:draft:30000000-0000-4000-8000-000000000001:${eventB}`;
    await waitFor(() => assert.ok(dom.window.sessionStorage.getItem(draftKey)), { timeout: 1000 });
    await user.click(screen.getByRole('button', { name: 'Reload latest; keep my draft' }));
    await screen.findByRole('heading', { name: 'South Hall After Dark' });
    assert.ok(dom.window.sessionStorage.getItem(draftKey), '409 reload keeps the recoverable draft for this user and event');
    rejectEventUpdate = false;
    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    await screen.findByText(/Unsaved event changes from this tab are available/);
    await user.click(screen.getByRole('button', { name: 'Restore draft' }));
    assert.equal(screen.getByRole('textbox', { name: 'Event name' }).value, 'Recovered South Hall Night');
    await user.clear(screen.getByRole('textbox', { name: 'Event name' }));
    await user.type(screen.getByRole('textbox', { name: 'Event name' }), 'Saved on close immediately');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    assert.equal(screen.getByRole('textbox', { name: 'Event name' }).value, 'Saved on close immediately', 'canceling the close prompt leaves the dirty form intact');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Close and keep draft' }));
    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    await screen.findByText(/Unsaved event changes from this tab are available/);
    await user.click(screen.getByRole('button', { name: 'Restore draft' }));
    assert.equal(screen.getByRole('textbox', { name: 'Event name' }).value, 'Saved on close immediately');
    });
    await t.test('Admissions empty state previews next assigned event and opens its details', async () => {
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Close and keep draft' }));
    await user.click(screen.getAllByRole('button', { name: 'Admissions' })[0]);
    await screen.findByRole('heading', { name: 'Select an event' });
    await screen.findByText('Next assigned event: North Hall Preview');
    assert.ok(screen.getByText(/Admissions unlock .* venue time/), 'the next event reports an upcoming, venue-local unlock');
    await user.click(screen.getByRole('button', { name: 'Open event details' }));
    await screen.findByRole('heading', { name: 'North Hall Preview' });
    assert.equal(new URL(dom.window.location.href).searchParams.get('event'), eventA);
    assert.equal(calls.some((call) => call.method === 'POST' && call.url.pathname === '/api/check-ins'), false, 'previewing the next event never checks anyone in');
    });
  } finally {
    try { unmount?.(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (vite) await vite.close();
    globalThis.fetch = priorFetch;
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});
