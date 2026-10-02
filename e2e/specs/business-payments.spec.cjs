const { test, expect, login, businessSection, expectNoOverflow } = require('../fixtures.cjs');
const { createStripeTestIdentity } = require('../test-data/stripe-connect/identity.cjs');

function merchantOverview(organizationId) {
  return { organizationId, period: 'all_time', mode: 'test', currencies: [{ currency: 'usd', collectedCents: 12500, refundedCents: 2500, netCollectedCents: 10000, paidOrders: 3, refundedOrders: 1, pendingOrders: 2, reviewOrders: 1 }], pendingOrders: 2, reviewOrders: 1, merchantBalance: null, payouts: null, stripeDashboardUrl: null };
}

function ownEarnings() {
  return { period: 'all_time', scope: 'own', currencies: [{ currency: 'usd', verifiedEarnedCents: 1800, verifiedRefundedCents: 300, demoEarnedCents: 4200, demoRefundedCents: 200, verifiedPaidOrders: 3, verifiedRefundedOrders: 1, demoPaidOrders: 4, demoRefundedOrders: 1 }], receivedPayouts: null, dashboardConnected: null, dashboardUrl: null };
}

async function mockPaymentSummaries(page) {
  await page.route('**/api/business/organizations/*/payment-overview', route => {
    const organizationId = new URL(route.request().url()).pathname.split('/').at(-2);
    return route.fulfill({ json: { data: merchantOverview(organizationId) } });
  });
  await page.route('**/api/business/payments/earnings', route => route.fulfill({ json: { data: ownEarnings() } }));
}

async function enableDisconnectFixture(page) {
  await page.route('**/api/business/bootstrap',async route=>{
    const response=await route.fetch(),payload=await response.json();
    payload.data.organizations=payload.data.organizations.map(item=>({...item,canManageFinance:true}));
    await route.fulfill({response,json:payload});
  });
  await mockPaymentSummaries(page);
}

test('shared sandbox account is clear, refreshable and protected in business payments',async({page,fixture})=>{
  await enableDisconnectFixture(page);
  const sharedAccountId='acct_sharedbrowser';let reads=0,mutations=0;
  await page.route('**/api/business/organizations/*/payment-accounts**',route=>{
    if(route.request().method()!=='GET') mutations++;
    reads++;
    return route.fulfill({json:{data:{items:[{id:'00000000-0000-4000-8000-000000000520',name:'Original merchant profile',stripeAccountId:sharedAccountId,
      lifecycleState:'active',disconnectStatus:'none',paymentsReady:true,detailsSubmitted:true,chargesEnabled:true,payoutsEnabled:true}],
      total:1,page:1,pageSize:10,hasMore:false,canDisconnectPayments:true,defaultPaymentAccountId:null,
      sharedSandboxAccount:{stripeAccountId:sharedAccountId,paymentsReady:true}}}});
  });
  await login(page,fixture,'business','business',`/app?section=payments&paymentOrganization=${fixture.ids.org}`);
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
  await page.unrouteAll({behavior:'wait'});
});

test('event payments explains shared sandbox routing instead of an ineffective account selector',async({page,fixture})=>{
  await page.route('**/api/business/events/*/summary',async route=>{
    const response=await route.fetch(),payload=await response.json();
    payload.data.event={...payload.data.event,canManageFinance:true,canChangePaymentAccount:true};
    await route.fulfill({response,json:payload});
  });
  await page.route('**/api/business/organizations/*/payment-accounts**',route=>route.fulfill({json:{data:{items:[],total:0,page:1,pageSize:50,hasMore:false,
    defaultPaymentAccountId:null,canDisconnectPayments:false,sharedSandboxAccount:{stripeAccountId:'acct_sharedbrowser',paymentsReady:false}}}}));
  await login(page,fixture,'business','business',`/app?section=events&event=${fixture.ids.event}`);
  const payments=page.locator('.payment-accounts');
  await expect(payments.getByText('Shared sandbox payments',{exact:true})).toBeVisible();
  await expect(payments).toContainText('Paid checkout remains unavailable');
  await expect(payments.getByLabel('Event payment account')).toHaveCount(0);
  await expect(payments.getByRole('button',{name:'Save payment account'})).toHaveCount(0);
  await expectNoOverflow(page);await page.unrouteAll({behavior:'wait'});
});

