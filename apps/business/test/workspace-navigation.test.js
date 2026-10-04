import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readWorkspaceLocation, writeWorkspaceLocation } from '../src/lib/workspace-navigation.js';
import { resolveOrganizationScope, readOrganizationPreference, organizationPreferenceKey } from '../src/lib/organization-scope.js';

async function withLocation(path, run) {
  const dom = new JSDOM('', { url: `http://localhost${path}` });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  try { await run(dom.window); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
    dom.window.close();
  }
}

test('section navigation drops unrelated filters, defaults, and selected records', async () => {
  await withLocation('/app?section=analytics&event=old-event&eventView=upcoming&teamSearch=Zoe&reportTable=venues&reportSort=orders_desc&reportPage=1&reportTeamPage=1', (window) => {
    const initial = readWorkspaceLocation();
    assert.equal(initial.section, 'analytics');
    assert.equal(initial.eventId, null);
    assert.equal(initial.teamSearch, '');
    writeWorkspaceLocation({ reportSort: 'orders_desc' }, { replace: true });
    assert.equal(window.location.search, '?section=analytics&reportTable=venues&reportSort=orders_desc');
    for (const section of ['events', 'admissions', 'team', 'payments', 'overview']) {
      writeWorkspaceLocation({ section });
      assert.equal(window.location.search, section === 'overview' ? '' : `?section=${section}`);
      assert.equal(readWorkspaceLocation().section, section);
    }
  });
});

test('payments deep links preserve finance selection and onboarding return only within Payments', async () => {
  const organizationA = '00000000-0000-4000-8000-000000000601';
  const organizationB = '00000000-0000-4000-8000-000000000602';
  const account = '00000000-0000-4000-8000-000000000603';
  await withLocation(`/app?section=payments&paymentOrganization=${organizationA}&paymentAccountReturn=${account}&teamOrganizationId=stale&event=stale`, (window) => {
    const initial = readWorkspaceLocation();
    assert.equal(initial.section, 'payments');
    assert.equal(initial.paymentOrganization, organizationA);
    assert.equal(initial.eventId, null);
    assert.equal(initial.teamOrganizationId, '');
    writeWorkspaceLocation({ paymentOrganization: organizationB }, { replace: true });
    assert.equal(window.location.search, `?section=payments&paymentAccountReturn=${account}&paymentOrganization=${organizationB}`);
    writeWorkspaceLocation({ section: 'team' });
    assert.equal(window.location.search, '?section=team');
    assert.equal(readWorkspaceLocation().paymentOrganization, '');
    writeWorkspaceLocation({ paymentOrganization: 'stale', paymentAccountReturn: 'stale' }, { replace: true });
    assert.equal(window.location.search, '?section=team');
  });
});

test('Back restores the selected payments business after section navigation', async () => {
  const organizationA = '00000000-0000-4000-8000-000000000601';
  const organizationB = '00000000-0000-4000-8000-000000000602';
  await withLocation(`/app?section=payments&paymentOrganization=${organizationA}`, async (window) => {
    writeWorkspaceLocation({ paymentOrganization: organizationB });
    writeWorkspaceLocation({ section: 'events' });
    await new Promise((resolve) => {
      window.addEventListener('popstate', resolve, { once: true });
      window.history.back();
    });
    assert.equal(readWorkspaceLocation().section, 'payments');
    assert.equal(readWorkspaceLocation().paymentOrganization, organizationB);
  });
});

test('legacy Stripe return links migrate from Team to Payments', async () => {
  const organization = '00000000-0000-4000-8000-000000000601';
  const account = '00000000-0000-4000-8000-000000000603';
  await withLocation(`/app?section=team&teamOrganizationId=${organization}&paymentOrganization=${organization}&paymentAccountReturn=${account}`, window => {
    assert.equal(readWorkspaceLocation().section, 'payments');
    assert.equal(readWorkspaceLocation().paymentOrganization, organization);
    writeWorkspaceLocation({}, { replace: true });
    assert.equal(window.location.search, `?section=payments&paymentOrganization=${organization}&paymentAccountReturn=${account}`);
  });
});

