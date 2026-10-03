const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const managedUrl = 'postgres://test:test@127.0.0.1/nitewide_test_e2e_mock';
const config = { DATABASE_URL: managedUrl, QR_TOKEN_SECRET: 'synthetic-qr-signing-secret' };
const modelNames = ['User', 'UserCredential', 'Location', 'Organization', 'OrganizationVenue', 'OrganizationOwner',
  'OrganizationEmployee', 'OrgAffiliate', 'Event', 'Offering', 'EventAffiliate', 'Order', 'OrderItem', 'Ticket', 'GuestlistEntry', 'Notification', 'Payment'];

function harness({ databaseUrl = managedUrl, databaseName = 'nitewide_test_e2e_mock' } = {}) {
  const rows = Object.fromEntries(modelNames.map(name => [name, []]));
  let resets = 0, guards = 0;
  const sequelize = {
    getDatabaseName: () => databaseName,
    getQueryInterface: () => ({ queryGenerator: { quoteTable: name => `"${name}"` } }),
    query: async sql => {
      assert.match(sql, /^TRUNCATE .* RESTART IDENTITY CASCADE$/);
      resets++;
      for (const values of Object.values(rows)) values.length = 0;
    },
    transaction: async operation => operation({ id: 'mock-transaction' }),
  };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const models = Object.fromEntries(modelNames.map(name => [name, {
    sequelize,
    getTableName: () => name,
    create: async values => { const row = { id: `mock-${name}-${rows[name].length}`, ...values }; rows[name].push(row); return row; },
    bulkCreate: async values => { rows[name].push(...values); return values; },
    findOne: async ({ where }) => rows[name].find(row => matches(row, where)),
    findByPk: async id => rows[name].find(row => row.id === id),
    findOrCreate: async ({ where }) => { const row = { ...where }; rows[name].push(row); return [row, true]; },
    update: async (values, { where }) => { for (const row of rows[name].filter(row => matches(row, where))) Object.assign(row, values); },
  }]));
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../../../e2e/seed.cjs'), 'utf8');
  const mockedRequire = name => {
    if (name.endsWith('/services/auth-service')) return { createPasswordRecord: async () => ({ passwordHash: 'synthetic-password-record' }) };
    if (name.endsWith('/scripts/test-database.cjs')) return { assertManagedTestDatabase: () => { guards++; return databaseUrl; } };
    if (name.endsWith('/domain/wallet-qr')) return {
      walletToken: ticket => { assert.ok(ticket?.qrTokenHash); return `mock-ticket:${ticket.eventId}:${ticket.id}`; },
      guestlistWalletToken: entry => { assert.ok(entry?.qrTokenHash); return `mock-guestlist:${entry.id}`; },
    };
    if (name === 'node:crypto') return require(name);
    throw new Error(`Unexpected browser seed dependency: ${name}`);
  };
  vm.runInNewContext(`(function(require, module, exports) { ${source}\n})`, { URL, Date })(mockedRequire, module, module.exports);
  return { ...module.exports, models, rows, resets: () => resets, guards: () => guards };
}

test('unconverted browser callers retain all legacy pagination, purchase and QR fixtures', async () => {
  const fixture = harness();
  const data = await fixture.seed(fixture.models, config);
  assert.equal(data.recipe, 'legacy');
  assert.equal(fixture.rows.User.length, 30);
  assert.equal(fixture.rows.UserCredential.length, 5);
  assert.equal(fixture.rows.OrganizationEmployee.length, 25);
  assert.equal(fixture.rows.Event.filter(event => event.status === 'published').length, 14);
  assert.equal(fixture.rows.Event.filter(event => event.status === 'draft').length, 1);
  assert.equal(fixture.rows.Order.length, 12);
  assert.equal(fixture.rows.Ticket.length, 12);
  assert.notEqual(data.ticketQr.split(':')[1], data.wrongEventQr.split(':')[1]);
  assert.equal(fixture.rows.GuestlistEntry.find(entry => entry.id === data.ids.entry).partySize, 3);
  assert.equal(fixture.rows.GuestlistEntry.find(entry => entry.id === data.ids.pending).partySize, 2);
});

