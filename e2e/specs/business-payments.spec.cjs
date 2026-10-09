const { test: baseTest, expect, loginViaApi, businessSection, expectNoOverflow } = require('../fixtures.cjs');
const test = baseTest.extend({ fixtureRecipe: 'commerce' });
const authTest = baseTest.extend({ fixtureRecipe: 'business-auth' });
const { createStripeTestIdentity } = require('../test-data/stripe-connect/identity.cjs');

function merchantOverview(organizationId) {
  return { organizationId, period: 'all_time', mode: 'test', currencies: [{ currency: 'usd', collectedCents: 12500, refundedCents: 2500, netCollectedCents: 10000, paidOrders: 3, refundedOrders: 1, pendingOrders: 2, reviewOrders: 1 }], pendingOrders: 2, reviewOrders: 1, merchantBalance: null, payouts: null, stripeDashboardUrl: null };
}

function ownEarnings() {
  return { period: 'all_time', mode: 'test', scope: 'own', currencies: [{ currency: 'usd', verifiedEarnedCents: 1800, verifiedRefundedCents: 300, demoEarnedCents: 4200, demoRefundedCents: 200, verifiedPaidOrders: 3, verifiedRefundedOrders: 1, demoPaidOrders: 4, demoRefundedOrders: 1 }], receivedPayouts: null, dashboardConnected: null, dashboardUrl: null };
}

async function mockPaymentSummaries(page) {
  await page.route('**/api/business/organizations/*/payment-overview', route => {
    const organizationId = new URL(route.request().url()).pathname.split('/').at(-2);
    return route.fulfill({ json: { data: merchantOverview(organizationId) } });
  });
  await page.route('**/api/business/payments/earnings', route => route.fulfill({ json: { data: ownEarnings() } }));
  await page.route('**/api/account/commission-earnings**', route => route.fulfill({ json: { data: ownEarnings() } }));
}

async function enableFinanceFixture(page, { canViewEarnings = false } = {}) {
  await page.route('**/api/business/bootstrap',async route=>{
    const response=await route.fetch(),payload=await response.json();
    payload.data.organizations=payload.data.organizations.map(item=>({...item,canManageFinance:true}));
    if (canViewEarnings) payload.data.scope = { ...payload.data.scope, canViewEarnings: true };
    await route.fulfill({response,json:payload});
  });
  await mockPaymentSummaries(page);
}