test('event deep links retain only their list context and detail parameters', async () => {
  await withLocation('/app?event=event-a&eventSearch=Rew1nd&eventPage=2&reportEvent=stale&reportTable=customers&teamPage=4', (window) => {
    assert.equal(readWorkspaceLocation().section, 'events', 'legacy event links still select Events');
    writeWorkspaceLocation({ tab: 'guestlist' });
    assert.equal(window.location.search, '?section=events&event=event-a&eventSearch=Rew1nd&eventPage=2&tab=guestlist');
    writeWorkspaceLocation({ event: null, tab: null });
    assert.equal(window.location.search, '?section=events&eventSearch=Rew1nd&eventPage=2');
    writeWorkspaceLocation({ section: 'analytics' });
    assert.equal(window.location.search, '?section=analytics');
  });
});

test('venue management state belongs only to Team and clears on section navigation', async () => {
  await withLocation('/app?section=team&teamOrganizationId=org-a', (window) => {
    writeWorkspaceLocation({ managedVenueBusinessId: 'org-a', managedVenueId: 'venue-a', managedVenueTab: 'team', venueSearch: 'North', venuesPage: 2, venueTeamPage: 3 });
    assert.equal(new URLSearchParams(window.location.search).get('managedVenueId'), 'venue-a');
    assert.equal(new URLSearchParams(window.location.search).get('venuesPage'), '2');
    writeWorkspaceLocation({ section: 'analytics' });
    assert.equal(window.location.search, '?section=analytics');
    writeWorkspaceLocation({ venueSearch: 'stale', managedVenueId: 'stale' }, { replace: true });
    assert.equal(window.location.search, '?section=analytics');
  });
});

test('Back and Forward restore each section’s own state and no-op writes add no history', async () => {
  await withLocation('/app?section=analytics&reportSearch=Rew1nd&reportTable=events', async (window) => {
    writeWorkspaceLocation({ section: 'events' });
    writeWorkspaceLocation({ eventSearch: 'Friday', eventPage: 2 });
    const historyLength = window.history.length;
    writeWorkspaceLocation({ eventSearch: 'Friday', eventPage: 2 });
    assert.equal(window.history.length, historyLength);
    const traverse = (direction) => new Promise((resolve) => {
      window.addEventListener('popstate', resolve, { once: true });
      window.history[direction]();
    });
    await traverse('back');
    assert.equal(window.location.search, '?section=events');
    await traverse('back');
    assert.equal(readWorkspaceLocation().reportSearch, 'Rew1nd');
    assert.equal(readWorkspaceLocation().eventSearch, '');
    await traverse('forward');
    await traverse('forward');
    assert.equal(readWorkspaceLocation().eventSearch, 'Friday');
    assert.equal(readWorkspaceLocation().eventPage, 2);
    assert.equal(readWorkspaceLocation().reportSearch, '');
  });
});

test('fresh Events navigation clears stale Events scroll while preserving other history metadata', async () => {
  await withLocation('/app?section=analytics&reportSearch=Rew1nd', (window) => {
    window.history.replaceState({ eventsScrollY: 864, analyticsScrollY: 127, marker: 'kept' }, '', window.location.href);
    writeWorkspaceLocation({ section: 'events' });

    assert.equal(window.location.search, '?section=events');
    assert.equal(window.history.state.eventsScrollY, undefined);
    assert.equal(window.history.state.analyticsScrollY, 127);
    assert.equal(window.history.state.marker, 'kept');
  });
});

test('leaving Events clears the destination scroll state and Back retains the Events list offset', async () => {
  await withLocation('/app?section=events&eventSearch=Friday&eventPage=2', async (window) => {
    window.history.replaceState({ eventsScrollY: 438, marker: 'kept' }, '', window.location.href);
    writeWorkspaceLocation({ section: 'analytics' });

    assert.equal(window.history.state.eventsScrollY, undefined);
    assert.equal(window.history.state.marker, 'kept');
    await new Promise((resolve) => {
      window.addEventListener('popstate', resolve, { once: true });
      window.history.back();
    });
    assert.equal(window.location.search, '?section=events&eventSearch=Friday&eventPage=2');
    assert.equal(window.history.state.eventsScrollY, 438);
    assert.equal(window.history.state.marker, 'kept');
  });
});