test('auth and profile recipes create only their actors and the owner domain needed for Business access', async () => {
  for (const [recipe, roles, organizations] of [
    ['customer-auth', ['customer'], 0], ['admin-auth', ['admin'], 0],
    ['admin-access', ['customer', 'admin'], 0], ['business-auth', ['business'], 1],
  ]) {
    const fixture = harness();
    const data = await fixture.seed(fixture.models, config, { recipe });
    assert.deepEqual(Object.keys(data.accounts), roles);
    assert.equal(fixture.rows.User.length, roles.length);
    assert.equal(fixture.rows.UserCredential.length, roles.length);
    assert.equal(fixture.rows.Organization.length, organizations);
    assert.equal(fixture.rows.Event.length, 0);
    assert.equal(fixture.rows.Order.length, 0);
    assert.equal(fixture.rows.OrganizationEmployee.length, 0);
    assert.equal(data.ticketQr, undefined);
    assert.equal(data.guestlistQr, undefined);
  }
});

test('commerce retains a real purchase, a three-entry package, and confirmed and pending guestlist quantities', async () => {
  const fixture = harness();
  const data = await fixture.seed(fixture.models, config, { recipe: 'commerce' });
  assert.equal(fixture.rows.User.length, 4);
  assert.equal(fixture.rows.Event.filter(event => event.status === 'published').length, 1);
  assert.equal(fixture.rows.Order.length, 1);
  assert.equal(fixture.rows.Ticket.length, 1);
  assert.equal(fixture.rows.Offering.find(offering => offering.id === data.ids.package).entriesPerUnit, 3);
  assert.deepEqual(fixture.rows.GuestlistEntry.map(entry => [entry.status, entry.partySize]), [['confirmed', 3], ['pending', 2]]);
  assert.equal(fixture.rows.Notification.length, 2);
  assert.equal(data.wrongEventQr, undefined);
  assert.ok(data.ticketQr);
  assert.ok(data.guestlistQr);
});

test('explicit pagination, exports and admissions recipes preserve their larger edge-case datasets', async () => {
  for (const [recipe, published, orders, team] of [
    ['bookings-pagination', 14, 12, 0], ['reports-export', 14, 12, 0],
    ['events-pagination', 14, 1, 0], ['team-pagination', 1, 1, 25], ['admissions', 2, 2, 0],
  ]) {
    const fixture = harness();
    const data = await fixture.seed(fixture.models, config, { recipe });
    assert.equal(fixture.rows.Event.filter(event => event.status === 'published').length, published, recipe);
    assert.equal(fixture.rows.Order.length, orders, recipe);
    assert.equal(fixture.rows.Ticket.length, orders, recipe);
    assert.equal(fixture.rows.OrganizationEmployee.length, team, recipe);
    if (recipe === 'admissions') assert.notEqual(data.ticketQr.split(':')[1], data.wrongEventQr.split(':')[1]);
  }
});

test('every real-data recipe truncates previous state before seeding and retains managed database checks', async () => {
  const fixture = harness();
  await fixture.seed(fixture.models, config);
  fixture.rows.User.push({ id: 'previous-session-user' });
  fixture.rows.Notification.push({ title: 'Previous test notification' });
  await fixture.seed(fixture.models, config, { recipe: 'customer-auth' });
  assert.equal(fixture.resets(), 2);
  assert.equal(fixture.guards(), 2);
  assert.equal(fixture.rows.User.length, 1);
  assert.equal(fixture.rows.Notification.length, 0);
  assert.equal(fixture.rows.Order.length, 0);
  for (const changed of [
    { databaseName: 'development' }, { databaseUrl: 'postgres://test:test@127.0.0.1/development' },
  ]) {
    const unsafe = harness(changed);
    await assert.rejects(unsafe.seed(unsafe.models, config, { recipe: 'commerce' }), /outside the managed/);
    assert.equal(unsafe.resets(), 0);
  }
  await assert.rejects(fixture.seed(fixture.models, config, { recipe: 'unknown' }), /Unknown managed/);
  assert.equal(fixture.resets(), 2);
});