test('shared sandbox payments journey protects merchant choices and explains unavailable event checkout',async({page,fixture})=>{
  await enableFinanceFixture(page);
  const sharedAccountId='acct_sharedbrowser';let reads=0,mutations=0;
  let paymentsReady = true;
  await page.route('**/api/business/organizations/*/payment-accounts**',route=>{
    if(route.request().method()!=='GET') mutations++;
    reads++;
    return route.fulfill({json:{data:{items:[{id:'00000000-0000-4000-8000-000000000520',name:'Original merchant profile',mode:'test',stripeAccountId:sharedAccountId,
      lifecycleState:'active',disconnectStatus:'none',paymentsReady:true,detailsSubmitted:true,chargesEnabled:true,payoutsEnabled:true}],
      total:1,page:1,pageSize:10,hasMore:false,canDisconnectPayments:true,defaultPaymentAccountId:null,
      sharedSandboxAccount:{stripeAccountId:sharedAccountId,paymentsReady}}}});
  });
  await page.route('**/api/business/events/*/summary',async route=>{
    const response=await route.fetch(),payload=await response.json();
    payload.data.event={...payload.data.event,canManageFinance:true,canChangePaymentAccount:true};
    await route.fulfill({response,json:payload});
  });
  await loginViaApi(page,fixture,'business','business',`/?section=payments&paymentOrganization=${fixture.ids.org}`);
  await test.step('The shared merchant is identified, refreshable and cannot mutate individual choices', async () => {
    const card=page.locator('.payment-accounts'),notice=card.locator('.shared-sandbox-notice');
    await expect(notice.getByText('Shared sandbox payments',{exact:true})).toBeVisible();
    await expect(notice).toContainText(sharedAccountId);await expect(notice).toContainText('Individual account choices are preserved');
    await expect(card.getByLabel('Default payment account')).toBeDisabled();
    await expect(card.getByRole('button',{name:'Disconnect Stripe',exact:true})).toHaveCount(0);
    await expect(card.getByRole('button',{name:'Disable new payments',exact:true})).toHaveCount(0);
    await expect(card.getByRole('button',{name:'Add payment account',exact:true})).toHaveCount(0);
    const before=reads,response=page.waitForResponse(value=>value.url().includes('/payment-accounts?')&&value.request().method()==='GET');
    await notice.getByRole('button',{name:'Refresh shared account'}).click();await response;
    await expect(notice.getByText('Stripe readiness verified.',{exact:true})).toBeVisible();
    expect(reads).toBeGreaterThan(before);expect(mutations).toBe(0);await expectNoOverflow(page);
  });
  await test.step('The same shared merchant routes event payments and hides ineffective selectors when readiness is lost', async () => {
    paymentsReady = false;
    await page.goto(`/?section=events&event=${fixture.ids.event}`);
    const payments=page.locator('.payment-accounts');
    await expect(payments.getByText('Shared sandbox payments',{exact:true})).toBeVisible();
    await expect(payments).toContainText('Paid checkout remains unavailable');
    await expect(payments.getByLabel('Event payment account')).toHaveCount(0);
    await expect(payments.getByRole('button',{name:'Save payment account'})).toHaveCount(0);
    expect(mutations).toBe(0);
    await expectNoOverflow(page);
  });
  await page.unrouteAll({behavior:'wait'});
});

