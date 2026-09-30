import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('password reset deep link remains intact until a mocked reset succeeds', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/app?resetPassword=synthetic-reset-token&next=events',
    pretendToBeVisual: true,
  });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element,
    Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const priorFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), dom.window.location.href);
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ data: { message: 'If an account exists, we’ll send a one-hour reset link.' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  let vite;
  let unmount;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { BusinessSignIn } = await vite.ssrLoadModule('/src/components/BusinessSignIn.jsx');
    const React = await import('react');
    const { render, screen } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const view = render(React.createElement(BusinessSignIn, { onSession() {} }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();

    await screen.findByRole('heading', { name: 'Choose a new password.' });
    assert.equal(new URL(dom.window.location.href).searchParams.get('resetPassword'), 'synthetic-reset-token');
    await user.type(screen.getByLabelText('New password'), 'CorrectPass123');
    await user.type(screen.getByLabelText('Confirm new password'), 'DifferentPass123');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    await screen.findByRole('alert');
    assert.equal(calls.length, 0, 'mismatched passwords never call reset completion');
    assert.equal(new URL(dom.window.location.href).searchParams.get('resetPassword'), 'synthetic-reset-token', 'a failed attempt preserves the reset token in the URL');

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'CorrectPass123');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    assert.equal(screen.getByLabelText('New password').type, 'text');
    assert.equal(screen.getByLabelText('Confirm new password').type, 'password');
    await user.click(screen.getByRole('button', { name: 'Show confirmed password' }));
    assert.equal(screen.getByLabelText('Confirm new password').type, 'text');
    await user.click(screen.getByRole('button', { name: 'Hide confirmed password' }));
    assert.equal(screen.getByLabelText('Confirm new password').type, 'password');
    assert.equal(calls.length, 0, 'visibility buttons do not trigger a reset request');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    await screen.findByRole('status');
    assert.deepEqual([calls[0].url.pathname, calls[0].method, calls[0].body.token, calls[0].body.password], [
      '/api/auth/password-reset/complete', 'POST', 'synthetic-reset-token', 'CorrectPass123',
    ]);
    assert.equal(new URL(dom.window.location.href).searchParams.has('resetPassword'), false);
    assert.equal(new URL(dom.window.location.href).searchParams.get('next'), 'events', 'URL cleanup leaves unrelated deep-link state intact');

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await screen.findByRole('heading', { name: 'Reset your password.' });
    await user.type(screen.getByRole('textbox', { name: 'Work email' }), 'fixture@fixture.test');
    await user.click(screen.getByRole('button', { name: 'Request reset link' }));
    await screen.findByRole('status');
    assert.deepEqual([calls[1].url.pathname, calls[1].method, calls[1].body.email], [
      '/api/auth/password-reset/request', 'POST', 'fixture@fixture.test',
    ]);
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

test('notifications support scoped read, dismiss, and confirmed clear interactions', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.confirm = () => true;
  const priorFetch = globalThis.fetch;
  const calls = [];
  let failClear = false;
  let notifications = [
    { id: 'notification-one', title: 'New guestlist request', message: 'Review Buyer One', eventId: 'event-one', kind: 'guestlist_request', metadata: { entryId: 'entry-one' }, createdAt: new Date().toISOString(), readAt: null },
    { id: 'notification-two', title: 'Event update', message: 'Review Event Two', eventId: null, kind: 'event_update', metadata: {}, createdAt: new Date().toISOString(), readAt: null },
    ...Array.from({ length: 20 }, (_, index) => ({ id: `notification-${index + 3}`, title: `Fixture notification ${index + 1}`, message: 'Fixture message', eventId: null, kind: 'event_update', metadata: {}, createdAt: new Date().toISOString(), readAt: null })),
  ];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), dom.window.location.href);
    const method = init.method || 'GET';
    calls.push({ url, method });
    if (url.pathname === '/api/notifications' && method === 'GET') {
      const page = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('pageSize') || 20);
      const offset = (page - 1) * pageSize;
      return new Response(JSON.stringify({ data: { items: notifications.slice(offset, offset + pageSize), total: notifications.length, page, pageSize, hasMore: page * pageSize < notifications.length, unreadCount: notifications.filter((item) => !item.readAt).length } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const readMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (readMatch) {
      notifications = notifications.map((item) => item.id === readMatch[1] ? { ...item, readAt: new Date().toISOString() } : item);
    } else if (method === 'DELETE' && url.pathname === '/api/notifications') {
      if (failClear) return new Response(JSON.stringify({ error: { message: 'Fixture clear failure' } }), { status: 503, headers: { 'content-type': 'application/json' } });
      notifications = [];
    } else if (method === 'DELETE' && url.pathname.startsWith('/api/notifications/')) {
      notifications = notifications.filter((item) => item.id !== url.pathname.split('/').at(-1));
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let vite;
  let unmount;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { Notifications } = await vite.ssrLoadModule('/src/components/Notifications.jsx');
    assert.equal(typeof Notifications, 'function');
    const React = await import('react');
    const { render, within, waitFor } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const session = { accessToken: 'synthetic-session-token' };
    const navigations = [];
    const view = render(React.createElement(Notifications, { session, onNavigate: (...args) => navigations.push(args), capabilities: { emailConfigured: false } }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();
    const q = within(dom.window.document.body);
    await q.findByRole('button', { name: 'Notifications, 22 unread' });
    await user.click(q.getByRole('button', { name: 'Notifications, 22 unread' }));
    await q.findByRole('heading', { name: 'Notifications' });
    await q.findByText('Review Buyer One');
    assert.ok(q.getByText(/Email delivery is not configured/), 'UI reports email capability honestly');
    await user.click(q.getByRole('button', { name: 'Next' }));
    assert.ok((await q.findAllByText(/Page 2 of 2/)).length >= 1);
    assert.ok(calls.some((call) => call.url.pathname === '/api/notifications' && call.url.searchParams.get('page') === '2'));
    await user.click(q.getByRole('button', { name: 'Previous' }));
    assert.ok((await q.findAllByText(/Page 1 of 2/)).length >= 1);
    await user.click(q.getByRole('button', { name: /New guestlist request/ }));
    await waitFor(() => assert.deepEqual(navigations[0], ['events', 'event-one', 'entry-one', 'guestlist']));
    assert.ok(calls.some((call) => call.url.pathname === '/api/notifications/notification-one/read' && call.method === 'POST'));

    await user.click(q.getByRole('button', { name: 'Notifications, 21 unread' }));
    await q.findByRole('heading', { name: 'Notifications' });
    const eventRow = q.getByText('Event update').closest('.notification-row');
    await user.click(eventRow.querySelector('button[aria-label="Dismiss"]') || eventRow.querySelector('.notification-row-actions button:last-child'));
    await waitFor(() => assert.equal(notifications.some((item) => item.id === 'notification-two'), false));
    assert.equal(q.queryByText('Event update'), null);
    failClear = true;
    await user.click(q.getByRole('button', { name: 'Clear all' }));
    await q.findByRole('alert');
    assert.equal(notifications.length, 21, 'failed clear keeps the inbox data intact');
    failClear = false;
    await user.click(q.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => assert.equal(notifications.length, 0));
    assert.ok(calls.some((call) => call.url.pathname === '/api/notifications' && call.method === 'DELETE'));
    assert.equal(calls.some((call) => call.url.pathname.includes('email') || call.url.pathname.includes('send')), false, 'inbox interactions never trigger email delivery');
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

test('profile saves role-relevant in-app preferences without invoking email delivery', async () => {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle'];
  const originalGlobals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const priorFetch = globalThis.fetch;
  const calls = [];
  let preferences = { reviewRequests: true, salesActivity: true, inventoryAlerts: true };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), dom.window.location.href);
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (url.pathname === '/api/auth/notification-preferences' && method === 'GET') {
      return new Response(JSON.stringify({ data: preferences }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/api/auth/notification-preferences' && method === 'PATCH') {
      preferences = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: preferences }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let vite;
  let unmount;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    vite = await createServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { BusinessProfile } = await vite.ssrLoadModule('/src/components/BusinessProfile.jsx');
    const React = await import('react');
    const { render, within, waitFor } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const managerSession = { accessToken: 'synthetic-token', roles: ['organization_owner'], user: { id: 'manager-id', displayName: 'Manager', email: 'manager@fixture.test' } };
    let logoutCalls = 0;
    let view = render(React.createElement(BusinessProfile, { session: managerSession, onUpdated() {}, onLogout: () => { logoutCalls += 1; }, capabilities: { emailConfigured: false } }), { container: dom.window.document.getElementById('root') });
    unmount = () => view.unmount();
    let q = within(dom.window.document.body);
    const profilePanel = q.getByRole('region', { name: 'Your profile' });
    const profileSection = within(profilePanel).getByRole('region', { name: 'Profile' });
    const settingsSection = within(profilePanel).getByRole('region', { name: 'Settings' });
    const orderedParts = [...profilePanel.children].map((part) => part.getAttribute('aria-label') || part.tagName.toLowerCase());
    assert.deepEqual(orderedParts, ['Profile', 'Settings', 'footer'], 'profile, settings, and logout are separate stacked sections in order');
    assert.ok(within(profileSection).getByLabelText('Name'));
    assert.ok(within(profileSection).getByLabelText('Email'));
    assert.ok(within(profileSection).getByLabelText('Phone'));
    assert.ok(within(profileSection).getByText('Email verification'));
    assert.equal(within(profileSection).getByRole('button', { name: 'Resend', exact: true }).disabled, true);
    await within(settingsSection).findByRole('checkbox', { name: 'Guestlist requests to review' });
    assert.ok(within(settingsSection).getByRole('checkbox', { name: 'Guestlist requests to review' }));
    assert.equal(within(profileSection).queryByRole('checkbox'), null, 'notification preferences stay inside Settings');
    await user.click(within(profileSection).getByRole('button', { name: 'Edit' }));
    const nameField = within(profileSection).getByLabelText('Name');
    assert.equal(nameField.disabled, false);
    await user.clear(nameField);
    await user.type(nameField, 'Temporary Name');
    await user.click(within(profileSection).getByRole('button', { name: 'Cancel' }));
    assert.equal(within(profileSection).getByLabelText('Name').value, 'Manager', 'cancel restores the original profile fields');
    assert.equal(within(profileSection).queryByRole('button', { name: 'Cancel' }), null, 'cancel returns the profile to read mode');
    await user.click(within(profilePanel).getByRole('button', { name: 'Log out' }));
    assert.equal(logoutCalls, 1, 'logout button invokes the supplied callback');
    await q.findByRole('checkbox', { name: 'Sold-out inventory alerts' });
    assert.equal(within(profileSection).getByRole('button', { name: 'Resend', exact: true }).disabled, true);
    assert.match(q.getByText(/Booking confirmations, guestlist outcomes, and transactional email are not controlled here/).textContent, /not controlled here/);
    await user.click(q.getByRole('checkbox', { name: 'Sales activity' }));
    await user.click(q.getByRole('checkbox', { name: 'Guestlist requests to review' }));
    await user.click(q.getByRole('button', { name: 'Save notification choices' }));
    await q.findByText('In-app notification choices saved.');
    assert.deepEqual(calls.find((call) => call.method === 'PATCH').body, { reviewRequests: false, salesActivity: false, inventoryAlerts: true });
    assert.equal(calls.some((call) => /\/auth\/email\//.test(call.url.pathname)), false, 'saving in-app preferences never requests email delivery');

    view.unmount();
    const promoterSession = { ...managerSession, roles: ['promoter'] };
    const promoterRoot = dom.window.document.createElement('div');
    dom.window.document.body.append(promoterRoot);
    view = render(React.createElement(BusinessProfile, { session: promoterSession, onUpdated() {}, capabilities: { emailConfigured: false } }), { container: promoterRoot });
    await q.findByRole('checkbox', { name: 'Guestlist requests to review' });
    assert.equal(q.queryByRole('checkbox', { name: 'Sold-out inventory alerts' }), null, 'promoters do not see inventory-only controls');
    await waitFor(() => assert.ok(calls.filter((call) => call.method === 'GET').length >= 2));
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