test('operator performance keeps immutable paid attribution and both payment totals without a second reset', async () => {
  const fixture = harness();
  let data = await fixture.seed(fixture.models, config, { recipe: 'operator' });
  const credited = fixture.rows.Order.find(order => order.id === data.ids.order);
  assert.equal(credited.affiliateCommissionCents, 125);
  assert.equal(credited.eventAffiliateId, data.ids.affiliate);
  assert.equal(fixture.rows.Order.length, 2);
  assert.equal(fixture.rows.Order.reduce((sum, order) => sum + order.subtotalCents, 0), 6500);
  assert.deepEqual(fixture.rows.Payment.map(payment => payment.amountCents), [2800, 4400]);
  data = await fixture.seedMyEventsScenario(fixture.models, config, data, { past: true });
  assert.equal(fixture.resets(), 1);
  assert.equal(fixture.rows.Order.length, 2);
  assert.equal(fixture.rows.Payment.length, 2);
  assert.equal(fixture.rows.Event.find(event => event.id === data.ids.event).status, 'completed');
  assert.equal(data.scenario.eventSalesCents, 6500);
  assert.equal(data.scenario.ownSalesCents, 2500);
  assert.equal(data.scenario.ownCommissionCents, 125);
  assert.equal(data.scenario.past, true);
});

test('legacy callers can still request the credited operator scenario after a normal clean fixture', async () => {
  const fixture = harness();
  const initial = await fixture.seed(fixture.models, config);
  await fixture.seedMyEventsScenario(fixture.models, config, initial);
  assert.equal(fixture.resets(), 2);
  assert.equal(fixture.rows.Order.length, 13);
  assert.equal(fixture.rows.Payment.length, 2);
  assert.equal(fixture.rows.Order.find(order => order.id === initial.ids.order).affiliateCommissionCents, 125);
});

function browserHarness() {
  let definitions;
  const measurements = [];
  const anyString = Symbol('any string');
  const expect = (value, message) => ({
    toBeTruthy: () => assert.ok(value, message),
    toBe: expected => assert.equal(value, expected, message),
    toEqual: expected => expected === anyString ? assert.equal(typeof value, 'string') : assert.deepEqual(value, expected),
    toBeAttached: async () => { assert.equal(value.role, 'button'); assert.equal(value.options.includeHidden, true); },
    toBeVisible: async () => assert.ok(value),
  });
  expect.any = () => anyString;
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../../../e2e/fixtures.cjs'), 'utf8');
  const urls = { api: 'http://127.0.0.1:6100', customer: 'http://127.0.0.1:6101', business: 'http://127.0.0.1:6102', admin: 'http://127.0.0.1:6103' };
  const mockedRequire = name => {
    if (name === '@playwright/test') return { expect, test: { extend: value => {
      definitions = value;
      return { info: () => ({ file: '/workspace/customer.spec.cjs', project: { name: 'customer-desktop' } }) };
    } } };
    if (name === './environment.cjs') return { urls, controlToken: 'synthetic-browser-control' };
    if (name === '../scripts/test-timing.cjs') return { createTimingCollector: scope => {
      assert.equal(scope, 'browser-fixtures');
      return { report: () => {}, measure: async (phase, operation, labels) => {
        let failed = true;
        try { const result = await operation(); failed = false; return result; }
        finally { measurements.push({ phase, labels, failed }); }
      } };
    } };
    if (name === 'node:path') return require(name);
    throw new Error(`Unexpected browser fixture dependency: ${name}`);
  };
  vm.runInNewContext(`(function(require, module, exports) { ${source}\n})`, { URL })(mockedRequire, module, module.exports);
  return { ...module.exports, definitions, measurements, urls };
}

