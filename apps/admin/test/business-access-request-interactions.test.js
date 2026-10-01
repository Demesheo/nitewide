import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('Admin approval and decline preserve drafts, lock submitted email, require explicit version refresh, and retain manual onboarding', async () => {
  const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/?section=businesses', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } };
  const originals = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const request = { id: '00000000-0000-4000-8000-000000000001', displayName: 'Morgan Contact', email: 'submitted@example.test', phone: '+14075550199', businessName: 'Requested Business', role: 'manager', details: 'Organizer requesting a new business workspace.', status: 'pending', version: 2 };
  const calls = []; const priorFetch = globalThis.fetch; let approvals = 0; let declines = 0; let saved = 0;
  globalThis.fetch = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ path, method: options.method || 'GET', body });
    let status = 200, data;
    if (path.endsWith('/approve')) { approvals += 1; status = approvals === 1 ? 503 : approvals === 2 ? 409 : 200; data = { request: { ...request, status: 'approved', version: 8 }, invitation: { delivery: 'queued' } }; }
    else if (path.endsWith('/decline')) { declines += 1; status = declines === 1 ? 409 : 200; data = { request: { ...request, status: 'declined', version: 8 } }; }
    else if (path.endsWith('/admin/onboarding')) data = { delivery: 'queued' };
    else data = { ...request, version: 7 };
    return new Response(JSON.stringify(status === 200 ? { data } : { error: { message: status === 503 ? 'Setup email could not be queued; the request is still pending.' : 'This request changed. Refresh before continuing.' } }), { status, headers: { 'content-type': 'application/json' } });
  };
  let vite, view;
  try {
    const { createTestServer } = await import('../../business/test/helpers/vite-server.js');
    vite = await createTestServer({ configFile: resolve(appRoot, 'vite.config.js'), root: appRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { default: OnboardingForm } = await vite.ssrLoadModule('/src/components/OnboardingForm.jsx');
    const { DeclineAccessRequest } = await vite.ssrLoadModule('/src/components/BusinessAccessRequests.jsx');
    const React = await import('react'); const { render, screen, waitFor, cleanup } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    view = render(React.createElement(OnboardingForm, { accessRequest: request, onClose() {}, onSaved() { saved += 1; } }));
    assert.equal(screen.getByRole('textbox', { name: 'Email', exact: true }).readOnly, true);
    await user.type(screen.getByRole('textbox', { name: 'Email', exact: true }), 'changed');
    assert.equal(screen.getByRole('textbox', { name: 'Email', exact: true }).value, request.email);
    assert.equal(screen.getByRole('combobox', { name: 'Initial business role' }).value, 'manager');
    assert.equal(screen.getByRole('checkbox', { name: 'Grant separate finance permission' }).checked, false);
    await user.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    await user.clear(screen.getByRole('textbox', { name: 'Business name' })); await user.type(screen.getByRole('textbox', { name: 'Business name' }), 'Corrected Business');
    await user.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    await user.click(screen.getByRole('checkbox', { name: /I have confirmed/ })); await user.type(screen.getByRole('textbox', { name: 'Required audit reason' }), 'Verified business representative');
    await user.click(screen.getByRole('button', { name: 'Approve and queue setup email' })); await screen.findByRole('alert');
    assert.equal(approvals, 1); assert.equal(saved, 0); assert.equal(screen.getByRole('textbox', { name: 'Required audit reason' }).value, 'Verified business representative');
    assert.match(screen.getByRole('alert').textContent, /still pending/);
    await user.click(screen.getByRole('button', { name: 'Approve and queue setup email' }));
    await screen.findByRole('button', { name: 'Refresh request version' });
    assert.equal(screen.getByRole('button', { name: 'Approve and queue setup email' }).disabled, true); assert.equal(approvals, 2);
    await user.click(screen.getByRole('button', { name: 'Refresh request version' }));
    await waitFor(() => assert.ok(screen.getByRole('textbox', { name: 'Full name' })));
    assert.equal(approvals, 2);
    await user.click(screen.getByRole('button', { name: 'Continue', exact: true })); assert.equal(screen.getByRole('textbox', { name: 'Business name' }).value, 'Corrected Business');
    await user.click(screen.getByRole('button', { name: 'Continue', exact: true })); assert.equal(screen.getByRole('checkbox', { name: /I have confirmed/ }).checked, false);
    await user.click(screen.getByRole('checkbox', { name: /I have confirmed/ })); await user.click(screen.getByRole('button', { name: 'Approve and queue setup email' }));
    await screen.findByText('Request approved for onboarding.'); assert.ok(screen.getByText(/Delivery is not yet confirmed/)); assert.ok(screen.getByText(/Active business access still requires/));
    assert.deepEqual(calls.filter((call) => call.path.endsWith('/approve')).map((call) => call.body.version), [2, 2, 7]);
    assert.equal(calls.at(-1).body.recipient.email, request.email); assert.equal(calls.at(-1).body.organization.name, 'Corrected Business'); assert.deepEqual(calls.at(-1).body.venues, []);
    await user.click(screen.getByRole('button', { name: 'Done', exact: true })); assert.equal(saved, 1); cleanup();

    view = render(React.createElement(DeclineAccessRequest, { request, onClose() {}, onSaved() { saved += 1; } }));
    assert.equal(screen.getByRole('button', { name: 'Decline request', exact: true }).disabled, true);
    await user.type(screen.getByRole('textbox', { name: 'Required audit reason' }), 'Verified duplicate business request');
    await user.click(screen.getByRole('button', { name: 'Decline request', exact: true })); await screen.findByRole('alert');
    assert.equal(declines, 1); assert.equal(screen.getByRole('button', { name: 'Decline request', exact: true }).disabled, true);
    await user.click(screen.getByRole('button', { name: 'Refresh request version' })); await screen.findByText(/Request version refreshed/);
    assert.equal(declines, 1); assert.equal(screen.getByRole('textbox', { name: 'Required audit reason' }).value, 'Verified duplicate business request');
    await user.click(screen.getByRole('button', { name: 'Decline request', exact: true })); await waitFor(() => assert.equal(saved, 2));
    assert.deepEqual(calls.filter((call) => call.path.endsWith('/decline')).map((call) => call.body), [{ version: 2, reason: 'Verified duplicate business request' }, { version: 7, reason: 'Verified duplicate business request' }]); cleanup();

    view = render(React.createElement(OnboardingForm, { onClose() {}, onSaved() {} }));
    assert.ok(screen.getByRole('dialog', { name: 'Onboard business', exact: true })); assert.equal(screen.getByRole('textbox', { name: 'Email', exact: true }).readOnly, false);
    assert.equal(screen.getByRole('textbox', { name: 'Full name' }).value, ''); assert.equal(screen.queryByRole('button', { name: 'Refresh request version' }), null);
  } finally {
    view?.unmount(); if (vite) await vite.close(); globalThis.fetch = priorFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
