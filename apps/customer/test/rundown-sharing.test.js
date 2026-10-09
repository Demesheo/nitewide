import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('Rundown viewing and sharing use one target and respect browser gestures and current access', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://customer.test/?view=my-events&event=old&ref=old&checkout=old', pretendToBeVisual: true });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLFormElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key] });
  const priorFetch = globalThis.fetch;
  const personalId = '41612bc5-2244-4645-a7ad-a3166d1b3430';
  const businessId = '72d43ba3-ef64-4fe7-b9b2-eefb6c29e98a';
  const secondId = '09cad5da-dd31-4cf0-809e-0a6cf2c9e63a';
  const publicLink = id => `https://customer.test/?rundown=${id}`;
  const personal = { kind: 'personal', name: 'Alex Promoter', organizationId: null, published: false, canPublish: true, url: null };
  const business = { kind: 'business', name: 'The Lounge', organizationId: businessId, published: false, canPublish: true, url: null };
  const publishedPersonal = { ...personal, published: true, url: publicLink(personalId) };
  const publishedBusiness = { ...business, published: true, url: publicLink(businessId) };
  const session = { accessToken: 'first-token', user: { id: 'first-user' } };
  const calls = [], copies = [], shares = [], accessLoss = [];
  const respond = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : { error: data }), { status, headers: { 'content-type': 'application/json' } });
  let handler, vite, view, React, render, screen, waitFor, act, user, RundownSharing, MyEventsPage;
  globalThis.fetch = async (input, options = {}) => {
    const call = { path: new URL(String(input), dom.window.location.href).pathname, ...options, body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    return handler(call);
  };
  function reset() {
    view?.unmount(); view = null; dom.window.document.body.innerHTML = '<div id="root"></div>';
    calls.length = 0; copies.length = 0; shares.length = 0; accessLoss.length = 0;
    Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: text => { copies.push(text); return Promise.resolve(); } } });
    Object.defineProperty(dom.window.navigator, 'share', { configurable: true, value: data => { shares.push(data); return Promise.resolve(); } });
  }
  function mount(overrides = {}) {
    view = render(React.createElement(RundownSharing, { session, onUnauthorized: cause => accessLoss.push(cause), ...overrides }), { container: dom.window.document.getElementById('root') });
  }
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    ({ MyEventsPage } = await vite.ssrLoadModule('/src/components/my-events-page.jsx'));
    ({ RundownSharing } = await vite.ssrLoadModule('/src/components/rundown-sharing.jsx'));
    React = await import('react');
    ({ render, screen, waitFor, act } = await import('@testing-library/react'));
    user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });

    await t.test('View is available first and Share prepares one link directly without a confirmation', async () => {
      reset();
      let release;
      handler = call => call.method === 'POST' ? new Promise(resolve => { release = () => resolve(respond(publishedPersonal)); }) : respond({ items: [personal, business] });
      mount();
      const share = await screen.findByRole('button', { name: 'Share', exact: true });
      assert.equal(screen.getByText('Share your upcoming events on one page').closest('section')?.getAttribute('aria-label'), 'Your rundown');
      assert.equal(screen.getByRole('link', { name: 'View', exact: true }).href, 'https://customer.test/?rundownPreview=personal');
      assert.equal(calls.filter(call => call.method === 'POST').length, 0);
      await user.dblClick(share);
      await waitFor(() => assert.equal(typeof release, 'function'));
      assert.equal(calls.filter(call => call.method === 'POST').length, 1);
      assert.deepEqual(calls.find(call => call.method === 'POST').body, { kind: 'personal' });
      assert.equal(calls.find(call => call.method === 'POST').headers.Authorization, 'Bearer first-token');
      assert.equal(screen.getByRole('button', { name: 'Preparing link…' }).disabled, true);
      assert.equal(screen.queryByRole('dialog'), null, 'Share has no opt-in dialog');
      assert.equal(screen.queryByRole('button', { name: 'Publish rundown' }), null);
      await act(async () => release());
      await screen.findByRole('dialog', { name: 'Share your rundown' });
      assert.equal(shares.length, 0); assert.equal(copies.length, 0);
      const copy = screen.getByRole('button', { name: 'Copy link' });
      await waitFor(() => assert.equal(dom.window.document.activeElement, copy));
      await user.click(copy);
      await waitFor(() => assert.deepEqual(copies, [publicLink(personalId)]));
      await user.click(screen.getByRole('button', { name: 'Share', exact: true }));
      await waitFor(() => assert.equal(shares.length, 1));
      assert.deepEqual(shares[0], { title: 'Alex Promoter · Upcoming events', url: publicLink(personalId) });
      assert.equal(calls.filter(call => call.method === 'POST').length, 1);
      assert.equal(screen.queryByRole('dialog'), null);
    });

    await t.test('one styled target picker supports pointer and keyboard choices before sharing, with no writes', async () => {
      reset();
      handler = () => respond({ items: [personal, business] });
      mount();
      const personalView = await screen.findByRole('link', { name: 'View', exact: true });
      const selector = screen.getByRole('combobox', { name: 'Rundown' });
      await user.click(selector);
      assert.deepEqual(screen.getAllByRole('option').map(option => option.textContent), ['My rundown', 'The Lounge']);
      assert.equal(screen.getByRole('listbox').dataset.side, 'bottom');
      assert.ok(screen.getByRole('listbox').classList.contains('rundown-choice-menu'));
      await user.click(screen.getByRole('option', { name: 'My rundown' }));
      assert.equal(screen.getAllByRole('button', { name: 'Share', exact: true }).length, 1);
      assert.equal(personalView.className, screen.getByRole('button', { name: 'Share', exact: true }).className, 'View and Share use the same outline button styling');
      assert.equal(personalView.dataset.variant, 'outline');
      assert.equal(personalView.compareDocumentPosition(screen.getByRole('button', { name: 'Share', exact: true })) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
      for (const [selection, target] of [['My rundown', 'personal'], ['The Lounge', businessId]]) {
        await user.click(selector);
        await user.click(screen.getByRole('option', { name: selection }));
        const link = screen.getByRole('link', { name: 'View', exact: true });
        assert.equal(link.href, `https://customer.test/?rundownPreview=${target}`);
        assert.equal(link.target, '_blank');
        assert.equal(link.rel, 'noopener noreferrer');
        await user.click(link);
      }
      await user.click(selector);
      await user.keyboard('{Home}{Enter}');
      assert.equal(screen.getByRole('link', { name: 'View', exact: true }).href, 'https://customer.test/?rundownPreview=personal');
      assert.ok(dom.window.document.activeElement === selector, 'keyboard selection returns focus to the rundown control');
      await user.keyboard('{ArrowDown}');
      await screen.findByRole('listbox');
      await user.keyboard('{Escape}');
      assert.equal(screen.queryByRole('listbox'), null);
      assert.ok(dom.window.document.activeElement === selector, 'Escape closes the choices and preserves keyboard focus');
      assert.equal(calls.length, 1, 'View uses the authenticated preview route without preparing a public link');
      assert.equal(calls.filter(call => call.method === 'POST').length, 0);
      assert.equal(shares.length, 0); assert.equal(copies.length, 0);
      assert.equal(screen.queryByRole('dialog'), null);
      assert.equal(dom.window.location.search, '?view=my-events&event=old&ref=old&checkout=old');
    });

    await t.test('eligible business members prepare a link directly and reuse already shared pages', async () => {
      reset();
      handler = call => call.method === 'POST' ? respond(publishedBusiness) : respond({ items: [publishedPersonal, business, { ...publishedBusiness, name: 'Published Business', organizationId: secondId, url: publicLink(secondId) }] });
      mount();
      const selector = await screen.findByRole('combobox', { name: 'Rundown' });
      await user.click(selector);
      await user.click(screen.getByRole('option', { name: 'The Lounge' }));
      await user.click(screen.getByRole('button', { name: 'Share', exact: true }));
      await screen.findByRole('button', { name: 'Copy link' });
      assert.deepEqual(calls.find(call => call.method === 'POST').body, { kind: 'business', organizationId: businessId });
      assert.match(screen.getByRole('dialog').textContent, /The Lounge’s upcoming events/);
      assert.equal(shares.length, 0, 'link preparation waits for a fresh native share gesture');
      await user.click(screen.getByRole('button', { name: 'Done' }));
      await user.click(selector);
      await user.click(screen.getByRole('option', { name: 'Published Business' }));
      await user.click(screen.getByRole('button', { name: 'Share', exact: true }));
      await waitFor(() => assert.equal(shares.length, 1));
      assert.equal(shares[0].url, publicLink(secondId));
      assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    });

    await t.test('native cancellation stays quiet and failure offers fresh copying with manual fallback', async () => {
      reset();
      let cancelled = true;
      Object.defineProperty(dom.window.navigator, 'share', { configurable: true, value: data => { shares.push(data); return Promise.reject(cancelled ? new dom.window.DOMException('Cancelled', 'AbortError') : new Error('Share unavailable')); } });
      handler = () => respond({ items: [publishedPersonal] });
      mount();
      await user.click(await screen.findByRole('button', { name: 'Share', exact: true }));
      await waitFor(() => assert.equal(shares.length, 1));
      assert.equal(screen.queryByRole('dialog'), null); assert.equal(copies.length, 0);
      cancelled = false;
      await user.click(screen.getByRole('button', { name: 'Share', exact: true }));
      await screen.findByRole('dialog', { name: 'Share your rundown' });
      assert.match(screen.getByRole('alert').textContent, /Copy your link below/);
      assert.equal(copies.length, 0, 'failed native share never automatically attempts clipboard access');
      Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied')) } });
      await user.click(screen.getByRole('button', { name: 'Copy link' }));
      const manual = await screen.findByRole('textbox', { name: 'Copy link manually' });
      assert.equal(manual.value, publicLink(personalId)); assert.equal(manual.readOnly, true);
      await user.click(manual);
      assert.equal(manual.selectionStart, 0); assert.equal(manual.selectionEnd, publicLink(personalId).length);
    });

    await t.test('desktop sharing copies a prepared published link once while clipboard work is pending', async () => {
      reset();
      let release;
      Object.defineProperty(dom.window.navigator, 'share', { configurable: true, value: undefined });
      Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: text => { copies.push(text); return new Promise(resolve => { release = resolve; }); } } });
      handler = () => respond({ items: [publishedPersonal] });
      mount();
      await user.dblClick(await screen.findByRole('button', { name: 'Share', exact: true }));
      assert.deepEqual(copies, [publicLink(personalId)]);
      assert.equal(calls.length, 1, 'the clipboard tap does not fetch or prepare another link');
      await act(async () => release());
      await screen.findByText('Rundown link copied. Ready to share.');
      assert.equal(shares.length, 0);
    });

    await t.test('switching accounts aborts both list and publication requests and rejects late responses', async () => {
      reset();
      const pending = [];
      handler = call => new Promise(resolve => pending.push({ call, resolve }));
      mount();
      await waitFor(() => assert.equal(pending.length, 1));
      view.rerender(React.createElement(RundownSharing, { session: { accessToken: 'second-token', user: { id: 'second-user' } }, onUnauthorized: cause => accessLoss.push(cause) }));
      await waitFor(() => assert.equal(pending.length, 2));
      assert.equal(pending[0].call.signal.aborted, true);
      await act(async () => {
        pending[1].resolve(respond({ items: [{ ...personal, name: 'Second Account' }] }));
        pending[0].resolve(respond({ message: 'Old token expired' }, 401));
      });
      await screen.findByRole('link', { name: 'View', exact: true });
      assert.doesNotMatch(dom.window.document.body.textContent, /Alex Promoter/);
      assert.equal(accessLoss.length, 0);
      await user.click(screen.getByRole('button', { name: 'Share', exact: true }));
      await waitFor(() => assert.equal(pending.length, 3));
      assert.equal(pending[2].call.headers.Authorization, 'Bearer second-token');
      view.rerender(React.createElement(RundownSharing, { session, onUnauthorized: cause => accessLoss.push(cause) }));
      await waitFor(() => assert.equal(pending.length, 4));
      assert.equal(pending[2].call.signal.aborted, true);
      assert.equal(screen.queryByRole('dialog'), null);
      await act(async () => {
        pending[3].resolve(respond({ items: [personal] }));
        pending[2].resolve(respond({ ...publishedPersonal, name: 'Second Account' }));
      });
      await screen.findByRole('button', { name: 'Share', exact: true });
      assert.equal(screen.getByRole('link', { name: 'View', exact: true }).href, 'https://customer.test/?rundownPreview=personal');
      assert.equal(shares.length, 0); assert.equal(copies.length, 0);
      await user.click(screen.getByRole('button', { name: 'Share', exact: true }));
      await waitFor(() => assert.equal(pending.length, 5));
      await act(async () => pending[4].resolve(respond(publishedPersonal)));
      await screen.findByRole('dialog', { name: 'Share your rundown' });
      assert.match(screen.getByRole('dialog').textContent, /Alex Promoter/);
      assert.doesNotMatch(screen.getByRole('dialog').textContent, /Second Account/);
    });

    await t.test('preparation denial clears stale controls and requires a read before retrying', async () => {
      reset();
      let denied = false;
      handler = call => {
        if (call.method === 'POST') { denied = true; return respond({ message: 'Business access removed' }, 403); }
        return respond({ items: [{ ...business, canPublish: !denied }] });
      };
      mount();
      await user.click(await screen.findByRole('button', { name: 'Share', exact: true }));
      await screen.findByRole('button', { name: 'Reload rundown sharing' });
      assert.equal(screen.queryByRole('dialog'), null);
      assert.equal(screen.queryByRole('button', { name: 'Publish rundown' }), null);
      await user.click(screen.getByRole('button', { name: 'Reload rundown sharing' }));
      assert.equal((await screen.findByRole('button', { name: 'Share', exact: true })).disabled, true);
      assert.equal(calls.filter(call => call.method === 'POST').length, 1);
      assert.equal(accessLoss.length, 0, 'losing sharing access does not clear unrelated operational access');
    });

    await t.test('unauthorized reads have no publication retry and late eligibility refresh replaces the denial', async () => {
      reset();
      let authorized = false, rechecks = 0;
      handler = () => authorized ? respond({ items: [personal] }) : respond({ message: 'Session expired' }, 401);
      const props = { session, onUnauthorized: cause => accessLoss.push(cause), onRecheck: () => { rechecks += 1; }, refreshKey: 1 };
      view = render(React.createElement(RundownSharing, props), { container: dom.window.document.getElementById('root') });
      await screen.findByRole('button', { name: 'Recheck event access' });
      assert.equal(accessLoss.length, 1);
      assert.equal(screen.queryByRole('button', { name: 'Reload rundown sharing' }), null);
      assert.equal(screen.queryByRole('button', { name: 'Share', exact: true }), null);
      await user.click(screen.getByRole('button', { name: 'Recheck event access' }));
      assert.equal(rechecks, 1); assert.equal(calls.length, 1);
      authorized = true;
      view.rerender(React.createElement(RundownSharing, { ...props, refreshKey: 2 }));
      await screen.findByRole('button', { name: 'Share', exact: true });
    });

    await t.test('sharing failures leave the operational list usable', async () => {
      reset();
      const event = { id: secondId, title: 'Operational Night', status: 'published', startsAt: '2099-10-02T23:00:00Z', endsAt: '2099-10-03T03:00:00Z', location: { name: 'The Lounge', timezone: 'UTC' }, lifetimeSales: { salesCents: 100, paidOrders: 1 } };
      handler = call => call.path.endsWith('/rundowns') ? respond({ message: 'Sharing unavailable' }, 503) : respond({ items: [event], total: 1, page: 1, pageSize: 12, hasMore: false, counts: { upcoming: 1, past: 0 } });
      const changes = [];
      view = render(React.createElement(MyEventsPage, { session, access: { eligible: true, loading: false, error: '', successRevision: 1, recheck() {} }, route: { myStatus: 'upcoming', myPage: 1, mySearch: '', myEventId: null }, onRouteChange: next => changes.push(next), onUnauthorized: cause => accessLoss.push(cause) }), { container: dom.window.document.getElementById('root') });
      const card = await screen.findByRole('button', { name: 'View Operational Night operations' });
      await screen.findByRole('button', { name: 'Reload rundown sharing' });
      await user.click(card);
      assert.equal(changes.at(-1).myEventId, secondId);
      assert.equal(accessLoss.length, 0);
    });

    await t.test('permanent rundown links share directly while preserving the existing preview action', async () => {
      reset(); const url = `https://customer.test/rundowns/${personalId}`;
      handler = () => respond({ items: [{ ...publishedPersonal, url }] });
      mount(); await screen.findByRole('button', { name: 'Share', exact: true });
      await user.click(screen.getByRole('button', { name: 'Share', exact: true }));
      assert.equal(shares.at(-1).url, url);
      assert.equal(screen.getByRole('link', { name: 'View', exact: true }).href, 'https://customer.test/?rundownPreview=personal');
    });
    for (const url of ['javascript:alert(1)', `https://other.test/?rundown=${personalId}`, `${publicLink(personalId)}&ref=old`, `https://customer.test/private?rundown=${personalId}`,
      `https://customer.test/rundowns/${personalId}?ref=old`, `https://customer.test/rundowns/${personalId}#private`]) {
      await t.test(`malformed public link never enables sharing: ${url}`, async () => {
        reset(); handler = () => respond({ items: [{ ...publishedPersonal, url }] });
        mount(); await screen.findByRole('button', { name: 'Reload rundown sharing' });
        assert.equal(screen.queryByRole('button', { name: 'Share', exact: true }), null);
        assert.equal(screen.queryByRole('link', { name: 'View', exact: true }), null);
        assert.equal(shares.length, 0); assert.equal(copies.length, 0);
      });
    }
  } finally {
    view?.unmount(); await vite?.close(); globalThis.fetch = priorFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
