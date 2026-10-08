import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedTestServer } from './helpers/shared-vite-server.js';

const createGuestlistTestServer = sharedTestServer();

const guest = (id, partySize, status = 'pending', extra = {}) => ({
  id, eventId: 'event-fixture', guestName: `Guest ${id}`, guestEmail: `${id}@fixture.test`,
  partySize, status, source: 'affiliate', eventAffiliateId: 'own-referral', referrerName: 'Own Referrer',
  checkedInSpots: 0, createdAt: '2099-09-01T18:00:00Z', ...extra,
});
const response = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : { error: { message: data } }), {
  status, headers: { 'content-type': 'application/json' },
});

async function withGuestlist(run) {
  const businessRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/app', pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  const state = { rows: [guest('five', 5), guest('two', 2), guest('approved', 4, 'confirmed'), guest('partial', 4, 'confirmed', { checkedInSpots: 1 }), guest('declined', 5, 'rejected')], requests: [], listCalls: 0, decision: () => response({}) };
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), dom.window.location.href);
    if (url.pathname.endsWith('/decision')) {
      const body = JSON.parse(options.body);
      state.requests.push({ path: url.pathname, body });
      return state.decision(body);
    }
    if (url.pathname.endsWith('/guestlist-page')) {
      state.listCalls += 1;
      return response({ items: state.rows, total: state.rows.length, page: 1, pageSize: 10, hasMore: false });
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  };
  let vite;
  let view;
  let cleanupRoots;
  try {
    vite = await createGuestlistTestServer({ configFile: resolve(businessRoot, 'vite.config.js'), root: businessRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    const { Guestlists } = await vite.ssrLoadModule('/src/components/Guestlists.jsx');
    const React = await import('react');
    const testing = await import('@testing-library/react');
    cleanupRoots = testing.cleanup;
    const { within } = await import('@testing-library/dom');
    const screen = within(dom.window.document.body);
    const user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    const props = {
      event: { id: 'event-fixture', title: 'Fixture Night', status: 'published', startsAt: '2099-10-01T22:00:00Z', canManage: false, canEdit: false },
      session: { accessToken: 'fixture-token' }, expire() {}, onUnauthorized() {},
    };
    view = testing.render(React.createElement(Guestlists, props), { container: dom.window.document.getElementById('root') });
    await testing.waitFor(() => assert.ok(state.listCalls));
    const rerender = (extra = {}) => { Object.assign(props, extra); view.rerender(React.createElement(Guestlists, props)); };
    await run({ ...testing, screen, user, within, state, props, rerender });
  } finally {
    try {
      cleanupRoots?.();
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 0));
      globalThis.fetch = priorFetch;
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    }
  }
}

test('review approval sends the adjusted amount, keeps the request fact, and guards a pending save', async () => {
  await withGuestlist(async ({ screen, user, within, state, waitFor, fireEvent, act }) => {
    const trigger = await screen.findByRole('button', { name: 'Guest five' });
    const requestedCell = trigger.closest('tr').querySelector('[data-label="Spots"]');
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    const review = within(dialog);
    const amount = review.getByRole('spinbutton', { name: 'Approved spots' });
    assert.equal(amount.getAttribute('aria-valuenow'), '5', 'own-scope reviewer access survives canManage=false');
    await user.click(review.getByRole('button', { name: 'Decrease approved spots' }));
    assert.equal(amount.getAttribute('aria-valuenow'), '4');
    assert.match(dialog.textContent, /Requested spots5/, 'the customer request remains five spots');
    assert.ok(review.getByText('4 entry passes on approval'));
    assert.equal(requestedCell.textContent, '5', 'draft editing does not mutate the table or reorder requests');
    let finish;
    state.decision = () => new Promise((resolve) => { finish = () => resolve(response({})); });
    const approve = review.getByRole('button', { name: 'Approve' });
    await act(async () => { fireEvent.click(approve); fireEvent.click(approve); });
    await waitFor(() => assert.equal(state.requests.length, 1));
    assert.deepEqual(state.requests[0].body, { decision: 'approve', partySize: 4 });
    assert.equal(review.getByRole('button', { name: 'Decrease approved spots' }).disabled, true);
    assert.equal(review.queryByRole('button', { name: 'Close' }), null, 'busy review cannot be dismissed and has no redundant footer Close');
    await user.keyboard('{Escape}');
    assert.ok(screen.getByRole('dialog'), 'Escape cannot dismiss an in-flight review');
    await act(async () => finish());
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.ok(screen.getByText('Request approved for 4 spots. Admission credential created.'));
  });
});