test('partial Events list and detail writes preserve Events scroll and unrelated history metadata', async () => {
  await withLocation('/app?section=events&eventSearch=Friday&eventPage=2', (window) => {
    window.history.replaceState({ eventsScrollY: 512, marker: 'kept' }, '', window.location.href);
    writeWorkspaceLocation({ eventSort: 'title_desc' });
    assert.equal(window.history.state.eventsScrollY, 512);
    assert.equal(window.history.state.marker, 'kept');

    writeWorkspaceLocation({ event: 'event-a', tab: 'tickets' });
    assert.equal(window.history.state.eventsScrollY, 512);
    assert.equal(window.history.state.marker, 'kept');
    assert.equal(window.location.search, '?section=events&eventSearch=Friday&eventPage=2&eventSort=title_desc&event=event-a&tab=tickets');

    writeWorkspaceLocation({ tab: 'people' });
    assert.equal(window.history.state.eventsScrollY, 512);
    assert.equal(window.history.state.marker, 'kept');
  });
});

test('same-URL explicit Events navigation cleans stale scroll without adding history', async () => {
  await withLocation('/app?section=events', (window) => {
    window.history.replaceState({ eventsScrollY: 999, marker: 'kept' }, '', window.location.href);
    const historyLength = window.history.length;
    const stateBefore = window.history.state;

    writeWorkspaceLocation({ section: 'events' });

    assert.equal(window.location.search, '?section=events');
    assert.equal(window.history.length, historyLength);
    assert.notEqual(window.history.state, stateBefore);
    assert.equal(window.history.state.eventsScrollY, undefined);
    assert.equal(window.history.state.marker, 'kept');
  });
});

test('one persisted organization survives section navigation; owner aggregates never include manager or promoter memberships', async () => {
  const owner = '00000000-0000-4000-8000-000000000611';
  const manager = '00000000-0000-4000-8000-000000000612';
  const promoter = '00000000-0000-4000-8000-000000000613';
  const data = { organizations: [{ id: owner, isOwner: true }, { id: manager, isOwner: false, canManageFinance: true }, { id: promoter }], scope: {} };
  await withLocation('/app', window => {
    writeWorkspaceLocation({ workspaceOrganization: manager });
    for (const section of ['analytics', 'events', 'admissions', 'payments', 'team', 'overview']) {
      writeWorkspaceLocation({ section });
      assert.equal(readWorkspaceLocation().workspaceOrganization, manager);
      assert.deepEqual(resolveOrganizationScope(data, section, manager, owner).organizationIds, [manager]);
    }
    for (const section of ['overview', 'analytics']) {
      const aggregate = resolveOrganizationScope(data, section, 'owned', promoter);
      assert.equal(aggregate.ownedOnly, true);
      assert.deepEqual(aggregate.organizations.map(org => org.id), [owner]);
      assert.deepEqual(aggregate.organizationIds, [], 'server resolves current ownership, not a stale cached list');
    }
    for (const section of ['events', 'admissions', 'payments', 'team']) {
      assert.equal(resolveOrganizationScope(data, section, 'owned', promoter).selection, promoter);
    }
    const demoted = { ...data, organizations: data.organizations.map(org => ({ ...org, isOwner: false })) };
    assert.equal(resolveOrganizationScope(demoted, 'overview', 'owned', promoter).ownedOnly, false);
    assert.equal(resolveOrganizationScope({ organizations: data.organizations.slice(1), scope: { canViewOwnedOrganizations: true } }, 'analytics', 'owned', manager).ownedOnly, true, 'bounded selector options cannot truncate the owner portfolio');
    assert.equal(resolveOrganizationScope({ ...data, scope: { canViewOwnedOrganizations: false } }, 'analytics', 'owned', manager).ownedOnly, false, 'current server ownership overrides a cached role');
    assert.equal(resolveOrganizationScope({ organizations: [], scope: { canViewIndependent: true } }, 'events', '', '').selection, 'independent', 'assigned independent events remain available without creation permission');
    assert.equal(resolveOrganizationScope(data, 'events', 'revoked', manager).selection, manager);
    const preference = { selection: manager, lastOrganization: manager };
    window.localStorage.setItem(organizationPreferenceKey('user-a'), JSON.stringify(preference));
    assert.deepEqual(readOrganizationPreference('user-a', window.localStorage), preference);
    assert.deepEqual(readOrganizationPreference('user-b', window.localStorage), { selection: '', lastOrganization: '' });
    window.localStorage.setItem(organizationPreferenceKey('user-a'), '{bad');
    assert.deepEqual(readOrganizationPreference('user-a', window.localStorage), { selection: '', lastOrganization: '' });
  });
});