authTest('merchant disconnect journey blocks unresolved obligations, disables safely and reconciles an uncertain retry',async({page,fixture},testInfo)=>{
  await enableFinanceFixture(page);
  let account={id:'00000000-0000-4000-8000-000000000510',name:'Disconnect merchant',mode:'test',stripeAccountId:'acct_offline',
    lifecycleState:'active',disconnectStatus:'none',paymentsReady:true,detailsSubmitted:true,chargesEnabled:true,payoutsEnabled:true};
  const mutations=[];
  let obligations = true, disables = 0, resumes = 0;
  await page.route('**/api/business/organizations/*/payment-accounts**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/disconnect-impact')) return route.fulfill({json:{data:{account,affectedEvents:obligations ? 1 : 2,pendingPayments:obligations ? 2 : 0,reviewPayments:0,
      unresolvedRefunds:obligations ? 1 : 0,unfulfilledPaidBookings:obligations ? 5 : 0,historicalBookings:30,
      blockedReasons:obligations ? ['Pending payments must finish or expire.','Pending or failed refunds must be resolved.'] : [],
      providerDisconnectConfigured:true,canDisconnect:!obligations && account.disconnectStatus !== 'disconnected'}}});
    if(path.endsWith('/disable')) {disables++;account={...account,paymentsReady:false,paymentsDisabledAt:new Date().toISOString()};return route.fulfill({json:{data:account}});}
    if(path.endsWith('/resume')) {
      resumes++;
      expect(route.request().postDataJSON().confirmed).toBe(true);
      account={...account,paymentsReady:true,paymentsDisabledAt:null,detailsSubmitted:true,chargesEnabled:true,payoutsEnabled:true};
      return route.fulfill({json:{data:account}});
    }
    if(path.endsWith('/disconnect')) {
      if (obligations) throw new Error('A blocked connection must not send a disconnect request');
      mutations.push(route.request().postDataJSON());
      account={...account,paymentsReady:false,paymentsDisabledAt:new Date().toISOString(),disconnectRequestId:mutations[0].idempotencyKey,
        disconnectStatus:mutations.length===1?'pending':'disconnected',disconnectErrorCode:mutations.length===1?'DISCONNECT_UNCONFIRMED':null,
        lifecycleState:mutations.length===1?'active':'archived'};
      return route.fulfill({json:{data:{account,retryable:mutations.length===1}}});
    }
    return route.fulfill({json:{data:{items:[account],total:1,page:1,pageSize:10,hasMore:false,canDisconnectPayments:true,defaultPaymentAccountId:account.id}}});
  });
  await loginViaApi(page,fixture,'business','business',`/?section=payments&paymentOrganization=${fixture.ids.org}`);
  const card=page.locator('.payment-accounts');
  await test.step('Unresolved payments and refunds block disconnection but allow a confirmed reversible disable', async () => {
    await card.getByRole('button',{name:'Disconnect Stripe',exact:true}).click();
    let dialog=page.getByRole('dialog');
    await expect(dialog.getByText('Resolve these before disconnecting')).toBeVisible();
    await dialog.getByLabel('Reason',{exact:true}).fill('Try disconnecting');await dialog.getByRole('checkbox').check();
    await expect(dialog.getByRole('button',{name:'Disconnect Stripe account'})).toBeDisabled();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(disables).toBe(0);
    expect(mutations).toHaveLength(0);
    await card.getByRole('button',{name:'Disable new payments',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByLabel('Reason',{exact:true}).fill('Pause new sales safely');await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button',{name:'Disable new payments',exact:true}).click();
    await expect(dialog).not.toBeVisible();expect(disables).toBe(1);
    await expect(card.getByText('New payments disabled',{exact:true})).toBeVisible();
    await expect(card.getByRole('button',{name:'Resume payments'})).toBeVisible();
    await expectNoOverflow(page);
  });
  await test.step('Once obligations settle, Resume verifies readiness before returning to an active merchant', async () => {
    obligations = false;
    await card.getByRole('button',{name:'Resume payments',exact:true}).click();
    const resume = page.getByRole('dialog', { name: 'Resume payments', exact: true });
    await expect(resume.getByText('New paid bookings will resume only after Stripe confirms this account is ready.')).toBeVisible();
    await resume.getByLabel('Reason', { exact: true }).fill('Ready to resume after settlement');
    await resume.getByRole('checkbox').check();
    await resume.getByRole('button', { name: 'Resume payments', exact: true }).click();
    await expect(resume).not.toBeVisible();
    expect(resumes).toBe(1);expect(account.paymentsReady).toBe(true);
    await expect(card.getByText('Ready for sandbox payments', { exact: true })).toBeVisible();
    await expect(card.getByText('Stripe readiness verified. New payments resumed.', { exact: true })).toBeVisible();
  });
  await test.step('Direct disconnect of the ready merchant explains impact and preserves history while confirmation is uncertain', async () => {
    await card.getByRole('button',{name:'Disconnect Stripe',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Disconnect Stripe account'});
    await expect(dialog.getByText('Saved booking history')).toBeVisible();
    await expect(dialog.getByRole('button',{name:'Disconnect Stripe account'})).toBeDisabled();
    await expect(dialog.getByText(/does not close the account/)).toBeVisible();
    await expectNoOverflow(page);
    const bounds=await dialog.boundingBox(),viewport=page.viewportSize();
    expect(bounds.width).toBeLessThanOrEqual(viewport.width-16);expect(bounds.height).toBeLessThanOrEqual(viewport.height-16);
    await page.screenshot({path:testInfo.outputPath('stripe-disconnect-confirmation.png')});
    await dialog.getByLabel('Reason',{exact:true}).fill('Owner wants to remove Stripe access');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button',{name:'Disconnect Stripe account'}).click();
    await expect(dialog.getByRole('alert')).toContainText('has not confirmed disconnection');
    await expect(card.getByText('Disconnection pending · payments disabled')).toBeVisible();
    await expect(dialog).toBeVisible();
  });
  await test.step('Explicit reconciliation reuses the disconnect identity and archives the account only after confirmation', async () => {
    const dialog=page.getByRole('dialog',{name:'Disconnect Stripe account'});
    await dialog.getByRole('button',{name:'Disconnect Stripe account'}).click();
    await expect(dialog).not.toBeVisible();
    await expect(card.getByText('Disconnected · history retained')).toBeVisible();
    expect(mutations).toHaveLength(2);expect(mutations[0].idempotencyKey).toBe(mutations[1].idempotencyKey);expect(mutations[0].confirmed).toBe(true);
    await expect(card.getByRole('button',{name:'Disconnect Stripe',exact:true})).toHaveCount(0);
  });
});

authTest('merchant setup journey names defaults, recovers hosted onboarding and verifies readiness on return', async ({ page, fixture }) => {
  const identity = createStripeTestIdentity('setup-recovery');
  // Explicit finance delegation is isolated from the unchanged denial cases.
  await enableFinanceFixture(page, { canViewEarnings: true });
  const accounts = [{ id: '00000000-0000-4000-8000-000000000501', name: 'Downtown', mode: 'test', paymentsReady: false, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false }];
  let defaultPaymentAccountId = null;
  const creates = [];
  let attempts = 0, pending;
  await page.route('**/api/business/organizations/*/payment-accounts**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/onboarding')) {
      attempts++;
      if (attempts === 1) { pending = route; return; }
      return route.fulfill({ json: { data: { url: 'https://connect.stripe.com/setup/offline-recovery', expiresAt: new Date(Date.now() + (attempts === 2 ? -1000 : 300000)).toISOString() } } });
    }
    if (path.endsWith('/synchronize')) {
      const index = accounts.findIndex(account => account.id === path.split('/').at(-2));
      expect(index).toBeGreaterThanOrEqual(0);
      accounts[index] = { ...accounts[index], paymentsReady: true, detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true };
      return route.fulfill({ json: { data: accounts[index] } });
    }
    if (path.endsWith('/default')) { defaultPaymentAccountId = route.request().postDataJSON().paymentAccountId; return route.fulfill({ json: { data: {} } }); }
    if (method === 'POST') { creates.push(route.request().postDataJSON()); accounts.push({ id: '00000000-0000-4000-8000-000000000502', name: creates[0].name, mode: 'test', paymentsReady: false }); return route.fulfill({ json: { data: accounts[1] } }); }
    return route.fulfill({ json: { data: { items: accounts, total: accounts.length, page: 1, pageSize: 10, hasMore: false, defaultPaymentAccountId } } });
  });
  await page.route('https://connect.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Offline Stripe setup</h1><label>Email address<input type="email" /></label></body></html>' }));
  await loginViaApi(page, fixture, 'business', 'business', `/?section=payments&paymentOrganization=${fixture.ids.org}`);
  const card = page.locator('.payment-accounts').first();
  await test.step('Payment totals, readiness checks and named default/new accounts stay in one merchant surface', async () => {
    await expect(page.getByRole('heading', { name: 'Your payments, clearly.', exact: true })).toBeVisible();
    await expect(page.getByText('Customer payments', { exact: true })).toBeVisible();
    await expect(page.getByText('Refunded payments', { exact: true })).toBeVisible();
    await expect(page.getByText('Remaining payments', { exact: true })).toBeVisible();
    await expect(page.locator('.payment-accounts')).toHaveCount(1);
    await expect(card.getByRole('heading', { name: 'Payment accounts' })).toBeVisible();
    await expect(card.getByText('Setup required', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Check readiness' }).click();
    await expect(card.getByText('Ready for sandbox payments')).toBeVisible();
    await card.getByLabel('Default payment account').selectOption(accounts[0].id);
    await expect.poll(() => defaultPaymentAccountId).toBe(accounts[0].id);
    await card.getByLabel('New account name').fill('Uptown');
    await card.getByRole('button', { name: 'Add payment account' }).click();
    await expect(card.getByRole('heading', { name: 'Uptown' })).toBeVisible();
    await expect(page.locator('.payment-accounts')).toHaveCount(1);
    expect(creates).toHaveLength(1); expect(creates[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(card.getByRole('link', { name: 'Stripe dashboard' })).toHaveAttribute('href', 'https://dashboard.stripe.com/');
    await expectNoOverflow(page);
  });
  await test.step('Personal commissions remain separate from business merchant accounts', async () => {
    await page.getByRole('button', { name: 'My commissions', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Commission rate locked at 0%' })).toBeVisible();
    await expect(page.getByText('$18.00', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment accounts' })).toHaveCount(0);
    await expectNoOverflow(page);
    await page.getByRole('button', { name: 'Business payments', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Uptown' })).toBeVisible();
  });
  await test.step('Hosted setup holds visible progress, reports failure and rejects an expired link before retry', async () => {
    await card.getByRole('button', { name: 'Complete Stripe setup' }).click();
    await expect(card.getByRole('button', { name: 'Opening Stripe…' })).toBeDisabled();
    await expect(card.getByRole('status')).toHaveText('Preparing your secure Stripe setup…');
    await expect.poll(() => attempts).toBe(1);
    await expectNoOverflow(page);
    await pending.fulfill({ status: 503, json: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Stripe setup is temporarily unavailable. Please try again.' } } });
    await expect(card.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(card.getByRole('button', { name: 'Complete Stripe setup' })).toBeEnabled();
    await card.getByRole('button', { name: 'Complete Stripe setup' }).click();
    await expect(card.getByRole('alert')).toHaveText('Your Stripe setup link expired. Please try again.');
    await expect(card.getByRole('link', { name: /Continue to Stripe/ })).toHaveCount(0);
    await expect(page).toHaveURL(/localhost.*section=payments|127\.0\.0\.1.*section=payments/);
    await card.getByRole('button', { name: 'Complete Stripe setup' }).click();
    await expect(page).toHaveURL('https://connect.stripe.com/setup/offline-recovery');
    await expect(page.getByRole('heading', { name: 'Offline Stripe setup' })).toBeVisible();
    await page.getByLabel('Email address').fill(identity.email);
    await expect(page.getByLabel('Email address')).toHaveValue(`test+${identity.testIdentifier}@nitewide.com`);
    expect(attempts).toBe(3);
  });
  await test.step('Returning from hosted setup verifies the new account and keeps Organization free of merchant controls', async () => {
    await page.goto(`/?section=payments&paymentAccountReturn=${accounts[1].id}&paymentOrganization=${fixture.ids.org}`);
    await expect(page.getByRole('status').filter({ hasText: 'Payment readiness checked with Stripe.' })).toBeVisible();
    await expect(page.locator('.payment-accounts')).toHaveCount(1);
    await expect(card.locator('article').filter({ has: page.getByRole('heading', { name: 'Uptown', exact: true }) }).getByText('Ready for sandbox payments', { exact: true })).toBeVisible();
    await expectNoOverflow(page);
    await businessSection(page, 'Organization');
    await expect(page.getByRole('heading', { name: 'Build your team' })).toBeVisible();
    await expect(page.locator('.payment-accounts')).toHaveCount(0);
  });
});

test('event merchant journey locks unresolved payments then changes future routing while retaining historical accounts', async ({ page, fixture }) => {
  let settled = false, selected = null;
  const fresh = { id: '00000000-0000-4000-8000-000000000512', name: 'New merchant', mode: 'test', paymentsReady: true };
  await page.route(`**/api/business/events/${fixture.ids.event}/summary`, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    Object.assign(payload.data.event, { canManageFinance: true, canChangePaymentAccount: settled, ...(selected ? { paymentAccountId: selected } : {}) });
    await route.fulfill({ response, json: payload });
  });
  await page.route('**/api/business/organizations/*/payment-accounts**', route => route.fulfill({ json: { data: { items: [fresh], total: 1, hasMore: false, defaultPaymentAccountId: null } } }));
  await page.route(`**/api/business/events/${fixture.ids.event}/payment-account`, route => {
    if (!settled) throw new Error('Unresolved event payments must not change merchants');
    selected = route.request().postDataJSON().paymentAccountId;
    return route.fulfill({ json: { data: { paymentAccountId: selected } } });
  });
  await loginViaApi(page, fixture, 'business', 'business', `/?section=events&event=${fixture.ids.event}`);
  const card = page.locator('.payment-accounts');
  await test.step('Pending checkouts and refunds keep event merchant selection read only', async () => {
    await expect(card.getByRole('heading', { name: 'Event payments' })).toBeVisible();
    await expect(card.getByLabel('Event payment account')).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Save payment account' })).toBeDisabled();
    await expect(card.getByRole('status')).toContainText('Resolve pending checkouts');
    expect(selected).toBeNull();
    await expectNoOverflow(page);
  });
  await test.step('After settlement, a new account changes future payments and the UI explains historical retention', async () => {
    settled = true;
    await page.reload();
    await expect(card.getByText('Changes apply to future payments. Existing orders and refunds keep their original account.')).toBeVisible();
    await expect(card.getByLabel('Event payment account')).toBeEnabled();
    await card.getByLabel('Event payment account').selectOption(fresh.id);
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/business/events/${fixture.ids.event}/summary`);
    await card.getByRole('button', { name: 'Save payment account' }).click();
    await expect.poll(() => selected).toBe(fresh.id);
    await expect(page.getByText('Event payment account updated.', { exact: true })).toBeVisible();
    await refreshed;
    await expect(card.getByLabel('Event payment account')).toHaveValue(fresh.id);
    await expectNoOverflow(page);
  });
  await page.unrouteAll({ behavior: 'wait' });
});

authTest('manager without finance or earnings permission does not see payments navigation or controls', async ({ page, fixture }) => {
  const paymentRequests = [];
  await page.route('**/api/business/bootstrap', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.organizations = payload.data.organizations.map(item => ({ ...item, canManageFinance: false }));
    payload.data.scope = { ...payload.data.scope, canViewEarnings: false };
    await route.fulfill({ response, json: payload });
  });
  page.on('request', request => { if (/\/payment-(?:overview|accounts)|\/payments\/earnings/.test(request.url())) paymentRequests.push(request.url()); });
  await loginViaApi(page, fixture, 'business', 'business', `/?section=team&teamOrganizationId=${fixture.ids.org}`);
  await expect(page.getByRole('heading', { name: 'Build your team' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment accounts' })).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Payments', exact: true })).toHaveCount(0);
  await page.goto(`/?section=payments&paymentOrganization=${fixture.ids.org}`);
  await expect(page.getByRole('navigation').filter({ visible: true }).getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation').filter({ visible: true }).getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Payment accounts' })).toHaveCount(0);
  expect(paymentRequests).toEqual([]);
  await expectNoOverflow(page);
  // Redirecting denied Payments access to Overview refreshes bootstrap again.
  // Drain that permission override before teardown disposes its fetched body.
  await page.unrouteAll({ behavior: 'wait' });
});

authTest('commission-only access shows personal earnings without merchant requests or payment accounts', async ({ page, fixture }) => {
  await page.route('**/api/business/bootstrap', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.organizations = payload.data.organizations.map(item => ({ ...item, canManageFinance: false }));
    payload.data.scope = { ...payload.data.scope, canViewEarnings: true };
    await route.fulfill({ response, json: payload });
  });
  await mockPaymentSummaries(page);
  const merchantRequests = [];
  page.on('request', request => { if (/\/payment-(?:overview|accounts)/.test(request.url())) merchantRequests.push(request.url()); });
  await loginViaApi(page, fixture, 'business', 'business', `/?section=payments&paymentOrganization=${fixture.ids.org}`);
  await expect(page.getByRole('heading', { name: 'Your payments, clearly.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My commissions', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Commission rate locked at 0%' })).toBeVisible();
  await expect(page.getByText('$18.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment accounts' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Business payments', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect personal Stripe account', exact: true })).toBeVisible();
  expect(merchantRequests).toEqual([]);
  await expectNoOverflow(page);
});
