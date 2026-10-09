import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('signup and profile expose email choices only, keep phone optional and preserve dormant SMS preferences', async () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    FormData: dom.window.FormData, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const original = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const session = { accessToken: 'fixture-token', user: {
    id: 'fixture-user', displayName: 'Test Guest', email: 'guest@fixture.test', phone: '',
    marketingConsentAt: null, transactionalSmsConsentAt: '2026-01-01T00:00:00Z', marketingSmsConsentAt: '2026-01-01T00:00:00Z',
  } };
  const calls = [], profiles = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const path = new URL(String(input), dom.window.location.href).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body });
    const data = path === '/api/auth/onboarding/preview' ? { accountMode: 'new', email: session.user.email, displayName: 'New Customer', kind: 'user', expiresAt: '2099-01-01T00:00:00Z' }
      : path === '/api/auth/register' ? session
      : path === '/api/customer/profile' ? { ...session.user, marketingConsentAt: body.marketingConsent ? '2026-01-02T00:00:00Z' : null }
        : {};
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  let vite, view;
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom', ssr: { external: ['@nitewide/pricing'] } });
    const { AuthDialog } = await vite.ssrLoadModule('/src/components/auth-dialog.jsx');
    const { AccountDialog } = await vite.ssrLoadModule('/src/components/account-dialog.jsx');
    const { OnboardingSetup } = await vite.ssrLoadModule('/src/components/onboarding-setup.jsx');
    const React = await import('react');
    const { render, within, waitFor, fireEvent } = await import('@testing-library/react');
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const screen = within(dom.window.document.body);
    let signedIn;
    view = render(React.createElement(AuthDialog, { open: true, onOpenChange() {}, onSuccess: result => { signedIn = result; } }));
    await user.click(screen.getByRole('button', { name: 'Create an account', exact: true }));
    const phone = screen.getByRole('textbox', { name: /Phone number/ });
    assert.equal(phone.required, false);
    assert.equal(screen.queryByRole('checkbox', { name: /text|sms/i }), null);
    assert.equal(screen.getAllByRole('checkbox').length, 2);
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Test Guest');
    await user.type(screen.getByRole('textbox', { name: 'Email address' }), session.user.email);
    await user.type(screen.getByLabelText('Password', { exact: true }), 'Welcome123');
    await user.type(screen.getByLabelText('Confirm password', { exact: true }), 'Welcome123');
    await user.click(screen.getByRole('checkbox', { name: 'Email me event recommendations and updates.' }));
    const agreement = screen.getByRole('checkbox', { name: /I agree to the terms/ });
    const privacyLink = screen.getByRole('link', { name: 'Privacy Policy', exact: true });
    assert.equal(privacyLink.href, 'http://localhost:5173/privacy');
    assert.equal(privacyLink.target, '_blank');
    assert.equal(privacyLink.rel, 'noopener noreferrer');
    assert.match(agreement.getAttribute('aria-label'), /acknowledge the Privacy Policy/);
    assert.equal(agreement.checked, false);
    assert.equal(agreement.required, true);
    assert.equal(screen.getByRole('button', { name: 'Create account', exact: true }).disabled, true);
    fireEvent.submit(screen.getByRole('form', { name: 'Customer authentication' }));
    assert.equal(calls.some(call => call.path === '/api/auth/register'), false, 'submit guard cannot infer consent');
    const termsLink = screen.getByRole('link', { name: /terms and conditions of use/ });
    await user.click(termsLink);
    const termsDialog = screen.getByRole('dialog', { name: 'Nitewide Terms and Conditions of Use' });
    assert.match(termsDialog.textContent, /30-DAY OPT-OUT/);
    assert.equal(agreement.checked, false, 'opening the terms cannot select consent');
    await user.keyboard('{Escape}');
    assert.equal(screen.queryByRole('dialog', { name: 'Nitewide Terms and Conditions of Use' }), null);
    assert.equal(dom.window.document.activeElement, termsLink);
    assert.equal(screen.getByRole('textbox', { name: 'Your name' }).value, 'Test Guest', 'closing nested terms preserves the signup draft');
    await user.click(agreement);
    await user.click(agreement);
    assert.equal(screen.getByRole('button', { name: 'Create account', exact: true }).disabled, true, 'unchecking consent blocks registration again');
    await user.click(agreement);
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    await waitFor(() => assert.ok(signedIn));
    const registration = calls.find(call => call.path === '/api/auth/register').body;
    assert.equal(registration.phone, '');
    assert.equal(registration.marketingConsent, true);
    assert.equal(registration.termsAccepted, true);
    assert.equal(registration.termsVersion, '2026-10-07');
    assert.equal(registration.privacyAcknowledged, true);
    assert.equal(registration.privacyVersion, '2026-10-09');
    assert.equal('transactionalSmsConsent' in registration || 'marketingSmsConsent' in registration, false);

    view.rerender(React.createElement(AccountDialog, { open: true, onOpenChange() {}, session, onProfile: value => profiles.push(value), onSignOut() {} }));
    const emailChoice = await screen.findByRole('checkbox', { name: 'Offers and recommendations by email' });
    assert.equal(screen.queryByRole('checkbox', { name: /text|sms/i }), null);
    assert.equal(screen.getAllByRole('checkbox').length, 1);
    assert.equal(screen.getByLabelText('Phone number', { exact: true }).required, false);
    await user.click(emailChoice);
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() => assert.equal(profiles.length, 1));
    assert.deepEqual(calls.find(call => call.path === '/api/customer/profile').body, {
      displayName: session.user.displayName, phone: '', marketingConsent: true,
      transactionalSmsConsent: true, marketingSmsConsent: true,
    });
    assert.equal(profiles[0].transactionalSmsConsentAt, session.user.transactionalSmsConsentAt);
    assert.equal(profiles[0].marketingSmsConsentAt, session.user.marketingSmsConsentAt);

    view.rerender(React.createElement(OnboardingSetup, { token: 'fixture-onboarding', session: null }));
    const activate = await screen.findByRole('button', { name: 'Confirm email and activate' });
    assert.equal(activate.disabled, true);
    await user.type(screen.getByLabelText('New password', { exact: true }), 'Welcome123');
    await user.type(screen.getByLabelText('Confirm password', { exact: true }), 'Welcome123');
    assert.equal(activate.disabled, true);
    fireEvent.submit(activate.closest('form'));
    assert.equal(calls.some(call => call.path === '/api/auth/onboarding/accept'), false);
    await user.click(screen.getByRole('checkbox', { name: /I agree to the terms/ }));
    await user.click(activate);
    await screen.findByRole('heading', { name: "You're all set." });
    assert.deepEqual(calls.find(call => call.path === '/api/auth/onboarding/accept').body, {
      token: 'fixture-onboarding', password: 'Welcome123', confirmPassword: 'Welcome123', termsAccepted: true, termsVersion: '2026-10-07', privacyAcknowledged: true, privacyVersion: '2026-10-09',
    });
  } finally {
    view?.unmount();
    await vite?.close();
    globalThis.fetch = oldFetch;
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