test('self-service Stripe disconnect confirms impact, preserves retry identity and retains history',async({page,fixture},testInfo)=>{
  await enableDisconnectFixture(page);
  let account={id:'00000000-0000-4000-8000-000000000510',name:'Disconnect merchant',stripeAccountId:'acct_offline',
    lifecycleState:'active',disconnectStatus:'none',paymentsReady:true,detailsSubmitted:true,chargesEnabled:true,payoutsEnabled:true};
  const mutations=[];
  await page.route('**/api/business/organizations/*/payment-accounts**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/disconnect-impact')) return route.fulfill({json:{data:{account,affectedEvents:2,pendingPayments:0,reviewPayments:0,
      unresolvedRefunds:0,unfulfilledPaidBookings:0,historicalBookings:30,blockedReasons:[],providerDisconnectConfigured:true,canDisconnect:account.disconnectStatus !== 'disconnected'}}});
    if(path.endsWith('/disconnect')) {
      mutations.push(route.request().postDataJSON());
      account={...account,paymentsReady:false,paymentsDisabledAt:new Date().toISOString(),disconnectRequestId:mutations[0].idempotencyKey,
        disconnectStatus:mutations.length===1?'pending':'disconnected',disconnectErrorCode:mutations.length===1?'DISCONNECT_UNCONFIRMED':null,
        lifecycleState:mutations.length===1?'active':'archived'};
      return route.fulfill({json:{data:{account,retryable:mutations.length===1}}});
    }
    return route.fulfill({json:{data:{items:[account],total:1,page:1,pageSize:10,hasMore:false,canDisconnectPayments:true,defaultPaymentAccountId:account.id}}});
  });
  await login(page,fixture,'business','business',`/app?section=payments&paymentOrganization=${fixture.ids.org}`);
  const card=page.locator('.payment-accounts');
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
  await dialog.getByRole('button',{name:'Disconnect Stripe account'}).click();
  await expect(dialog).not.toBeVisible();
  await expect(card.getByText('Disconnected · history retained')).toBeVisible();
  expect(mutations).toHaveLength(2);expect(mutations[0].idempotencyKey).toBe(mutations[1].idempotencyKey);expect(mutations[0].confirmed).toBe(true);
  await expect(card.getByRole('button',{name:'Disconnect Stripe',exact:true})).toHaveCount(0);
});

test('self-service Stripe disconnect blocks unresolved payments but allows a confirmed reversible disable',async({page,fixture})=>{
  await enableDisconnectFixture(page);
  let account={id:'00000000-0000-4000-8000-000000000511',name:'Busy merchant',stripeAccountId:'acct_offline',lifecycleState:'active',disconnectStatus:'none',paymentsReady:true};
  let disables=0;
  await page.route('**/api/business/organizations/*/payment-accounts**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/disconnect-impact')) return route.fulfill({json:{data:{account,affectedEvents:1,pendingPayments:2,reviewPayments:0,
      unresolvedRefunds:1,unfulfilledPaidBookings:5,historicalBookings:30,blockedReasons:['Pending payments must finish or expire.','Pending or failed refunds must be resolved.'],providerDisconnectConfigured:true,canDisconnect:false}}});
    if(path.endsWith('/disable')) {disables++;account={...account,paymentsReady:false,paymentsDisabledAt:new Date().toISOString()};return route.fulfill({json:{data:account}});}
    if(path.endsWith('/disconnect')) throw new Error('A blocked connection must not send a disconnect request');
    return route.fulfill({json:{data:{items:[account],total:1,page:1,pageSize:10,hasMore:false,canDisconnectPayments:true,defaultPaymentAccountId:null}}});
  });
  await login(page,fixture,'business','business',`/app?section=payments&paymentOrganization=${fixture.ids.org}`);
  await page.getByRole('button',{name:'Disconnect Stripe',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await expect(dialog.getByText('Resolve these before disconnecting')).toBeVisible();
  await dialog.getByLabel('Reason',{exact:true}).fill('Try disconnecting');await dialog.getByRole('checkbox').check();
  await expect(dialog.getByRole('button',{name:'Disconnect Stripe account'})).toBeDisabled();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(disables).toBe(0);
  await page.getByRole('button',{name:'Disable new payments',exact:true}).click();dialog=page.getByRole('dialog');
  await dialog.getByLabel('Reason',{exact:true}).fill('Pause new sales safely');await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'Disable new payments',exact:true}).click();
  await expect(dialog).not.toBeVisible();expect(disables).toBe(1);
  await expect(page.getByText('New payments disabled',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Resume payments'})).toBeVisible();
  await expectNoOverflow(page);
});

