import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventPeopleTestServer } from './helpers/event-people-runtime.js';
import './event-referral-reactivation.cases.js';

test('event commissions require individual eligibility and invitations start at zero', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLFormElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.ResizeObserver = dom.window.ResizeObserver;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  let vite;
  let cleanupRoots;
  try {
    vite = await createEventPeopleTestServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { EventPeople } = await vite.ssrLoadModule('/src/components/EventDetail.jsx');
    const React = await import('react');
    const { render, within, waitFor, cleanup } = await import('@testing-library/react');
    cleanupRoots = cleanup;
    const screen = within(dom.window.document.body);
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const person = { id: 'person-1', userId: 'user-1', name: 'Riley Promoter', email: 'riley@fixture.test', role: 'Promoter', status: 'active', commissionBps: 500, salesCents: 12500, commissionCents: 625, orders: 3, customers: 3, guestlistPlaces: 2, approvedGuestlistPlaces: 1 };
    const props = {
      data: { event: { id: 'event-1', title: 'Fixture Night', status: 'published', canEdit: true, canManage: true }, scope: 'event', people: [person], candidates: [person] },
      session: { accessToken: 'fixture-token' }, onSaved() {}, onUnauthorized() {},
      remote: { search: '', onSearch() {}, sort: 'salesCents', descending: true, onSort() {}, roles: [], onRoles() {}, roleOptions: [{ id: 'Promoter', label: 'Promoters' }] },
    };
    const view = render(React.createElement(EventPeople, props), { container: dom.window.document.getElementById('root') });

    assert.ok(screen.getByText('Stripe setup required'));
    assert.match(screen.getByText('Stripe setup required').closest('td').textContent, /^0%/);

    await user.click(await screen.findByRole('button', { name: /Riley Promoter/ }));
    await screen.findByRole('heading', { name: 'Riley Promoter' });
    assert.ok(screen.getByRole('button', { name: 'Edit member' }));
    assert.equal(screen.queryByRole('slider', { name: 'Event commission percentage' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Remove from event' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Save commission' }), null);

    await user.click(screen.getByRole('button', { name: 'Edit member' }));
    let slider = screen.getByRole('slider', { name: 'Event commission percentage' });
    assert.equal(slider.hasAttribute('data-disabled'), true);
    assert.equal(slider.getAttribute('aria-valuenow'), '0');
    await user.type(slider, '{ArrowRight}');
    assert.equal(slider.getAttribute('aria-valuenow'), '0', 'keyboard input cannot raise a locked rate');
    assert.ok(screen.getByText(/Locked at 0% until this person completes their individual Stripe onboarding/));
    assert.ok(within(screen.getByRole('dialog')).getByText('$6.25'), 'the lock leaves historical commission earnings intact');
    assert.ok(screen.getByRole('button', { name: 'Remove from event' }));
    assert.ok(screen.getByRole('button', { name: 'Save commission' }));
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await user.keyboard('{Escape}');

    // This eligibility fixture exercises the future UI contract only; current
    // backend users cannot obtain an eligible individual Stripe profile yet.
    const eligible = { ...person, effectiveCommissionBps: 750, commissionEligibility: { eligible: true } };
    view.rerender(React.createElement(EventPeople, { ...props, data: { ...props.data, people: [eligible], candidates: [eligible] } }));
    assert.equal(screen.queryByText('Stripe setup required'), null);
    await user.click(screen.getByRole('button', { name: /Riley Promoter/ }));
    await user.click(screen.getByRole('button', { name: 'Edit member' }));
    slider = screen.getByRole('slider', { name: 'Event commission percentage' });
    assert.equal(slider.hasAttribute('data-disabled'), false);
    assert.equal(slider.getAttribute('aria-valuenow'), '7.5');
    slider.focus();
    await user.keyboard('{ArrowRight}');
    assert.equal(slider.getAttribute('aria-valuenow'), '8', 'verified eligibility permits future-rate editing');
    await user.keyboard('{Escape}');

    const invitationRequests = [];
    const legacyInvitation = { id: 'invite-old', email: 'legacy@fixture.test', phone: '+14075550123', commissionBps: 1500, expiresAt: '2027-01-01T00:00:00.000Z' };
    globalThis.fetch = async (url, options = {}) => {
      assert.ok(String(url).endsWith('/business/events/event-1/invitations'));
      const body = options.body ? JSON.parse(options.body) : null;
      if (options.method === 'POST') invitationRequests.push(body);
      const data = options.method === 'POST' ? { ...legacyInvitation, ...body, token: 'fixture-private-invitation', delivery: 'manual' } : [legacyInvitation];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await user.click(screen.getByRole('button', { name: 'Add promoter' }));
    await screen.findByRole('button', { name: 'Renew link' });
    const invitationSlider = screen.getByRole('slider', { name: 'Invitation commission percentage' });
    assert.equal(invitationSlider.hasAttribute('data-disabled'), true);
    assert.equal(invitationSlider.getAttribute('aria-valuenow'), '0');
    assert.ok(screen.getByText(/Invitations start at 0%/));
    await user.click(screen.getByRole('button', { name: 'Renew link' }));
    await screen.findByRole('status');
    assert.equal(screen.getByRole('textbox', { name: 'Invitation link' }).value, 'http://localhost/?invite=fixture-private-invitation');
    assert.deepEqual(invitationRequests[0], { email: legacyInvitation.email, phone: legacyInvitation.phone, commissionBps: 0 }, 'renewal resets a historical nonzero invitation rate until individual verification');
    await user.type(screen.getByLabelText('Email address'), 'new@fixture.test');
    await user.click(screen.getByRole('button', { name: 'Create invitation' }));
    await waitFor(() => assert.equal(invitationRequests.length, 2));
    await waitFor(() => assert.equal(screen.getByRole('textbox', { name: 'Invitation link' }).value, 'http://localhost/?invite=fixture-private-invitation'));
    const emailLink = new URL(screen.getByRole('link', { name: 'Open email app' }).href);
    assert.ok(emailLink.searchParams.get('body').includes('http://localhost/?invite=fixture-private-invitation'));
    assert.deepEqual(invitationRequests[1], { email: 'new@fixture.test', phone: '', commissionBps: 0 });
    assert.equal(screen.getByRole('slider', { name: 'Invitation commission percentage' }).getAttribute('aria-valuenow'), '0');
  } finally {
    try { cleanupRoots?.(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.fetch = priorFetch;
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
