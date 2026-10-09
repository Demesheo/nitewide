import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from './helpers/vite-server.js';

test('profile password edit validates locally, handles server failure, rotates session and clears secrets on cancel', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const original = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const oldFetch = globalThis.fetch;
  const calls = [], sessions = [];
  const fresh = { accessToken: 'new-test-token', expiresAt: '2099-01-01T00:00:00.000Z', user: { displayName: 'Test', email: 'test@example.test' }, roles: ['customer', 'venue_manager'] };
  let fail = true, vite, view;
  globalThis.fetch = async (path, options) => {
    calls.push({ path, ...options });
    return new Response(JSON.stringify(fail ? { error: { message: 'Current password is incorrect' } } : { data: fresh }), { status: fail ? 400 : 200 });
  };
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { ProfileDetails } = await vite.ssrLoadModule('/src/components/profile/ProfileDetails.jsx');
    const React = await import('react');
    const { render, screen } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    view = render(React.createElement(ProfileDetails, { session: { ...fresh, accessToken: 'old-test-token' }, onUpdated() {}, onSessionChanged: (session) => sessions.push(session) }), { container: dom.window.document.getElementById('root') });
    assert.equal(screen.queryByLabelText('Current password'), null);
    await user.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    assert.equal(screen.queryByLabelText('Current password'), null);
    await user.click(screen.getByRole('button', { name: 'Change password', exact: true }));
    const passwordForm = screen.getByRole('form', { name: 'Change password' });
    const submitButton = passwordForm.querySelector('button[type="submit"]');
    await user.type(screen.getByLabelText('Current password'), 'OldPassword123');
    await user.type(screen.getByLabelText('New password'), 'NewPassword456');
    await user.type(screen.getByLabelText('Confirm new password'), 'WrongPassword789');
    assert.equal(submitButton.disabled, true);
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPassword456');
    await user.click(screen.getByRole('button', { name: 'Show new password' }));
    assert.equal(screen.getByLabelText('New password').type, 'text');
    assert.equal(screen.getByLabelText('Current password').type, 'password');
    assert.equal(screen.getByLabelText('Confirm new password').type, 'password');
    assert.equal(calls.length, 0);
    await user.click(submitButton);
    await screen.findByRole('alert');
    assert.equal(sessions.length, 0);
    assert.equal(calls[0].headers.Authorization, 'Bearer old-test-token');
    assert.deepEqual(JSON.parse(calls[0].body), { currentPassword: 'OldPassword123', password: 'NewPassword456', confirmPassword: 'NewPassword456' });
    fail = false;
    await user.click(submitButton);
    await screen.findByText('Password changed. Other sessions have been signed out.');
    assert.deepEqual(sessions, [fresh]);
    for (const label of ['Current password', 'New password', 'Confirm new password']) assert.equal(screen.getByLabelText(label).value, '');
    await user.type(screen.getByLabelText('Current password'), 'DoNotPersist123');
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Change password', exact: true }));
    assert.equal(screen.getByLabelText('Current password').value, '');
    assert.equal(screen.getByLabelText('New password').type, 'password');
    assert.equal(calls.length, 2, 'contact save and visibility/cancel must not submit password requests');
  } finally {
    view?.unmount();
    if (vite) await vite.close();
    globalThis.fetch = oldFetch;
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