test('hosted setup shows progress, exposes failures and retries expired links without duplicate requests', async ({ page, fixture }) => {
  const identity = createStripeTestIdentity('setup-recovery');
  // The standard Sam fixture is a manager without finance delegation. This
  // scenario represents an explicitly authorized finance manager; the denial
  // scenario below independently verifies the unmodified permissions.
  await page.route('**/api/business/bootstrap', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.organizations = payload.data.organizations.map(item => ({ ...item, canManageFinance: true }));
    await route.fulfill({ response, json: payload });
  });
  await mockPaymentSummaries(page);
  const account = { id: '00000000-0000-4000-8000-000000000503', name: 'Sandbox merchant', paymentsReady: false };
  let attempts = 0, pending;
  await page.route('**/api/business/organizations/*/payment-accounts**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/onboarding')) {
      attempts++;
      if (attempts === 1) { pending = route; return; }
      return route.fulfill({ json: { data: { url: 'https://connect.stripe.com/setup/offline-recovery', expiresAt: new Date(Date.now() + (attempts === 2 ? -1000 : 300000)).toISOString() } } });
    }
    return route.fulfill({ json: { data: { items: [account], total: 1, hasMore: false, defaultPaymentAccountId: null } } });
  });
  await page.route('https://connect.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Offline Stripe setup</h1><label>Email address<input type="email" /></label></body></html>' }));
  await login(page, fixture, 'business', 'business', `/app?section=payments&paymentOrganization=${fixture.ids.org}`);
  const card = page.locator('.payment-accounts');
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

test('business payment profiles support named defaults, hosted setup and verified readiness', async ({ page, fixture }) => {
  await page.route('**/api/business/bootstrap', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.organizations = payload.data.organizations.map(item => ({ ...item, canManageFinance: true }));
    payload.data.scope = { ...payload.data.scope, canViewEarnings: true };
    await route.fulfill({ response, json: payload });
  });
  await mockPaymentSummaries(page);
  const accounts = [{ id: '00000000-0000-4000-8000-000000000501', name: 'Downtown', paymentsReady: false, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false }];
  let defaultPaymentAccountId = null;
  const creates = [];
  let onboarded = false;
  await page.route('**/api/business/organizations/*/payment-accounts**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/onboarding')) { onboarded = true; return route.fulfill({ json: { data: { url: 'https://connect.stripe.com/setup/offline-fixture', expiresAt: new Date(Date.now() + 300000).toISOString() } } }); }
    if (path.endsWith('/synchronize')) { accounts[0] = { ...accounts[0], paymentsReady: true, detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true }; return route.fulfill({ json: { data: accounts[0] } }); }
    if (path.endsWith('/default')) { defaultPaymentAccountId = route.request().postDataJSON().paymentAccountId; return route.fulfill({ json: { data: {} } }); }
    if (method === 'POST') { creates.push(route.request().postDataJSON()); accounts.push({ id: '00000000-0000-4000-8000-000000000502', name: creates[0].name, paymentsReady: false }); return route.fulfill({ json: { data: accounts[1] } }); }
    return route.fulfill({ json: { data: { items: accounts, total: accounts.length, page: 1, pageSize: 10, hasMore: false, defaultPaymentAccountId } } });
  });
  await login(page, fixture, 'business', 'business', `/app?section=payments&paymentOrganization=${fixture.ids.org}`);
  await expect(page.getByRole('heading', { name: 'Your payments, clearly.', exact: true })).toBeVisible();
  await expect(page.getByText('Customer payments', { exact: true })).toBeVisible();
  await expect(page.getByText('Refunded payments', { exact: true })).toBeVisible();
  await expect(page.getByText('Remaining payments', { exact: true })).toBeVisible();
  const card = page.locator('.payment-accounts').first();
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
  await page.getByRole('button', { name: 'My commissions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Commission rate locked at 0%' })).toBeVisible();
  await expect(page.getByText('$18.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment accounts' })).toHaveCount(0);
  await expectNoOverflow(page);
  await page.getByRole('button', { name: 'Business payments', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Uptown' })).toBeVisible();
  await page.route('https://connect.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Offline hosted Stripe onboarding fixture</body></html>' }));
  await card.getByRole('button', { name: 'Complete Stripe setup' }).click();
  await expect(page).toHaveURL('https://connect.stripe.com/setup/offline-fixture');
  expect(onboarded).toBe(true);
  await page.goto(`/app?section=payments&paymentAccountReturn=${accounts[0].id}&paymentOrganization=${fixture.ids.org}`);
  await expect(page.getByRole('status').filter({ hasText: 'Payment readiness checked with Stripe.' })).toBeVisible();
  await expect(page.locator('.payment-accounts')).toHaveCount(1);
  await expectNoOverflow(page);
  await businessSection(page, 'Organization');
  await expect(page.getByRole('heading', { name: 'Build your team' })).toBeVisible();
  await expect(page.locator('.payment-accounts')).toHaveCount(0);
});