test('browser real-data fixture requests a separate clean reset for each test with a legacy default', async () => {
  const browser = browserHarness();
  assert.equal(browser.definitions.fixtureRecipe[0], 'legacy');
  const calls = [], used = [];
  const request = { post: async (url, options) => {
    calls.push({ url, options });
    return { ok: () => true, status: () => 200, json: async () => ({ reset: calls.length }) };
  } };
  const testInfo = { file: '/workspace/customer.spec.cjs', project: { name: 'customer-desktop' } };
  for (let index = 0; index < 2; index++) await browser.definitions.fixture({ request, fixtureRecipe: 'commerce' }, async data => used.push(data.reset), testInfo);
  assert.deepEqual(used, [1, 2]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.data.recipe, 'commerce');
  assert.equal(browser.measurements.filter(item => item.phase === 'fixture-reset').length, 2);
});

function freshPage(browser, { accountId = 'customer-id', clientId = accountId, clientOk = true } = {}) {
  const page = { tokens: [], bootstraps: [], navigations: [], routes: new Map(),
    request: { post: async () => {
      const accessToken = `synthetic-fresh-token-${page.tokens.length + 1}`;
      page.tokens.push(accessToken);
      return { ok: () => true, status: () => 200, json: async () => ({ data: { accessToken, user: { id: accountId } } }) };
    } },
    route: async (url, handler) => page.routes.set(url, handler),
    unroute: async (url, handler) => { assert.equal(page.routes.get(url), handler); page.routes.delete(url); },
    goto: async url => page.navigations.push(url),
    evaluate: async (_operation, values) => page.bootstraps.push(values),
    addInitScript: () => { throw new Error('Fresh session bootstrap must not persist an init script.'); },
    getByRole: (role, options) => ({ role, options }),
    waitForResponse: async predicate => {
      const response = (pathname, token) => ({ url: () => `${browser.urls.api}${pathname}`,
        request: () => ({ headers: () => ({ authorization: `Bearer ${token}` }) }),
        ok: () => clientOk, json: async () => ({ data: { user: { id: clientId } } }) });
      const freshToken = page.tokens.at(-1);
      assert.equal(predicate(response('/api/auth/me', 'synthetic-stale-token')), false);
      assert.equal(predicate(response('/api/other', freshToken)), false);
      const verified = response('/api/auth/me', freshToken);
      assert.equal(predicate(verified), true);
      return verified;
    },
  };
  return page;
}

test('deep-linked customer login uses a fresh session and waits for its matching client verification on every call', async () => {
  const browser = browserHarness();
  const page = freshPage(browser);
  const data = { accounts: { customer: { id: 'customer-id', email: 'synthetic-customer@example.test', name: 'Synthetic Customer' } }, password: 'SyntheticPassword123' };
  const first = await browser.loginViaApi(page, data, 'customer', 'customer', '/?event=synthetic-event');
  const second = await browser.loginViaApi(page, data, 'customer', 'customer', '/?tab=booked');
  assert.notEqual(first.accessToken, second.accessToken);
  assert.equal(page.bootstraps.length, 2);
  assert.equal(page.bootstraps[0].storage, 'localStorage');
  assert.equal(page.bootstraps[0].key, 'nitewide.session');
  assert.equal(page.routes.size, 0);
  assert.equal(browser.measurements.filter(item => item.phase === 'fresh-auth').length, 2);
  assert.equal(browser.measurements.filter(item => item.phase === 'browser-readiness').length, 2);
  for (const item of browser.measurements) assert.doesNotMatch(JSON.stringify(item.labels), /@|token|password/);
});

test('customer browser readiness rejects unsuccessful or mismatched client session verification', async () => {
  for (const settings of [{ clientOk: false }, { clientId: 'wrong-customer-id' }]) {
    const browser = browserHarness();
    const page = freshPage(browser, settings);
    const data = { accounts: { customer: { id: 'customer-id', email: 'synthetic-customer@example.test', name: 'Synthetic Customer' } }, password: 'SyntheticPassword123' };
    await assert.rejects(browser.loginViaApi(page, data, 'customer', 'customer', '/?event=synthetic-event'));
    assert.equal(page.routes.size, 0);
    assert.equal(browser.measurements.find(item => item.phase === 'browser-readiness').failed, true);
  }
});
