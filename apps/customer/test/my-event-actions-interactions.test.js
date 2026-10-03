import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../business/test/helpers/vite-server.js';

test('My events guestlist operations stay scoped, private and recoverable', async (t) => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://customer.test/my-events?myEvent=event-fixture&checkout=old&ref=other', pretendToBeVisual: true });
  // JSDOM has no layout observer; browser tests verify the real tooltip layout.
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : typeof dom.window[key] === 'function' && ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key] });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const oldFetch = globalThis.fetch;
  let handler, vite, view;
  const calls = [], copiedLinks = [], changes = [], accessLoss = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), dom.window.location.href);
    const call = { url, ...options, body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    return handler(call);
  };
  const respond = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : { error: data }), { status, headers: { 'content-type': 'application/json' } });
  const pending = { id: 'pending-fixture', eventId: 'event-fixture', guestName: 'Pending Guest', guestEmail: null, guestPhone: null, eventAffiliateId: null, source: 'direct', partySize: 2, status: 'pending', checkedInSpots: 0, checkedInAt: null, hasInvitation: false, createdAt: '2098-09-01T20:00:00Z' };
  const approved = { ...pending, id: 'approved-fixture', guestName: 'Approved Guest', status: 'confirmed', hasInvitation: true, partySize: 4 };
  const partlyAdmitted = { ...approved, id: 'part-admitted', guestName: 'Partly Admitted', checkedInSpots: 1, checkedInAt: null };
  const capabilities = { readOnly: false, canShareReferral: true, canInviteGuestlist: true, canReviewGuestlist: true };
  const detail = { event: { id: 'event-fixture', title: 'Fixture Night', status: 'published', endsAt: '2099-10-01T23:00:00Z' }, scope: 'event', capabilities };
  const props = { session: { accessToken: 'fixture-token', user: { id: 'operator-fixture' } }, detail, onChanged: () => { changes.push('change'); }, onUnauthorized: (error) => accessLoss.push(error) };
  let React, screen, waitFor, user, render, act, MyEventActions;
  function baseHandler(call, items = []) {
    const path = call.url.pathname;
    if (path.endsWith('/guestlist-page')) return respond({ items, total: items.length, page: Number(call.url.searchParams.get('page')), pageSize: 10, hasMore: false });
    if (path.endsWith('/guestlist-invite-pools')) return respond({ direct: true, own: [{ id: 'own-fixture', guestlistAllocation: 12 }], open: true });
    if (path.endsWith('/referral-link')) return respond({ eventId: detail.event.id, code: 'my-referral-code', referrerName: 'Operator' });
    if (path.endsWith('/invitation-link')) return respond({ token: 'detail-private-secret' });
    const entry = [pending, approved, partlyAdmitted].find((row) => path.endsWith(`/guestlist-page/${row.id}`));
    if (entry) return respond(entry);
    if (path.endsWith('/decision')) return respond({ entry: { id: path.split('/').at(-2) } });
    throw new Error(`Unhandled fixture path: ${path}`);
  }
  async function mount(overrides = {}) {
    reset();
    calls.length = 0; changes.length = 0; accessLoss.length = 0; copiedLinks.length = 0;
    view = render(React.createElement(MyEventActions, { ...props, ...overrides }), { container: dom.window.document.getElementById('root') });
    await waitFor(() => assert.ok(calls.some((call) => call.url.pathname.endsWith('/guestlist-page'))));
    await waitFor(() => assert.equal(view.container.querySelector('.my-event-guestlist-body').getAttribute('aria-busy'), 'false'));
  }
  function reset() { view?.unmount(); view = null; dom.window.document.body.innerHTML = '<div id="root"></div>'; }
  try {
    vite = await createTestServer({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
    ({ MyEventActions } = await vite.ssrLoadModule('/src/components/my-event-actions.jsx'));
    React = await import('react');
    ({ render, screen, waitFor, act } = await import('@testing-library/react'));
    user = (await import('@testing-library/user-event')).default.setup({ document: dom.window.document });
    Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: async (link) => copiedLinks.push(link) } });

    await t.test('personal four-spot invite creates once, blocks busy dismissal, refreshes and copies only the private root link', async () => {
      let release, clipboardFailure = true;
      Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: async (link) => { if (clipboardFailure) throw new Error('Denied'); copiedLinks.push(link); } } });
      handler = async (call) => call.url.pathname.endsWith('/guestlist-invitations') ? new Promise((resolve) => { release = () => resolve(respond({ token: 'new-private-secret', invitation: { name: call.body.name, partySize: call.body.partySize }, entryId: 'new-fixture' }, 201)); }) : baseHandler(call);
      await mount();
      const invite = screen.getByRole('button', { name: 'Invite a guest' });
      await user.click(invite);
      await waitFor(() => assert.equal(screen.getByLabelText('Guest name').disabled, false));
      assert.ok(dom.window.document.activeElement === screen.getByLabelText('Guest name'));
      await user.type(screen.getByLabelText('Guest name'), 'Alex Four');
      await user.clear(screen.getByLabelText('Spots')); await user.type(screen.getByLabelText('Spots'), '4');
      await user.click(screen.getByRole('button', { name: 'Create invitation' }));
      await waitFor(() => assert.ok(release));
      assert.equal(screen.getByRole('button', { name: 'Checking space…' }).disabled, true);
      assert.equal(screen.getByRole('button', { name: 'Close invitation' }).disabled, true);
      await user.keyboard('{Escape}');
      assert.ok(screen.getByRole('dialog'));
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
      assert.deepEqual(calls.find((call) => call.method === 'POST').body, { pool: 'direct', name: 'Alex Four', partySize: 4, inviteBy: 'personal' });
      await act(async () => release());
      await screen.findByRole('heading', { name: 'Your guest is on the list' });
      await waitFor(() => assert.equal(changes.length, 1));
      assert.match(screen.getByRole('dialog').textContent, /4 separate single-use passes/);
      assert.doesNotMatch(dom.window.document.body.textContent, /new-private-secret|guestlistInvite=/);
      await user.click(screen.getByRole('button', { name: 'Copy invitation link', exact: true }));
      await screen.findByRole('alert');
      assert.equal(screen.getByRole('textbox', { name: 'Copy link manually' }).value, 'https://customer.test/?guestlistInvite=new-private-secret');
      assert.equal(screen.getByRole('textbox', { name: 'Copy link manually' }).readOnly, true);
      clipboardFailure = false;
      await user.click(screen.getByRole('button', { name: 'Retry copying invitation link' }));
      await waitFor(() => assert.equal(copiedLinks.length, 1));
      assert.equal(screen.queryByRole('textbox', { name: 'Copy link manually' }), null);
      assert.equal(copiedLinks[0], 'https://customer.test/?guestlistInvite=new-private-secret');
      assert.ok(calls.filter((call) => call.url.pathname.endsWith('/guestlist-page')).length >= 2);
      await user.click(screen.getByRole('button', { name: 'Done' }));
      await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
      assert.ok(dom.window.document.activeElement === invite);
      reset();
    });

    await t.test('Invite by stays locked to Personal and preserves own allocation on a retry', async () => {
      let rejectFirst = true;
      handler = (call) => {
        if (call.url.pathname.endsWith('/guestlist-invite-pools')) return respond({ direct: false, own: [{ id: 'own-fixture', guestlistAllocation: 12 }], open: true });
        if (call.url.pathname.endsWith('/guestlist-invitations')) return rejectFirst ? respond({ message: 'There is not enough space. Try fewer spots.', code: 'GUESTLIST_FULL' }, 409) : respond({ token: 'contact-private-secret', invitation: { name: call.body.name, partySize: call.body.partySize }, entryId: 'contact-fixture' }, 201);
        return baseHandler(call);
      };
      await mount({ detail: { ...detail, scope: 'own' } });
      await user.click(screen.getByRole('button', { name: 'Invite a guest' }));
      await waitFor(() => assert.equal(screen.getByLabelText('Guest name').matches(':disabled'), false));
      assert.equal(screen.queryByLabelText('Guestlist pool'), null);
      await user.type(screen.getByLabelText('Guest name'), 'Contact Guest');
      assert.equal(screen.getByLabelText('Invite by').disabled, true);
      assert.equal(screen.getByLabelText('Invite by').value, 'personal');
      await user.selectOptions(screen.getByLabelText('Invite by'), 'email');
      assert.equal(screen.getByLabelText('Invite by').value, 'personal');
      assert.equal(screen.queryByLabelText('Email address'), null);
      assert.equal(screen.queryByLabelText('Phone number'), null);
      await user.click(screen.getByRole('button', { name: 'Create invitation' }));
      await screen.findByRole('alert');
      assert.deepEqual(calls.filter((call) => call.method === 'POST')[0].body, { pool: 'own', eventAffiliateId: 'own-fixture', name: 'Contact Guest', inviteBy: 'personal', partySize: 1 });
      rejectFirst = false;
      await user.click(screen.getByRole('button', { name: 'Retry invitation' }));
      await screen.findByRole('heading', { name: 'Your guest is on the list' });
      assert.deepEqual(calls.filter((call) => call.method === 'POST')[1].body, { pool: 'own', eventAffiliateId: 'own-fixture', name: 'Contact Guest', inviteBy: 'personal', partySize: 1 });
      assert.equal(changes.length, 1);
      reset();
    });

    await t.test('search waits for submit, status choices are repeated and pagination remains bounded', async () => {
      handler = (call) => call.url.pathname.endsWith('/guestlist-page') ? respond({ items: [approved], total: 21, page: Number(call.url.searchParams.get('page')), pageSize: 10, hasMore: Number(call.url.searchParams.get('page')) < 3 }) : baseHandler(call);
      await mount();
      const initial = calls.length;
      await user.type(screen.getByLabelText('Search guestlist'), 'Alex');
      assert.equal(calls.length, initial);
      await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
      await waitFor(() => assert.equal(calls.at(-1).url.searchParams.get('search'), 'Alex'));
      await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Next' }).disabled, false));
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => assert.equal(calls.at(-1).url.searchParams.get('page'), '2'));
      await user.click(screen.getByText('Request status', { selector: 'summary' }));
      await user.click(screen.getByRole('checkbox', { name: 'Pending' }));
      await user.click(screen.getByRole('checkbox', { name: 'Approved' }));
      await waitFor(() => assert.deepEqual(calls.at(-1).url.searchParams.getAll('statuses'), ['pending', 'confirmed']));
      assert.equal(calls.at(-1).url.searchParams.get('page'), '1');
      assert.ok(calls.filter((call) => call.url.pathname.endsWith('/guestlist-page')).every((call) => call.url.searchParams.get('pageSize') === '10'));
      reset();
    });

    await t.test('details refresh the row, copy privately, confirm revocation, and prohibit partial-admission revocation', async () => {
      handler = (call) => baseHandler(call, [approved, partlyAdmitted]);
      await mount();
      assert.equal(screen.queryByRole('button', { name: 'Copy invitation link', exact: true }), null);
      const trigger = screen.getByRole('button', { name: 'Details for Approved Guest' });
      await user.click(trigger);
      await screen.findByRole('button', { name: 'Revoke approval' });
      assert.ok(calls.some((call) => call.url.pathname.endsWith('/guestlist-page/approved-fixture')));
      await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Copy invitation link', exact: true }).disabled, false));
      const beforeCopy = calls.length;
      await user.click(screen.getByRole('button', { name: 'Copy invitation link', exact: true }));
      await waitFor(() => assert.equal(copiedLinks.at(-1), 'https://customer.test/?guestlistInvite=detail-private-secret'));
      assert.equal(calls.length, beforeCopy, 'copy uses the prefetched token, not a click-time request');
      await user.click(screen.getByRole('button', { name: 'Revoke approval' }));
      await screen.findByRole('heading', { name: 'Revoke this approval?' });
      assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
      await user.click(screen.getByRole('button', { name: 'Keep approval' }));
      await waitFor(() => assert.ok(dom.window.document.activeElement === screen.getByRole('button', { name: 'Revoke approval' })));
      await user.click(screen.getByRole('button', { name: 'Revoke approval' }));
      await user.click(screen.getByRole('button', { name: 'Confirm revocation' }));
      await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
      assert.deepEqual(calls.find((call) => call.method === 'POST').body, { decision: 'cancel' });
      assert.equal(changes.length, 1);
      await waitFor(() => assert.ok(dom.window.document.activeElement === trigger));
      await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Details for Partly Admitted' }).disabled, false));
      await user.click(screen.getByRole('button', { name: 'Details for Partly Admitted' }));
      await waitFor(() => assert.match(screen.getByRole('dialog').textContent, /cannot be revoked/));
      assert.equal(screen.queryByRole('button', { name: 'Revoke approval' }), null);
      reset();
    });

    await t.test('pending approval and denial honor confirmation and errors stay retryable', async () => {
      let failure = true;
      handler = (call) => call.url.pathname.endsWith('/decision') && failure ? respond({ message: 'Not enough space. Reduce the request or check available capacity.', code: 'GUESTLIST_FULL' }, 409) : baseHandler(call, [pending]);
      await mount();
      await user.click(screen.getByRole('button', { name: 'Details for Pending Guest' }));
      await screen.findByRole('button', { name: 'Approve request' });
      assert.match(screen.getByRole('dialog').textContent, /No contact details on file/);
      await user.click(screen.getByRole('button', { name: 'Increase approved spots' }));
      await user.click(screen.getByRole('button', { name: 'Approve request' }));
      await screen.findByRole('alert');
      assert.deepEqual(calls.find((call) => call.method === 'POST').body, { decision: 'approve', partySize: 3 });
      assert.equal(screen.getByRole('spinbutton', { name: 'Approved spots' }).getAttribute('aria-valuenow'), '3');
      assert.equal(changes.length, 0);
      failure = false;
      await user.click(screen.getByRole('button', { name: 'Deny request' }));
      await screen.findByRole('heading', { name: 'Deny this request?' });
      assert.equal(screen.getByRole('button', { name: 'Increase approved spots' }).disabled, true);
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
      await user.click(screen.getByRole('button', { name: 'Confirm denial' }));
      await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
      assert.deepEqual(calls.filter((call) => call.method === 'POST').at(-1).body, { decision: 'reject' });
      assert.equal(changes.length, 1);
      reset();
    });

    await t.test('own scope, ended events and authorization loss do not expose unauthorized actions', async () => {
      handler = (call) => baseHandler(call, [pending]);
      const ended = { ...detail, scope: 'own', event: { ...detail.event, endsAt: '2000-01-01T00:00:00Z' } };
      await mount({ detail: ended });
      assert.ok(screen.getByRole('heading', { name: 'Your guestlist' }));
      assert.equal(screen.queryByRole('button', { name: 'Invite a guest' }), null);
      assert.equal(screen.getByRole('button', { name: 'Copy my referral link' }).disabled, true);
      assert.equal(calls.filter(call => call.url.pathname.endsWith('/referral-link')).length, 0);
      await user.click(screen.getByRole('button', { name: 'Details for Pending Guest' }));
      await waitFor(() => assert.match(screen.getByRole('dialog').textContent, /This event is read-only/));
      assert.equal(screen.queryByRole('button', { name: 'Approve request' }), null);
      reset();
      handler = (call) => call.url.pathname.endsWith('/guestlist-page/pending-fixture') ? respond({ message: 'This request no longer exists.', code: 'NOT_FOUND' }, 404) : baseHandler(call, [pending]);
      await mount();
      await user.click(screen.getByRole('button', { name: 'Details for Pending Guest' }));
      await screen.findByRole('button', { name: 'Retry guest details' });
      assert.equal(accessLoss.length, 0);
      reset();
      handler = () => respond({ message: 'Business access is required.', code: 'BUSINESS_ACCESS_REQUIRED' }, 403);
      await mount();
      await waitFor(() => assert.ok(accessLoss.length >= 1));
      assert.equal(accessLoss[0].status, 403);
      reset();
    });

    await t.test('an ambiguous invitation response requires checking the list before another create', async () => {
      handler = (call) => call.url.pathname.endsWith('/guestlist-invitations') ? Promise.reject(new Error('connection lost')) : baseHandler(call);
      await mount();
      await user.click(screen.getByRole('button', { name: 'Invite a guest' }));
      await waitFor(() => assert.equal(screen.getByLabelText('Guest name').disabled, false));
      await user.type(screen.getByLabelText('Guest name'), 'Uncertain Guest');
      await user.click(screen.getByRole('button', { name: 'Create invitation' }));
      await screen.findByRole('button', { name: 'Check guestlist' });
      assert.match(screen.getByRole('alert').textContent, /could not confirm whether this invitation was created/);
      assert.equal(screen.queryByRole('button', { name: 'Retry invitation' }), null);
      assert.equal(screen.getByLabelText('Guest name').matches(':disabled'), true);
      await user.click(screen.getByRole('button', { name: 'Check guestlist' }));
      await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
      await waitFor(() => assert.equal(changes.length, 1));
      reset();
    });

    await t.test('own referral copying uses its own returned code and strips operator routing', async () => {
      handler = (call) => baseHandler(call);
      await mount({ detail: { ...detail, scope: 'own' } });
      await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Copy my referral link' }).disabled, false));
      const beforeCopy = calls.length;
      await user.click(screen.getByRole('button', { name: 'Copy my referral link' }));
      await waitFor(() => assert.equal(copiedLinks.at(-1), 'https://customer.test/?event=event-fixture&ref=my-referral-code'));
      assert.doesNotMatch(dom.window.document.body.textContent, /my-referral-code|https:\/\//);
      assert.equal(calls.find((call) => call.url.pathname.endsWith('/referral-link')).headers.Authorization, 'Bearer fixture-token');
      assert.equal(calls.length, beforeCopy);
      reset();
    });

    await t.test('slow referral prefetch disables Copy and repeated copies make no network requests', async () => {
      let release;
      handler = call => call.url.pathname.endsWith('/referral-link') ? new Promise(resolve => { release = () => resolve(respond({ eventId: detail.event.id, code: 'prefetched-code' })); }) : baseHandler(call);
      await mount();
      const preparing = screen.getByRole('button', { name: 'Preparing referral link…' });
      assert.equal(preparing.disabled, true);
      const beforeLoad = calls.length;
      await user.click(preparing);
      assert.equal(calls.length, beforeLoad);
      assert.equal(copiedLinks.length, 0);
      await act(async () => release());
      await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Copy my referral link' }).disabled, false));
      const beforeCopy = calls.length;
      await user.click(screen.getByRole('button', { name: 'Copy my referral link' }));
      await user.click(screen.getByRole('button', { name: 'Referral link copied' }));
      assert.deepEqual(copiedLinks, ['https://customer.test/?event=event-fixture&ref=prefetched-code', 'https://customer.test/?event=event-fixture&ref=prefetched-code']);
      assert.equal(calls.length, beforeCopy);
      reset();
    });

    await t.test('invitation prefetch is scoped to the open guest and cannot copy a late response after closing', async () => {
      let release, invitationCall;
      handler = call => call.url.pathname.endsWith('/invitation-link') ? new Promise(resolve => { invitationCall = call; release = () => resolve(respond({ token: 'late-private-token' })); }) : baseHandler(call, [approved]);
      await mount();
      await user.click(screen.getByRole('button', { name: 'Details for Approved Guest' }));
      await waitFor(() => assert.ok(release));
      assert.equal(screen.getByRole('button', { name: 'Preparing invitation link…' }).disabled, true);
      assert.equal(copiedLinks.length, 0);
      await user.click(screen.getByRole('button', { name: 'Close guest details', exact: true }));
      assert.equal(invitationCall.signal.aborted, true);
      await act(async () => release());
      assert.equal(screen.queryByRole('dialog'), null);
      assert.equal(copiedLinks.length, 0);
      assert.doesNotMatch(dom.window.document.body.textContent, /late-private-token/);
      reset();
    });

    await t.test('failed link preparation has a separate load retry before Copy becomes available', async () => {
      let failed = true;
      handler = call => call.url.pathname.endsWith('/referral-link') && failed ? respond({ message: 'Please retry loading the link.' }, 503) : baseHandler(call);
      await mount();
      await screen.findByRole('button', { name: 'Retry loading referral link' });
      assert.equal(screen.queryByRole('button', { name: 'Copy my referral link' }), null);
      assert.equal(copiedLinks.length, 0);
      failed = false;
      await user.click(screen.getByRole('button', { name: 'Retry loading referral link' }));
      await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Copy my referral link' }).disabled, false));
      const beforeCopy = calls.length;
      await user.click(screen.getByRole('button', { name: 'Copy my referral link' }));
      assert.equal(calls.length, beforeCopy);
      reset();
    });
  } finally {
    view?.unmount();
    if (vite) await vite.close();
    globalThis.fetch = oldFetch;
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  }
});
