import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('public rundown React pagination is anonymous, manual, retryable and protected from stale responses', async t => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://customer.fixture.test/?city=Miami%2C+FL', pretendToBeVisual: true,
  });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const originalFetch = globalThis.fetch;
  let requests = [], vite, view, cleanup;
  // The transport intentionally ignores AbortSignal so these checks exercise
  // response guards as well as the browser's normal cancellation behavior.
  globalThis.fetch = (input, options) => new Promise((resolveRequest, reject) => {
    requests.push({ url: new URL(String(input), dom.window.location.href), signal: options.signal, headers: options.headers, method: options.method || 'GET', body: options.body, reject,
      finish(data, status = 200) {
        resolveRequest(new Response(JSON.stringify(status === 200 ? { data } : { error: { message: 'Fixture request failed' } }),
          { status, headers: { 'content-type': 'application/json' } }));
      } });
  });
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent',
      ssr: { external: ['@nitewide/pricing'] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    const { RundownPage, RundownCard } = await vite.ssrLoadModule('/src/components/rundown-page.jsx');
    const { useRundown } = await vite.ssrLoadModule('/src/lib/use-rundown.js');
    const React = await import('react');
    const testing = await import('@testing-library/react');
    const { render, renderHook, screen, act, fireEvent } = testing;
    cleanup = testing.cleanup;
    const id = 'a1000000-0000-4000-8000-000000000001';
    const otherId = 'a1000000-0000-4000-8000-000000000002';
    const event = (number, extra = {}) => ({ id: `event-${number}`, title: `Night ${number}`, startsAt: '2099-01-01T23:00:00Z',
      imageUrl: `/flyers/night-${number}.png`, location: { name: 'Velvet Room', city: number % 2 ? 'Orlando' : 'Miami', timezone: 'America/New_York' },
      offerings: [{ id: `offering-${number}`, priceCents: number === 2 ? 0 : 1000, currency: 'USD', effectiveFeeMode: 'buyer' }],
      referralCode: number % 2 ? `referral-${number}` : null, ...extra });
    const six = start => Array.from({ length: 6 }, (_, index) => event(start + index));
    const page = (items = [], extra = {}) => ({ profile: { kind: 'personal', name: 'Alex Morgan' }, items, hasMore: false, nextCursor: null, ...extra });
    const cards = () => screen.queryAllByTestId('rundown-event-card');
    const mount = (extra = {}) => { view = render(React.createElement(RundownPage, { rundownId: id, ...extra }), { container: dom.window.document.getElementById('root') }); };
    const reset = () => { view?.unmount(); view = null; cleanup(); dom.window.document.body.innerHTML = '<div id="root"></div>'; requests = []; };
    const finish = (index, data, status = 200) => act(async () => { requests[index].finish(data, status); });
    const fail = index => act(async () => { requests[index].reject(new Error('Fixture connection lost')); });

    await t.test('first page loads only six across cities without a token or eager pagination, and cards open their exact attribution', async () => {
      reset(); const opened = []; mount({ onOpenEvent: item => opened.push(item) });
      assert.ok(screen.getByText('Loading the rundown…')); assert.equal(cards().length, 0); assert.equal(requests.length, 1);
      assert.equal(requests[0].url.pathname, `/api/rundowns/${id}`);
      assert.deepEqual([...requests[0].url.searchParams.entries()], [['pageSize', '6']]);
      assert.equal(requests[0].headers.Authorization, undefined);
      await finish(0, page(six(1), { hasMore: true, nextCursor: 'page-2' }));
      assert.equal(cards().length, 6); assert.equal(requests.length, 1);
      assert.ok(screen.getByRole('heading', { name: 'Alex Morgan’s Rundown' }));
      assert.ok(screen.getByText('Free')); assert.equal(screen.getAllByText('From $11.64 total').length, 5);
      assert.equal(screen.queryByRole('button', { name: /sign in/i }), null);
      fireEvent.click(screen.getByRole('button', { name: 'View Night 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'View Night 2' }));
      assert.deepEqual(opened.map(item => [item.id, item.referralCode]), [['event-1', 'referral-1'], ['event-2', null]]);
      assert.equal(screen.getAllByRole('img').length, 6);
      assert.equal(screen.getByRole('img', { name: 'Night 1 event flyer' }).getAttribute('src'), '/flyers/night-1.png');
      assert.ok(screen.getByRole('button', { name: 'View more' })); assert.equal(requests.length, 1);
    });

    await t.test('View more appends the next six, prevents double requests and stops at the final cursor', async () => {
      reset(); mount(); await finish(0, page(six(1), { hasMore: true, nextCursor: 'next/+&city=Miami' }));
      const more = screen.getByRole('button', { name: 'View more' });
      fireEvent.click(more); fireEvent.click(more);
      assert.equal(requests.length, 2); assert.equal(cards().length, 6);
      assert.equal(requests[1].url.searchParams.get('cursor'), 'next/+&city=Miami');
      assert.equal(requests[1].url.searchParams.get('pageSize'), '6');
      assert.equal(screen.getByRole('button', { name: 'Loading more…' }).disabled, true);
      await finish(1, page(six(7)));
      assert.deepEqual(cards().map(card => card.dataset.eventId), Array.from({ length: 12 }, (_, index) => `event-${index + 1}`));
      assert.equal(screen.queryByRole('button', { name: 'View more' }), null); assert.equal(requests.length, 2);
    });

    await t.test('duplicates within and across pages never produce duplicate cards or replace earlier event attribution', async () => {
      reset(); mount(); await finish(0, page([event(1), event(1), event(2)], { hasMore: true, nextCursor: 'next' }));
      assert.equal(cards().length, 2);
      fireEvent.click(screen.getByRole('button', { name: 'View more' }));
      await finish(1, page([event(2), event(3), event(3)]));
      assert.deepEqual(cards().map(card => card.dataset.eventId), ['event-1', 'event-2', 'event-3']);
    });

    await t.test('append failure retains all visible cards and retries the same cursor', async () => {
      reset(); mount(); await finish(0, page(six(1), { hasMore: true, nextCursor: 'page-2' }));
      fireEvent.click(screen.getByRole('button', { name: 'View more' })); await fail(1);
      assert.equal(cards().length, 6); assert.ok(screen.getByRole('alert'));
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      assert.equal(requests.length, 3); assert.equal(requests[2].url.search, requests[1].url.search);
      await finish(2, page(six(7))); assert.equal(cards().length, 12); assert.equal(screen.queryByRole('alert'), null);
    });

    await t.test('first-page transport and malformed-response errors can retry without rendering empty success', async () => {
      reset(); mount(); await fail(0); assert.ok(screen.getByRole('alert')); assert.equal(cards().length, 0);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      assert.ok(screen.getByText('Loading the rundown…')); await finish(1, { items: [] });
      assert.ok(screen.getByRole('alert')); assert.equal(screen.queryByText('No upcoming events yet.'), null);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await finish(2, page([event(1)]));
      assert.equal(cards().length, 1); assert.equal(screen.queryByRole('alert'), null);
    });

    await t.test('switching rundown clears old cards immediately and ignores a late page from the previous owner', async () => {
      reset(); mount(); await finish(0, page(six(1), { hasMore: true, nextCursor: 'page-2' }));
      fireEvent.click(screen.getByRole('button', { name: 'View more' }));
      view.rerender(React.createElement(RundownPage, { rundownId: otherId }));
      assert.equal(cards().length, 0); assert.equal(requests[1].signal.aborted, true);
      assert.equal(screen.queryByRole('heading', { name: 'Alex Morgan’s Rundown' }), null);
      await finish(2, page([event(50)], { profile: { kind: 'business', name: 'Velvet Room' } }));
      await finish(1, page(six(7)));
      assert.deepEqual(cards().map(card => card.dataset.eventId), ['event-50']);
      assert.ok(screen.getByRole('heading', { name: 'Velvet Room’s Rundown' }));
    });

    await t.test('late first responses and rejected requests cannot overwrite the active rundown; unmount aborts', async () => {
      reset(); mount(); view.rerender(React.createElement(RundownPage, { rundownId: otherId }));
      assert.equal(requests[0].signal.aborted, true);
      await finish(0, page(six(1))); assert.equal(cards().length, 0);
      await finish(1, page([event(50)])); assert.equal(cards()[0].dataset.eventId, 'event-50');
      view.rerender(React.createElement(RundownPage, { rundownId: id }));
      view.rerender(React.createElement(RundownPage, { rundownId: otherId }));
      await fail(2); assert.equal(screen.queryByRole('alert'), null);
      assert.equal(requests[2].signal.aborted, true);
      view.unmount(); view = null; assert.equal(requests[3].signal.aborted, true);
      await finish(3, page(six(1))); assert.equal(cards().length, 0);
    });

    await t.test('refresh aborts in-flight append and replaces rather than appends the new first page', async () => {
      reset();
      const hook = renderHook(() => useRundown(id));
      try {
        await finish(0, page(six(1), { hasMore: true, nextCursor: 'page-2' }));
        act(() => { hook.result.current.loadMore(); });
        act(() => { hook.result.current.reload(); });
        assert.equal(requests[1].signal.aborted, true); assert.equal(hook.result.current.items.length, 0);
        await finish(1, page(six(7))); assert.equal(hook.result.current.items.length, 0);
        await finish(2, page([event(50)])); assert.deepEqual(hook.result.current.items.map(item => item.id), ['event-50']);
      } finally { hook.unmount(); }
    });

    await t.test('empty, unavailable and invalid IDs render public states without a sign-in request', async () => {
      reset(); mount(); await finish(0, page());
      assert.ok(screen.getByRole('heading', { name: 'No upcoming events yet.' }));
      assert.equal(screen.queryByRole('button', { name: 'View more' }), null);
      view.rerender(React.createElement(RundownPage, { rundownId: otherId })); await finish(1, {}, 404);
      assert.ok(screen.getByRole('heading', { name: 'This rundown isn’t available.' }));
      assert.ok(screen.getByRole('link', { name: 'Discover events' }));
      view.rerender(React.createElement(RundownPage, { rundownId: 'not-an-id' }));
      assert.equal(requests.length, 2); assert.ok(screen.getByRole('heading', { name: 'This rundown isn’t available.' }));
      assert.equal(screen.queryByRole('button', { name: /sign in/i }), null);
    });

    await t.test('a rundown removed during pagination clears its formerly public cards', async () => {
      reset(); mount(); await finish(0, page(six(1), { hasMore: true, nextCursor: 'page-2' }));
      fireEvent.click(screen.getByRole('button', { name: 'View more' })); await finish(1, {}, 404);
      assert.equal(cards().length, 0); assert.ok(screen.getByRole('heading', { name: 'This rundown isn’t available.' }));
      assert.equal(screen.queryByRole('button', { name: 'Try again' }), null);
    });

    await t.test('profile names are rendered as text for both personal and business rundowns', async () => {
      const markup = '<img src=x onerror="window.bad=true">';
      for (const kind of ['personal', 'business']) {
        reset(); mount(); await finish(0, page([event(1)], { profile: { kind, name: markup } }));
        assert.ok(screen.getByRole('heading', { name: `${markup}’s Rundown` }));
        assert.equal(dom.window.document.querySelector('.rundown-heading img'), null);
        assert.equal(dom.window.bad, undefined);
      }
    });

    const personal = { kind: 'personal', organizationId: null };
    const business = organizationId => ({ kind: 'business', organizationId });
    const session = (accessToken = 'preview-token', userId = 'preview-user') => ({ accessToken, user: { id: userId } });
    const previewProps = (preview = personal, signedIn = session()) => ({ preview, session: signedIn });

    await t.test('private previews require a complete signed-in identity and invoke Sign in without any request', async () => {
      reset(); let signIns = 0;
      mount({ preview: personal, session: null, onSignIn: () => { signIns += 1; } });
      assert.ok(screen.getByRole('heading', { name: 'Sign in to view your rundown.' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      assert.equal(signIns, 1); assert.equal(requests.length, 0); assert.equal(cards().length, 0);
      for (const incomplete of [{ accessToken: 'token-only' }, { user: { id: 'user-only' } }, { accessToken: '', user: { id: 'user' } }]) {
        view.rerender(React.createElement(RundownPage, { preview: personal, session: incomplete }));
        assert.equal(requests.length, 0); assert.ok(screen.getByRole('heading', { name: 'Sign in to view your rundown.' }));
      }
      view.rerender(React.createElement(RundownPage, previewProps()));
      assert.equal(requests.length, 1); assert.ok(screen.getByText('Loading the rundown…'));
      await finish(0, page([event(1, { referralCode: null })]));
      assert.equal(cards().length, 1); assert.equal(screen.queryByRole('button', { name: 'Sign in' }), null);
    });

    await t.test('personal preview reads six events before sharing and paginates with the current token', async () => {
      reset(); const opened = [];
      mount({ ...previewProps(), onOpenEvent: item => opened.push(item) });
      assert.equal(requests[0].url.pathname, '/api/customer/rundowns/preview');
      assert.deepEqual([...requests[0].url.searchParams.entries()], [['kind', 'personal'], ['pageSize', '6']]);
      assert.equal(requests[0].headers.Authorization, 'Bearer preview-token');
      assert.equal(requests[0].method, 'GET'); assert.equal(requests[0].body, undefined);
      await finish(0, page(six(1).map(item => ({ ...item, referralCode: null })), { hasMore: true, nextCursor: 'preview-next' }));
      assert.equal(cards().length, 6); assert.equal(requests.length, 1);
      assert.ok(screen.getByRole('heading', { name: 'Alex Morgan’s Rundown' }));
      assert.ok(screen.getByText('Preview · Upcoming nights · Soonest first'));
      assert.equal(screen.queryByRole('button', { name: /share|publish/i }), null);
      fireEvent.click(screen.getByRole('button', { name: 'View Night 1' }));
      assert.equal(opened[0].referralCode, null);
      fireEvent.click(screen.getByRole('button', { name: 'View more' }));
      assert.equal(requests[1].url.searchParams.get('cursor'), 'preview-next');
      assert.equal(requests[1].headers.Authorization, 'Bearer preview-token');
      await finish(1, page(six(7))); assert.equal(cards().length, 12);
      assert.equal(requests.length, 2); assert.ok(requests.every(request => request.method === 'GET' && request.body === undefined));
    });

    await t.test('business preview scopes the read to its organization and rejects a different profile kind', async () => {
      reset(); mount(previewProps(business(id)));
      assert.deepEqual([...requests[0].url.searchParams.entries()], [['kind', 'business'], ['pageSize', '6'], ['organizationId', id]]);
      await finish(0, page([event(1)]));
      assert.ok(screen.getByRole('alert')); assert.equal(cards().length, 0);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await finish(1, page(six(1), { profile: { kind: 'business', name: 'Velvet Room' } }));
      assert.ok(screen.getByRole('heading', { name: 'Velvet Room’s Rundown' })); assert.equal(cards().length, 6);
    });

    await t.test('preview kind and organization switches clear private cards and abort old page requests', async () => {
      reset(); mount(previewProps());
      await finish(0, page(six(1), { hasMore: true, nextCursor: 'personal-next' }));
      fireEvent.click(screen.getByRole('button', { name: 'View more' }));
      view.rerender(React.createElement(RundownPage, previewProps(business(id))));
      assert.equal(cards().length, 0); assert.equal(requests[1].signal.aborted, true);
      await finish(2, page([event(50)], { profile: { kind: 'business', name: 'Velvet Room' }, hasMore: true, nextCursor: 'business-next' }));
      await finish(1, page(six(7))); assert.deepEqual(cards().map(card => card.dataset.eventId), ['event-50']);
      fireEvent.click(screen.getByRole('button', { name: 'View more' }));
      view.rerender(React.createElement(RundownPage, previewProps(business(otherId))));
      assert.equal(cards().length, 0); assert.equal(requests[3].signal.aborted, true);
      assert.equal(requests[4].url.searchParams.get('organizationId'), otherId);
      await finish(4, page([event(70)], { profile: { kind: 'business', name: 'Another Venue' } }));
      await finish(3, page([event(60)], { profile: { kind: 'business', name: 'Velvet Room' } }));
      assert.deepEqual(cards().map(card => card.dataset.eventId), ['event-70']);
      assert.ok(screen.getByRole('heading', { name: 'Another Venue’s Rundown' }));
    });

    await t.test('token rotation and account switches reset preview data even when the other identity field is unchanged', async () => {
      reset(); mount(previewProps()); await finish(0, page(six(1), { hasMore: true, nextCursor: 'next' }));
      fireEvent.click(screen.getByRole('button', { name: 'View more' }));
      view.rerender(React.createElement(RundownPage, previewProps(personal, session('rotated-token'))));
      assert.equal(cards().length, 0); assert.equal(requests[1].signal.aborted, true);
      assert.equal(requests[2].headers.Authorization, 'Bearer rotated-token');
      view.rerender(React.createElement(RundownPage, previewProps(personal, session('rotated-token', 'different-user'))));
      assert.equal(requests[2].signal.aborted, true); assert.equal(cards().length, 0);
      await finish(3, page([event(90)], { profile: { kind: 'personal', name: 'Another Person' } }));
      await finish(2, page(six(7))); await finish(1, page(six(13)));
      assert.deepEqual(cards().map(card => card.dataset.eventId), ['event-90']);
      assert.ok(screen.getByRole('heading', { name: 'Another Person’s Rundown' }));
    });

    await t.test('signing out clears private preview data and switching to public never sends an authorization header', async () => {
      reset(); mount(previewProps()); await finish(0, page(six(1), { hasMore: true, nextCursor: 'next' }));
      fireEvent.click(screen.getByRole('button', { name: 'View more' }));
      view.rerender(React.createElement(RundownPage, previewProps(personal, null)));
      assert.equal(cards().length, 0); assert.equal(requests[1].signal.aborted, true); assert.equal(requests.length, 2);
      await finish(1, page(six(7))); assert.equal(cards().length, 0);
      assert.ok(screen.getByRole('heading', { name: 'Sign in to view your rundown.' }));
      view.rerender(React.createElement(RundownPage, { rundownId: id, session: session() }));
      assert.equal(requests[2].url.pathname, `/api/rundowns/${id}`); assert.equal(requests[2].headers.Authorization, undefined);
      await finish(2, page([event(50)]));
      view.rerender(React.createElement(RundownPage, { rundownId: id, session: session('another-token', 'another-user') }));
      assert.equal(requests.length, 3); assert.deepEqual(cards().map(card => card.dataset.eventId), ['event-50']);
    });

    await t.test('preview denial or token expiry clears previous cards instead of leaving private results visible', async () => {
      reset(); mount(previewProps()); await finish(0, {}, 403);
      assert.ok(screen.getByRole('heading', { name: 'This rundown isn’t available.' })); assert.equal(cards().length, 0);
      view.rerender(React.createElement(RundownPage, previewProps(business(id))));
      await finish(1, page(six(1), { profile: { kind: 'business', name: 'Velvet Room' }, hasMore: true, nextCursor: 'next' }));
      fireEvent.click(screen.getByRole('button', { name: 'View more' })); await finish(2, {}, 403);
      assert.equal(cards().length, 0); assert.ok(screen.getByRole('heading', { name: 'This rundown isn’t available.' }));
      assert.equal(screen.queryByRole('heading', { name: 'Velvet Room’s Rundown' }), null);
      view.rerender(React.createElement(RundownPage, previewProps(personal, session('expired-token'))));
      await finish(3, page(six(1), { hasMore: true, nextCursor: 'next' }));
      fireEvent.click(screen.getByRole('button', { name: 'View more' })); await finish(4, {}, 401);
      assert.equal(cards().length, 0); assert.ok(screen.getByRole('heading', { name: 'Sign in to view your rundown.' }));
    });

    await t.test('preview retry retains its authenticated read and invalid preview targets make no request', async () => {
      reset(); mount(previewProps()); await fail(0);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      assert.equal(requests[1].headers.Authorization, 'Bearer preview-token'); assert.equal(requests[1].url.pathname, '/api/customer/rundowns/preview');
      await finish(1, page(six(1), { hasMore: true, nextCursor: 'next' }));
      fireEvent.click(screen.getByRole('button', { name: 'View more' })); await fail(2);
      assert.equal(cards().length, 6);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      assert.equal(requests[3].url.search, requests[2].url.search); assert.equal(requests[3].headers.Authorization, 'Bearer preview-token');
      await finish(3, page(six(7))); assert.equal(cards().length, 12);
      for (const invalid of [{ kind: 'other' }, business('invalid-org'), { kind: 'personal', organizationId: id }]) {
        view.rerender(React.createElement(RundownPage, previewProps(invalid)));
        assert.equal(cards().length, 0); assert.ok(screen.getByRole('heading', { name: 'This rundown isn’t available.' }));
      }
      assert.equal(requests.length, 4);
    });

    await t.test('mini-card prices show obtainable totals, minimum order quantities and safe unavailable fallback', async () => {
      reset();
      view = render(React.createElement(React.Fragment, null,
        React.createElement(RundownCard, { event: event(1, { offerings: [{ priceCents: 500, currency: 'USD', effectiveFeeMode: 'absorbed', minPerOrder: 2 }] }) }),
        React.createElement(RundownCard, { event: event(2, { offerings: [{ priceCents: 1000, currency: 'USD', saleState: 'sold_out' }], guestlistCapacity: 10 }) }),
        React.createElement(RundownCard, { event: event(3, { offerings: [], startsAt: 'invalid', location: {} }) })),
      { container: dom.window.document.getElementById('root') });
      assert.ok(screen.getByText('From $10 total for 2'));
      assert.ok(screen.getByText('Guestlist available'));
      assert.ok(screen.getByText('View event'));
      assert.ok(screen.getByText('Date to be confirmed'));
    });
  } finally {
    view?.unmount(); cleanup?.(); await vite?.close(); globalThis.fetch = originalFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});

test('rundown mini-flyers preserve full artwork and the mobile grid stays at two columns', async () => {
  const css = await readFile(new URL('../src/components/rundown-page.css', import.meta.url), 'utf8');
  assert.match(css, /\.rundown-flyer img\s*\{[^}]*object-fit:\s*contain/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*\.rundown-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});
