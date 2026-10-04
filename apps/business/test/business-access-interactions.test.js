import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const session = { accessToken: 'synthetic-customer-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), user: { id: 'customer', displayName: 'Test Customer', email: 'customer@fixture.test' }, roles: [] };
const response = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : { error: data }), { status, headers: { 'content-type': 'application/json' } });

async function withRuntime(run, { path = '/sign-in', storedSession = null, fetcher = async () => response({}) } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `http://localhost${path}`, pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage, FormData: dom.window.FormData, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const original = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (storedSession) dom.window.sessionStorage.setItem('nitewide.business.session', JSON.stringify(storedSession));
  const priorFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (input, init = {}) => { const call = { path: new URL(String(input), dom.window.location.href).pathname, init, body: init.body ? JSON.parse(init.body) : null }; calls.push(call); return fetcher(call); };
  let vite;
  const views = [];
  try {
    const { createTestServer } = await import('./helpers/vite-server.js');
    vite = await createTestServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const React = await import('react');
    const { render, act, within, waitFor, fireEvent } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const mount = async (file, exportName = 'default', props = {}) => { const mod = await vite.ssrLoadModule(file); const view = render(React.createElement(mod[exportName], props), { container: dom.window.document.getElementById('root') }); views.push(view); return view; };
    await run({ mount, user, queries: within(dom.window.document.body), calls, dom, act, waitFor, fireEvent });
  } finally {
    for (const view of views) { try { view.unmount(); } catch {} }
    await new Promise((done) => setTimeout(done, 0));
    await vite?.close(); globalThis.fetch = priorFetch;
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
}

test('ordinary Business sign-in uses approved-only auth and denial offers Request access without saving a session', async () => {
  await withRuntime(async ({ mount, user, queries, calls, dom }) => {
    await mount('/src/App.jsx');
    await user.type(queries.getByLabelText('Work email'), session.user.email);
    await user.type(queries.getByLabelText('Password'), 'CorrectPass123');
    await user.click(queries.getByRole('button', { name: 'Sign in to Nitewide' }));
    await queries.findByRole('alert');
    assert.equal(calls[0].path, '/api/auth/business/sign-in');
    assert.equal(dom.window.sessionStorage.getItem('nitewide.business.session'), null);
    assert.equal(queries.queryByRole('navigation'), null);
    assert.ok(queries.getByRole('button', { name: 'Request access' }));
    assert.equal(queries.queryByText(/New organizer\?/), null);
  }, { fetcher: async () => response({ code: 'BUSINESS_ACCESS_REQUIRED', message: 'Business access requires approval and completed onboarding.' }, 403) });
});

test('access request preserves draft on failure, prevents duplicate submission, and returns focus after explicit success', async () => {
  let complete;
  let attempts = 0;
  await withRuntime(async ({ mount, user, queries, calls, dom, act }) => {
    await mount('/src/components/BusinessSignIn.jsx', 'BusinessSignIn', { onSession() { throw new Error('A request must never sign in'); } });
    await user.click(queries.getByRole('button', { name: 'Request access' }));
    const heading = queries.getByRole('heading', { name: 'Request access.' });
    assert.equal(dom.window.document.activeElement, heading);
    assert.equal(dom.window.document.querySelector('input[type="password"]'), null);
    await user.type(queries.getByLabelText('Full name'), 'Test Organizer');
    await user.type(queries.getByLabelText('Email address'), 'request@fixture.test');
    await user.type(queries.getByLabelText('Phone number'), '(407) 555-0123');
    await user.type(queries.getByLabelText('Business name'), 'Fixture Nights');
    await user.selectOptions(queries.getByLabelText('Your role'), 'owner');
    await user.type(queries.getByRole('textbox', { name: 'Tell us about your business' }), 'We host monthly music events.');
    await user.click(queries.getByRole('button', { name: 'Send request' }));
    await queries.findByRole('alert');
    assert.equal(queries.getByLabelText('Business name').value, 'Fixture Nights');
    await user.click(queries.getByRole('button', { name: 'Send request' }));
    assert.equal(queries.getByRole('button', { name: 'Sending request…' }).disabled, true);
    await act(async () => { dom.window.document.getElementById('business-access-request-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(attempts, 2);
    await act(async () => { complete(response({ message: 'Request received.' }, 202)); });
    const sent = await queries.findByRole('heading', { name: 'Request received.' });
    assert.equal(dom.window.document.activeElement, sent);
    assert.match(queries.getByRole('status').textContent, /Access is not granted until onboarding is completed/);
    assert.equal(calls.every((call) => call.path === '/api/business/access-requests' && !call.init.headers.Authorization), true);
    assert.deepEqual(Object.keys(calls[1].body).sort(), ['businessName', 'details', 'displayName', 'email', 'phone', 'role']);
    assert.equal(dom.window.sessionStorage.getItem('nitewide.business.session'), null);
    await user.click(queries.getByRole('button', { name: 'Back to sign in' }));
    assert.equal(dom.window.document.activeElement, queries.getByRole('button', { name: 'Request access' }));
  }, { fetcher: async () => { attempts += 1; if (attempts === 1) return response({ message: 'Temporarily unavailable. Please try again.' }, 503); return new Promise((done) => { complete = done; }); } });
});

test('invitation signup recovers an account-creation race and retries acceptance without creating another account', async () => {
  let acceptAttempts = 0, accepted;
  await withRuntime(async ({ mount, queries, user, calls, waitFor }) => {
    await mount('/src/components/Team.jsx', 'TeamInviteLanding', { token: 'private-invitation', session: null, onAccepted: (...args) => { accepted = args; } });
    await queries.findByRole('button', { name: 'Create account and accept', exact: true });
    assert.equal(queries.getByLabelText('Email', { exact: true }).readOnly, true);
    assert.ok(queries.getByLabelText('Confirm password', { exact: true }));
    assert.equal(queries.getByRole('list', { name: 'Password requirements' }).querySelectorAll('li').length, 4);
    await user.type(queries.getByLabelText('Password', { exact: true }), 'Accept12');
    await user.type(queries.getByLabelText('Confirm password', { exact: true }), 'Accept12');
    await user.click(queries.getByRole('button', { name: 'Create account and accept', exact: true }));
    await queries.findByRole('button', { name: 'Sign in and accept', exact: true });
    assert.match(queries.getByRole('alert').textContent, /This email now has an account/);
    assert.equal(queries.queryByLabelText('Confirm password', { exact: true }), null);
    assert.equal(queries.getByLabelText('Password', { exact: true }).value, '', 'changing auth mode clears the secret');
    await user.type(queries.getByLabelText('Password', { exact: true }), 'ExistingPassword123');
    await user.click(queries.getByRole('button', { name: 'Sign in and accept', exact: true }));
    await queries.findByRole('button', { name: 'Accept invitation', exact: true });
    await queries.findByRole('alert');
    assert.equal(accepted, undefined, 'failed acceptance cannot grant access');
    await user.click(queries.getByRole('button', { name: 'Accept invitation', exact: true }));
    await waitFor(() => assert.ok(accepted));
    assert.equal(calls.filter(call => call.path === '/api/auth/register').length, 1);
    assert.equal(calls.filter(call => call.path === '/api/auth/sign-in').length, 1);
    assert.equal(acceptAttempts, 2);
    assert.ok(accepted[0].roles.includes('employee'));
    assert.deepEqual(accepted[1], { organizationId: 'organization', role: 'employee' });
  }, { fetcher: async ({ path }) => {
    if (path === '/api/team/invitations/private-invitation') return response({ email: session.user.email, name: 'Test Customer', role: 'employee', organizationName: 'Fixture Nights', accountMode: 'new' });
    if (path === '/api/auth/register') return response({ code: 'DUPLICATE', message: 'A unique value is already in use' }, 409);
    if (path === '/api/auth/sign-in') return response(session);
    if (path.endsWith('/accept')) return ++acceptAttempts === 1 ? response({ message: 'Try again' }, 503) : response({ organizationId: 'organization', role: 'employee' });
    if (path === '/api/auth/me') return response({ user: session.user, roles: ['customer', 'employee'] });
    throw new Error(`Unexpected request: ${path}`);
  } });
});

test('new owner activation shows the shared password requirements and accepts an eight-character confirmed password', async () => {
  await withRuntime(async ({ mount, queries, user, calls }) => {
    await mount('/src/components/OnboardingSetup.jsx', 'OnboardingSetup', { token: 'private-owner-invitation', session: null });
    await queries.findByRole('button', { name: 'Confirm email and activate' });
    assert.equal(queries.getByRole('list', { name: 'Password requirements' }).querySelectorAll('li').length, 4);
    await user.type(queries.getByLabelText('New password', { exact: true }), 'weakpass');
    await user.type(queries.getByLabelText('Confirm password', { exact: true }), 'weakpass');
    await user.click(queries.getByRole('button', { name: 'Confirm email and activate' }));
    assert.match(queries.getByRole('alert').textContent, /one uppercase letter, one number/);
    assert.equal(calls.filter(call => call.path.endsWith('/accept')).length, 0);
    await user.clear(queries.getByLabelText('New password', { exact: true }));
    await user.type(queries.getByLabelText('New password', { exact: true }), 'Accept12');
    await user.clear(queries.getByLabelText('Confirm password', { exact: true }));
    await user.type(queries.getByLabelText('Confirm password', { exact: true }), 'Accept12');
    await user.click(queries.getByRole('button', { name: 'Confirm email and activate' }));
    await queries.findByRole('heading', { name: "You're all set." });
    assert.deepEqual(calls.find(call => call.path.endsWith('/accept')).body, { token: 'private-owner-invitation', password: 'Accept12', confirmPassword: 'Accept12' });
  }, { fetcher: async ({ path }) => path.endsWith('/preview') ? response({ accountMode: 'new', email: session.user.email, displayName: 'New Owner', kind: 'organization', expiresAt: '2099-01-01T00:00:00.000Z' }) : response({}) });
});

test('restored customer session never renders protected navigation and Business denial does not revoke customer auth', async () => {
  let complete;
  await withRuntime(async ({ mount, queries, calls, dom, act }) => {
    await mount('/src/App.jsx');
    await queries.findByRole('heading', { name: 'Checking your Business access.' });
    assert.equal(queries.queryByRole('navigation'), null);
    assert.equal(queries.queryByRole('button', { name: 'Your profile' }), null);
    await act(async () => { complete(response({ code: 'BUSINESS_ACCESS_REQUIRED', message: 'Business access required.' }, 403)); });
    await queries.findByRole('heading', { name: 'Welcome back.' });
    assert.match(queries.getByRole('alert').textContent, /does not have active Business access/);
    assert.equal(dom.window.sessionStorage.getItem('nitewide.business.session'), null);
    assert.deepEqual(calls.map((call) => call.path), ['/api/business/bootstrap']);
  }, { path: '/app', storedSession: session, fetcher: async () => new Promise((done) => { complete = done; }) });
});

test('bootstrap service failure safely offers Retry and Return to sign in without workspace exposure', async () => {
  await withRuntime(async ({ mount, user, queries, calls, dom }) => {
    await mount('/src/App.jsx');
    await queries.findByRole('heading', { name: 'We couldn’t open your workspace.' });
    assert.equal(queries.queryByRole('navigation'), null);
    assert.ok(dom.window.sessionStorage.getItem('nitewide.business.session'));
    await user.click(queries.getByRole('button', { name: 'Try again' }));
    await queries.findByRole('heading', { name: 'We couldn’t open your workspace.' });
    assert.equal(calls.filter((call) => call.path === '/api/business/bootstrap').length, 2);
    await user.click(queries.getByRole('button', { name: 'Return to sign in' }));
    await queries.findByRole('heading', { name: 'Welcome back.' });
    assert.equal(dom.window.sessionStorage.getItem('nitewide.business.session'), null);
    assert.equal(calls.some((call) => call.path.includes('/logout')), false);
  }, { path: '/app', storedSession: session, fetcher: async () => response({ message: 'Business services are temporarily unavailable.' }, 503) });
});

test('explicit invitation-only sign-in retains generic identity auth and omits the public access request action', async () => {
  let signedIn;
  await withRuntime(async ({ mount, user, queries, calls }) => {
    await mount('/src/components/BusinessSignIn.jsx', 'BusinessSignIn', { invitationOnly: true, onSession(value) { signedIn = value; } });
    assert.equal(queries.queryByRole('button', { name: 'Request access' }), null);
    await user.type(queries.getByLabelText('Work email'), session.user.email);
    await user.type(queries.getByLabelText('Password'), 'CorrectPass123');
    await user.click(queries.getByRole('button', { name: 'Sign in to Nitewide' }));
    assert.equal(calls[0].path, '/api/auth/sign-in');
    assert.equal(signedIn.accessToken, session.accessToken);
  }, { path: '/app?onboarding=synthetic-invitation', fetcher: async () => response(session) });
});

test('event tabs activate on a native click without synthesized mousedown and preserve the selection when share data arrives', async () => {
  let completeLink;
  let completePools;
  const changedTabs = [];
  const edits = [];
  const event = { id: 'event-click-fixture', title: 'Click Fixture Night', status: 'published', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(), canEdit: true, canManage: false, location: { timezone: 'UTC' }, offerings: [{ id: 'tier', name: 'Admission', priceCents: 2500, entriesPerUnit: 1, isActive: true, saleState: 'on_sale' }] };
  const summary = { event, scope: 'event', summary: { salesCents: 0, commissionCents: 0, orders: 0, admissions: 0, checkedIn: 0, guestlistPlaces: 0 }, tiers: [{ id: 'tier', name: 'Admission', kind: 'ticket', units: 0, admissions: 0, salesCents: 0 }], channels: [] };
  await withRuntime(async ({ mount, queries, fireEvent, act }) => {
    await mount('/src/components/PagedEventDetail.jsx', 'PagedEventDetail', { eventId: event.id, session, onUnauthorized() {}, onEdit(value, step) { edits.push({ event: value.id, step }); }, onTabChange(value) { changedTabs.push(value); } });
    await queries.findByRole('heading', { name: event.title });
    const offerings = queries.getByRole('tab', { name: 'Offerings' });
    // Touch/assistive native activation need not synthesize a mousedown or
    // focus the button. The click itself must select the requested tab.
    fireEvent.click(offerings);
    assert.equal(offerings.getAttribute('aria-selected'), 'true');
    await act(async () => { completeLink(response({ code: 'NW-click-fixture' })); completePools(response({ open: true, direct: true, own: [] })); });
    await queries.findByRole('button', { name: 'Invite guest' });
    assert.equal(offerings.getAttribute('aria-selected'), 'true');
    assert.deepEqual(changedTabs, ['tickets']);
    fireEvent.click(queries.getByRole('button', { name: 'Manage tiers' }));
    assert.deepEqual(edits, [{ event: event.id, step: 2 }]);
    fireEvent.click(queries.getByRole('tab', { name: 'Sales', exact: true }));
    assert.equal(queries.getByRole('tab', { name: 'Sales', exact: true }).getAttribute('aria-selected'), 'true');
    fireEvent.mouseDown(offerings, { button: 0, ctrlKey: false });
    fireEvent.click(offerings);
    assert.deepEqual(changedTabs, ['tickets', 'sales', 'tickets'], 'normal mouse activation plus its click records only one tab change');
  }, { path: '/app?section=events', fetcher: async ({ path }) => {
    if (path.endsWith('/summary')) return response(summary);
    if (path.endsWith('/referral-link')) return new Promise((done) => { completeLink = done; });
    if (path.endsWith('/guestlist-invite-pools')) return new Promise((done) => { completePools = done; });
    return response({ items: [], total: 0, page: 1, pageSize: 10, hasMore: false });
  } });
});
