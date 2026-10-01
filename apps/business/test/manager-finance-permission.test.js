import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('owner-only manager finance controls submit audited, versioned grants and revocations', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } };
  const originals = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const priorFetch = globalThis.fetch;
  const requests = []; let status = 200; let saved = 0; let refreshed = 0; let unauthorized = 0;
  globalThis.fetch = async (path, options) => {
    requests.push({ path, ...options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(status === 200 ? { data: { userId: 'manager', financeAuthorized: requests.at(-1).body.financeAuthorized, version: requests.at(-1).body.version + 1 } }
      : { error: { message: status === 409 ? 'Refresh and try again.' : 'Sign in again.' } }), { status, headers: { 'content-type': 'application/json' } });
  };
  let vite; let view;
  try {
    const { createTestServer } = await import('./helpers/vite-server.js');
    vite = await createTestServer({ configFile: resolve(root, 'vite.config.js'), root, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { ManagerFinancePermission } = await vite.ssrLoadModule('/src/components/ManagerFinancePermission.jsx');
    const React = await import('react');
    const { render, screen, waitFor } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const props = { organizationId: 'business', member: { id: 'manager', role: 'Manager', status: 'active', financeAuthorized: false },
      canGrantFinance: true, organizationVersion: 4, session: { accessToken: 'fixture-token', user: { isInternalAdmin: true } },
      onSaved: () => { saved += 1; }, onRefresh: () => { refreshed += 1; }, onUnauthorized: () => { unauthorized += 1; } };
    view = render(React.createElement(ManagerFinancePermission, props), { container: dom.window.document.getElementById('root') });
    assert.ok(screen.getByText(/future payment-account/));
    assert.equal(screen.getByRole('button', { name: 'Grant finance permission' }).disabled, true);
    await user.type(screen.getByRole('textbox', { name: 'Reason for finance change' }), 'Confirmed payment account delegation');
    await user.click(screen.getByRole('button', { name: 'Grant finance permission' }));
    await screen.findByText('Finance permission: Granted');
    assert.equal(saved, 1);
    assert.equal(requests[0].method, 'PUT');
    assert.equal(requests[0].path, '/api/business/organizations/business/members/manager/finance');
    assert.deepEqual(requests[0].body, { financeAuthorized: true, reason: 'Confirmed payment account delegation', version: 4 });
    assert.equal(requests[0].headers.Authorization, 'Bearer fixture-token');
    await user.type(screen.getByRole('textbox', { name: 'Reason for finance change' }), 'Remove delegated authority');
    await user.click(screen.getByRole('button', { name: 'Revoke finance permission' }));
    await screen.findByText('Finance permission: Not granted');
    assert.equal(requests[1].body.financeAuthorized, false); assert.equal(requests[1].body.version, 5);

    status = 409;
    await user.type(screen.getByRole('textbox', { name: 'Reason for finance change' }), 'Try grant after another edit');
    await user.click(screen.getByRole('button', { name: 'Grant finance permission' }));
    await screen.findByRole('alert');
    assert.ok(screen.getByText('Finance permission: Not granted'));
    assert.equal(screen.getByRole('button', { name: 'Grant finance permission' }).disabled, true);
    assert.equal(refreshed, 1); assert.equal(saved, 2);
    view.rerender(React.createElement(ManagerFinancePermission, { ...props, organizationVersion: 8 }));
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Grant finance permission' }).disabled, false));
    status = 401;
    await user.click(screen.getByRole('button', { name: 'Grant finance permission' }));
    await waitFor(() => assert.equal(unauthorized, 1));
    assert.equal(saved, 2);

    for (const denied of [{ canGrantFinance: false }, { member: { ...props.member, role: 'Employee' } }, { member: { ...props.member, role: 'Owner' } }, { member: { ...props.member, status: 'inactive' } }]) {
      view.rerender(React.createElement(ManagerFinancePermission, { ...props, ...denied }));
      assert.equal(screen.queryByRole('region', { name: 'Manager finance permission' }), null);
    }

  } finally {
    view?.unmount();
    if (vite) await vite.close();
    globalThis.fetch = priorFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
