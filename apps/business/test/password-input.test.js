import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('password inputs in all three apps reveal independently without changing form data', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let vite, view;
  try {
    const { createTestServer: createServer } = await import('./helpers/vite-server.js');
    const React = await import('react');
    const { render, cleanup } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const appsRoot = fileURLToPath(new URL('../../', import.meta.url));
    for (const app of ['customer', 'business', 'admin']) {
      const root = resolve(appsRoot, app);
      vite = await createServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
      const { Input } = await vite.ssrLoadModule('/src/components/ui/input.jsx');
      let submissions = 0;
      const ref = React.createRef();
      view = render(React.createElement('form', { onSubmit: event => { event.preventDefault(); submissions++; } },
        React.createElement('label', null, 'Password', React.createElement(Input, { ref, type: 'password', name: 'password', defaultValue: 'ExamplePass123', required: true, minLength: 8, autoComplete: 'current-password' })),
        React.createElement('label', null, 'Confirm password', React.createElement(Input, { type: 'password', name: 'confirmPassword', visibilityLabel: 'confirmed password', defaultValue: 'ExamplePass123', autoComplete: 'new-password' })),
        React.createElement(Input, { type: 'password', disabled: true, visibilityLabel: 'disabled password' }),
        React.createElement(Input, { type: 'email', 'aria-label': 'Email' })
      ), { container: dom.window.document.getElementById('root') });
      const password = view.getByLabelText('Password', { exact: true });
      const confirmation = view.getByLabelText('Confirm password', { exact: true });
      assert.equal(password.type, 'password', app);
      assert.equal(ref.current, password, 'input refs still point at the actual input');
      assert.equal(password.required, true);
      assert.equal(password.minLength, 8);
      assert.equal(password.autocomplete, 'current-password');
      assert.equal(view.getAllByRole('button').length, 3, 'non-password inputs do not have a toggle');
      const show = view.getByRole('button', { name: 'Show password', exact: true });
      assert.equal(show.getAttribute('aria-controls'), password.id);
      assert.ok(show.querySelector('.lucide-eye'));
      await user.click(password);
      await user.click(show);
      assert.equal(password.type, 'text');
      assert.equal(dom.window.document.activeElement, password, 'pointer toggle keeps typing focus');
      assert.equal(confirmation.type, 'password', 'confirmation stays private until separately revealed');
      const hide = view.getByRole('button', { name: 'Hide password', exact: true });
      assert.equal(hide.getAttribute('aria-pressed'), 'true');
      assert.ok(hide.querySelector('.lucide-eye-off'));
      await user.click(view.getByRole('button', { name: 'Show confirmed password', exact: true }));
      assert.equal(confirmation.type, 'text');
      await user.type(password, '4');
      await user.click(hide);
      assert.equal(password.type, 'password');
      assert.equal(password.value, 'ExamplePass1234');
      assert.equal(confirmation.type, 'text');
      await user.tab();
      await user.keyboard(' ');
      assert.equal(password.type, 'text', 'keyboard activation is supported');
      assert.equal(submissions, 0, 'visibility toggles never submit a form');
      assert.deepEqual([...new dom.window.FormData(password.form)], [['password', 'ExamplePass1234'], ['confirmPassword', 'ExamplePass123']]);
      assert.equal(view.getByRole('button', { name: 'Show disabled password' }).disabled, true);
      cleanup(); view = null;
      await vite.close(); vite = null;
    }
  } finally {
    view?.unmount(); await vite?.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
    dom.window.close();
  }
});
