import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('customer password form validates without requests, handles failure, replaces the complete session and clears secrets', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const original = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const oldFetch = globalThis.fetch, calls = [], sessions = [], activity = [];
  const session = { accessToken: 'old-fixture-token', user: { id: 'fixture-user' } }, fresh = { ...session, accessToken: 'replacement-fixture-token' };
  let fail = true, vite, view;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify(fail ? { error: { message: 'Current password is incorrect' } } : { data: fresh }), { status: fail ? 400 : 200 });
  };
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { ProfilePasswordForm } = await vite.ssrLoadModule('/src/components/profile-password-form.jsx');
    const React = await import('react');
    const { render, screen, waitFor } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const props = { session, open: true, onSessionChanged: (updated) => sessions.push(updated), onBusyChange: (busy) => activity.push(busy), onCancel() {} };
    view = render(React.createElement(ProfilePasswordForm, props), { container: dom.window.document.getElementById('root') });
    await user.type(screen.getByLabelText('Current password'), 'OldPassword123');
    await user.type(screen.getByLabelText('New password'), 'NewPassword456');
    await user.type(screen.getByLabelText('Confirm new password'), 'Mismatch123');
    assert.equal(screen.getByRole('button', { name: 'Change password', exact: true }).disabled, true);
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPassword456');
    await user.click(screen.getByRole('button', { name: 'Show new password' }));
    assert.equal(screen.getByLabelText('New password').type, 'text');
    assert.equal(screen.getByLabelText('Confirm new password').type, 'password');
    assert.equal(calls.length, 0);
    await user.click(screen.getByRole('button', { name: 'Change password', exact: true }));
    await screen.findByRole('alert');
    assert.equal(sessions.length, 0);
    assert.equal(calls[0].headers.Authorization, 'Bearer old-fixture-token');
    assert.deepEqual(JSON.parse(calls[0].body), { currentPassword: 'OldPassword123', password: 'NewPassword456', confirmPassword: 'NewPassword456' });
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Change password', exact: true }));
    await screen.findByRole('status');
    assert.deepEqual(sessions, [fresh]);
    for (const label of ['Current password', 'New password', 'Confirm new password']) assert.equal(screen.getByLabelText(label).value, '');
    await user.type(screen.getByLabelText('Current password'), 'DoNotPersist123');
    view.rerender(React.createElement(ProfilePasswordForm, { ...props, open: false }));
    await waitFor(() => assert.equal(screen.getByLabelText('Current password').value, ''));
    assert.deepEqual(activity, [true, false, true, false]);
  } finally {
    view?.unmount();
    if (vite) await vite.close();
    globalThis.fetch = oldFetch;
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