test('approval drafts reset on another request, reopen, and refreshed request values; endpoints and capacity retries work', async () => {
  await withGuestlist(async ({ screen, user, within, state, waitFor, rerender }) => {
    await user.click(await screen.findByRole('button', { name: 'Guest five' }));
    let review = within(screen.getByRole('dialog'));
    let amount = review.getByRole('spinbutton', { name: 'Approved spots' });
    await user.click(amount);
    await user.keyboard('{Home}');
    assert.equal(amount.getAttribute('aria-valuenow'), '1');
    assert.equal(review.getByRole('button', { name: 'Decrease approved spots' }).disabled, true);
    await user.keyboard('{End}');
    assert.equal(amount.getAttribute('aria-valuenow'), '20');
    assert.equal(review.getByRole('button', { name: 'Increase approved spots' }).disabled, true);
    await user.keyboard('{ArrowDown}');
    assert.equal(amount.getAttribute('aria-valuenow'), '19');
    await user.click(review.getAllByRole('button', { name: 'Close' })[0]);
    await user.click(screen.getByRole('button', { name: 'Guest two' }));
    review = within(screen.getByRole('dialog'));
    assert.equal(review.getByRole('spinbutton', { name: 'Approved spots' }).getAttribute('aria-valuenow'), '2');
    await user.click(review.getAllByRole('button', { name: 'Close' })[0]);
    await user.click(screen.getByRole('button', { name: 'Guest five' }));
    review = within(screen.getByRole('dialog'));
    amount = review.getByRole('spinbutton', { name: 'Approved spots' });
    assert.equal(amount.getAttribute('aria-valuenow'), '5');
    await user.click(review.getByRole('button', { name: 'Decrease approved spots' }));
    const previousCalls = state.listCalls;
    state.rows = state.rows.map((row) => row.id === 'five' ? { ...row, partySize: 3 } : row);
    rerender({ refreshToken: 1 });
    await waitFor(() => assert.ok(state.listCalls > previousCalls));
    await waitFor(() => assert.equal(amount.getAttribute('aria-valuenow'), '3', 'fresh server request resets the draft'));
    await user.click(review.getByRole('button', { name: 'Decrease approved spots' }));
    state.decision = () => response('Not enough guestlist capacity', 409);
    await user.click(review.getByRole('button', { name: 'Approve' }));
    await waitFor(() => assert.ok(review.getByRole('alert')));
    assert.match(review.getByRole('alert').textContent, /capacity/);
    assert.equal(amount.getAttribute('aria-valuenow'), '2', 'failed approval retains the chosen count for correction');
    state.decision = () => response({});
    await user.click(review.getByRole('button', { name: 'Decrease approved spots' }));
    await user.click(review.getByRole('button', { name: 'Approve' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.deepEqual(state.requests.map((request) => request.body), [{ decision: 'approve', partySize: 2 }, { decision: 'approve', partySize: 1 }]);
  });
});

test('decline ignores the approval draft, approved and admitted entries stay fixed, and denied roles have no review actions', async () => {
  await withGuestlist(async ({ screen, user, within, state, waitFor, props, rerender }) => {
    await user.click(await screen.findByRole('button', { name: 'Guest five' }));
    let review = within(screen.getByRole('dialog'));
    await user.click(review.getByRole('button', { name: 'Decrease approved spots' }));
    await user.click(review.getByRole('button', { name: 'Decline' }));
    assert.match(screen.getByRole('dialog').textContent, /no entry credential will be issued/);
    assert.equal(review.getByRole('button', { name: 'Decrease approved spots' }).disabled, true);
    assert.equal(state.requests.length, 0, 'opening a decline confirmation does not submit a decision');
    await user.click(review.getByRole('button', { name: 'Keep request' }));
    assert.equal(review.queryByRole('button', { name: 'Confirm decline' }), null);
    assert.equal(review.getByRole('button', { name: 'Decrease approved spots' }).disabled, false);
    assert.equal(state.requests.length, 0, 'cancelling a decline leaves the request untouched');
    await user.click(review.getByRole('button', { name: 'Decline' }));
    await user.click(review.getByRole('button', { name: 'Confirm decline' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.deepEqual(state.requests[0].body, { decision: 'reject' });
    assert.equal(state.rows.find((row) => row.id === 'five').partySize, 5);
    await user.click(screen.getByRole('button', { name: 'Guest approved' }));
    review = within(screen.getByRole('dialog'));
    assert.equal(review.queryByRole('spinbutton'), null);
    await user.click(review.getByRole('button', { name: 'Revoke approval' }));
    assert.match(screen.getByRole('dialog').textContent, /releases 4 places/);
    await user.click(review.getByRole('button', { name: 'Confirm revocation' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.deepEqual(state.requests[1].body, { decision: 'cancel' });
    await user.click(screen.getByRole('button', { name: 'Guest partial' }));
    review = within(screen.getByRole('dialog'));
    assert.equal(review.queryByRole('spinbutton'), null);
    assert.equal(review.queryByRole('button', { name: 'Revoke approval' }), null);
    await user.click(review.getAllByRole('button', { name: 'Close' })[0]);
    await user.click(screen.getByRole('button', { name: 'Guest declined' }));
    review = within(screen.getByRole('dialog'));
    assert.equal(review.queryByRole('spinbutton'), null, 'a declined request can be reapproved only at its recorded quantity');
    await user.click(review.getByRole('button', { name: 'Approve' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.deepEqual(state.requests[2].body, { decision: 'approve' });
    rerender({ event: { ...props.event, canReviewGuestlist: false } });
    await user.click(screen.getByRole('button', { name: 'Guest five' }));
    review = within(screen.getByRole('dialog'));
    assert.equal(review.queryByRole('spinbutton'), null);
    assert.equal(review.queryByRole('button', { name: 'Approve' }), null);
    assert.equal(review.queryByRole('button', { name: 'Decline' }), null);
  });
});