test('event payment selection is read only while checkouts or refunds are unresolved', async ({ page, fixture }) => {
  await page.route(`**/api/business/events/${fixture.ids.event}/summary`, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    Object.assign(payload.data.event, { canManageFinance: true, canChangePaymentAccount: false });
    await route.fulfill({ response, json: payload });
  });
  await page.route('**/api/business/organizations/*/payment-accounts**', route => route.fulfill({ json: { data: { items: [], total: 0, hasMore: false, defaultPaymentAccountId: null } } }));
  await login(page, fixture, 'business', 'business', `/app?section=events&event=${fixture.ids.event}`);
  const card = page.locator('.payment-accounts');
  await expect(card.getByRole('heading', { name: 'Event payments' })).toBeVisible();
  await expect(card.getByLabel('Event payment account')).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Save payment account' })).toBeDisabled();
  await expect(card.getByRole('status')).toContainText('Resolve pending checkouts');
  await expectNoOverflow(page);
});

test('settled event payment selection allows a new account while explaining historical merchant retention', async ({ page, fixture }) => {
  await page.route(`**/api/business/events/${fixture.ids.event}/summary`, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    Object.assign(payload.data.event, { canManageFinance: true, canChangePaymentAccount: true });
    await route.fulfill({ response, json: payload });
  });
  const fresh = { id: '00000000-0000-4000-8000-000000000512', name: 'New merchant', paymentsReady: true };
  await page.route('**/api/business/organizations/*/payment-accounts**', route => route.fulfill({ json: { data: { items: [fresh], total: 1, hasMore: false, defaultPaymentAccountId: null } } }));
  let selected = null;
  await page.route(`**/api/business/events/${fixture.ids.event}/payment-account`, route => {
    selected = route.request().postDataJSON().paymentAccountId;
    return route.fulfill({ json: { data: { paymentAccountId: selected } } });
  });
  await login(page, fixture, 'business', 'business', `/app?section=events&event=${fixture.ids.event}`);
  const card = page.locator('.payment-accounts');
  await expect(card.getByText('Changes apply to future payments. Existing orders and refunds keep their original account.')).toBeVisible();
  await expect(card.getByLabel('Event payment account')).toBeEnabled();
  await card.getByLabel('Event payment account').selectOption(fresh.id);
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/business/events/${fixture.ids.event}/summary`);
  await card.getByRole('button', { name: 'Save payment account' }).click();
  await expect.poll(() => selected).toBe(fresh.id);
  await expect(page.getByText('Event payment account updated.', { exact: true })).toBeVisible();
  await refreshed;
  await expectNoOverflow(page);
  await page.unrouteAll({ behavior: 'wait' });
});

test('event commission editing and promoter invitations remain locked at zero without individual Stripe onboarding', async ({ page, fixture }) => {
  await login(page, fixture, 'business', 'business', `/app?section=events&event=${fixture.ids.event}&tab=people`);
  await page.getByRole('button', { name: fixture.accounts.promoter.name, exact: false }).click();
  const member = page.getByRole('dialog');
  await member.getByRole('button', { name: 'Edit member' }).click();
  const rate = member.getByRole('slider', { name: 'Event commission percentage' });
  await expect(rate).toBeDisabled();
  await expect(rate).toHaveAttribute('aria-valuenow', '0');
  await expect(member.getByText(/Locked at 0% until this person completes their individual Stripe onboarding/)).toBeVisible();
  await expectNoOverflow(page);
  const saved = page.waitForRequest(request => new URL(request.url()).pathname.endsWith(`/business/events/${fixture.ids.event}/people`) && request.method() === 'PUT');
  await member.getByRole('button', { name: 'Save commission' }).click();
  expect((await saved).postDataJSON().commissionBps).toBe(0);
  await expect(page.getByRole('status').filter({ hasText: 'Event commission saved for future purchases.' })).toBeVisible();
  await page.getByRole('button', { name: 'Add promoter' }).click();
  const invitation = page.getByRole('dialog');
  const invitationRate = invitation.getByRole('slider', { name: 'Invitation commission percentage' });
  await expect(invitationRate).toBeDisabled();
  await expect(invitationRate).toHaveAttribute('aria-valuenow', '0');
  await expect(invitation.getByText(/Invitations start at 0%/)).toBeVisible();
  await invitation.getByLabel('Email address').fill('new-promoter@fixture.test');
  const created = page.waitForRequest(request => new URL(request.url()).pathname.endsWith(`/business/events/${fixture.ids.event}/invitations`) && request.method() === 'POST');
  await invitation.getByRole('button', { name: 'Create invitation' }).click();
  expect((await created).postDataJSON().commissionBps).toBe(0);
  await expect(invitation.getByRole('status')).toContainText('at 0% commission');
  await expectNoOverflow(page);
});

test('manager without finance or earnings permission does not see payments navigation or controls', async ({ page, fixture }) => {
  const paymentRequests = [];
  await page.route('**/api/business/bootstrap', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.organizations = payload.data.organizations.map(item => ({ ...item, canManageFinance: false }));
    payload.data.scope = { ...payload.data.scope, canViewEarnings: false };
    await route.fulfill({ response, json: payload });
  });
  page.on('request', request => { if (/\/payment-(?:overview|accounts)|\/payments\/earnings/.test(request.url())) paymentRequests.push(request.url()); });
  await login(page, fixture, 'business', 'business', `/app?section=team&teamOrganizationId=${fixture.ids.org}`);
  await expect(page.getByRole('heading', { name: 'Build your team' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment accounts' })).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Payments', exact: true })).toHaveCount(0);
  await page.goto(`/app?section=payments&paymentOrganization=${fixture.ids.org}`);
  await expect(page.getByRole('navigation').filter({ visible: true }).getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation').filter({ visible: true }).getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Payment accounts' })).toHaveCount(0);
  expect(paymentRequests).toEqual([]);
  await expectNoOverflow(page);
});

test('commission-only access shows personal earnings without merchant requests or payment accounts', async ({ page, fixture }) => {
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
  await login(page, fixture, 'business', 'business', `/app?section=payments&paymentOrganization=${fixture.ids.org}`);
  await expect(page.getByRole('heading', { name: 'Your payments, clearly.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My commissions', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Commission rate locked at 0%' })).toBeVisible();
  await expect(page.getByText('$18.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment accounts' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Business payments', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Stripe dashboard/ })).toHaveAttribute('href', 'https://dashboard.stripe.com/');
  expect(merchantRequests).toEqual([]);
  await expectNoOverflow(page);
});
