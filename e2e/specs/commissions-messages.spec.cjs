const { test: baseTest, expect, loginViaApi, expectNoOverflow } = require('../fixtures.cjs');
const test = baseTest.extend({ fixtureRecipe: 'commerce' });
const { urls, controlToken } = require('../environment.cjs');

test('booking contact stays in Messages, receives an organizer reply and raises Notifications without email', async ({ page, context, request, fixture }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('customer-'), 'Customer project covers the real two-app conversation.');
  const emailHeaders = { 'x-e2e-control': controlToken };
  const beforeEmails = await (await request.get(`${urls.api}/__e2e/emails`, { headers: emailHeaders })).json();
  await loginViaApi(page, fixture, 'customer', 'customer', `/?tab=booked&booking=purchase:${fixture.ids.order}`);
  const thread = await test.step('booking contact opens Messages and sends the customer question', async () => {
    await page.getByRole('button', { name: 'Contact organizer', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Your message', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Sending a request/)).toHaveCount(0);
    await dialog.getByLabel('Your message', { exact: true }).fill('Can I arrive with my party at 10pm?');
    const sent = page.waitForResponse(response => response.url().includes(`/customer/orders/${fixture.ids.order}/messages`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
    const thread = (await (await sent).json()).data.thread;
    await expect(dialog.getByText('Can I arrive with my party at 10pm?', { exact: true })).toBeVisible();
    await expectNoOverflow(page);
    const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
    expect(bounds.width).toBeLessThanOrEqual(viewport.width - 8); expect(bounds.height).toBeLessThanOrEqual(viewport.height - 8);
    await page.screenshot({ path: testInfo.outputPath('customer-booking-conversation.png') });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    return thread;
  });
  const organizer = await context.newPage();
  try {
    await test.step('the real Business organizer sees the same thread and replies', async () => {
      await loginViaApi(organizer, fixture, 'business', 'business', '/?section=overview');
      await organizer.getByRole('button', { name: /^Messages/ }).click();
      const dialog = organizer.getByRole('dialog');
      await dialog.getByRole('button', { name: /Can I arrive with my party at 10pm/ }).click();
      await expect(dialog.getByText('Can I arrive with my party at 10pm?', { exact: true })).toBeVisible();
      await dialog.getByLabel('Your message', { exact: true }).fill('Yes. Please have your booking QR code ready.');
      await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(dialog.getByText('Yes. Please have your booking QR code ready.', { exact: true })).toBeVisible();
      await expectNoOverflow(organizer);
      await organizer.screenshot({ path: testInfo.outputPath('organizer-booking-reply.png') });
    });
    await test.step('Notifications opens the exact reply, marks it read and leaves the paid booking and email queue intact', async () => {
      await page.bringToFront();
      const token = await page.evaluate(() => JSON.parse(localStorage.getItem('nitewide.session')).accessToken);
      // Reply notifications are delivered by the real asynchronous worker.
      // Wait for this exact record before opening the one-shot inbox; the
      // application intentionally does not poll an already-open inbox.
      await expect.poll(async () => {
        const response = await request.get(`${urls.api}/api/notifications?page=1&pageSize=20`, { headers: { Authorization: `Bearer ${token}` } });
        expect(response.ok()).toBe(true);
        const { data } = await response.json();
        return data.items.filter(item => item.kind === 'organizer_message' && item.metadata?.threadId === thread.id && item.metadata?.orderId === fixture.ids.order).length;
      }).toBe(1);
      await page.getByRole('button', { name: /^Notifications/ }).click();
      const read = page.waitForResponse(response => response.url().includes(`/customer/messages/${thread.id}/read`) && response.request().method() === 'POST');
      await page.getByRole('dialog').getByRole('button', { name: /^Organizer replied/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Yes. Please have your booking QR code ready.', { exact: true })).toBeVisible();
      expect((await read).ok()).toBe(true);
      const detail = await (await request.get(`${urls.api}/api/customer/messages/${thread.id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
      expect(detail.data.thread.unread).toBe(false);
      const pass = await (await request.get(`${urls.api}/api/customer/purchases/${fixture.ids.order}/tickets`, { headers: { Authorization: `Bearer ${token}` } })).json();
      expect(pass.data.status).toBe('paid');
      const afterEmails = await (await request.get(`${urls.api}/__e2e/emails`, { headers: emailHeaders })).json();
      expect(afterEmails).toEqual(beforeEmails);
    });
  } finally { await organizer.close(); }
});

test('commission confirmation names each approved statement, covers business fees and resumes its saved retry identity', async ({ page, fixture }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('business-'), 'Business project covers the funded statement interface.');
  const recipient = '00000000-0000-4000-8000-000000000811';
  const statement = (id, title) => ({ id, organizationId: fixture.ids.org, recipientUserId: recipient, recipientDisplayName: 'Alex Individual', eventTitle: title,
    currency: 'USD', status: 'approved', availableAt: '2026-01-01T00:00:00Z', originalCommissionCents: 600, payableCommissionCents: 600, heldCommissionCents: 0, paidCommissionCents: 0, canApprove: false });
  const rows = [statement('00000000-0000-4000-8000-000000000812', 'First event statement'), statement('00000000-0000-4000-8000-000000000813', 'Second event statement')];
  await page.route('**/api/business/bootstrap', async route => { const response = await route.fetch(), payload = await response.json(); payload.data.organizations = payload.data.organizations.map(org => ({ ...org, canManageFinance: true })); await route.fulfill({ response, json: payload }); });
  await page.route('**/api/business/organizations/*/commission-statements**', route => route.fulfill({ json: { data: { items: rows, total: 2, page: 1, pageSize: 10 } } }));
  const mutations = [];
  await page.route('**/api/business/organizations/*/commission-payments**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/quote')) return route.fulfill({ json: { data: { recipientUserId: recipient, currency: 'USD', statementIds: rows.map(row => row.id), commissionCents: 1200, estimatedFeeCents: 100, totalCents: 1300 } } });
    mutations.push(route.request().postDataJSON());
    if (mutations.length === 1) return route.fulfill({ status: 503, json: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Payment response unavailable. Retry this approved payment.' } } });
    return route.fulfill({ json: { data: { paymentId: '00000000-0000-4000-8000-000000000814', currency: 'USD', status: 'paid_fee_review', netSettlementStatus: 'invoicing_fee_unknown', commissionCents: 1200, estimatedFeeCents: 100, totalCents: 1300, actualFeeCents: null, verifiedNetCents: null, residualCents: null } } });
  });
  await loginViaApi(page, fixture, 'business', 'business', `/?section=payments&paymentOrganization=${fixture.ids.org}`);
  const chooseAndPay = async () => {
    // This isolated interface fixture mocks commission finance access, while
    // merchant panes retain the real API denial. Let those panels settle before
    // iPhone scrolls to a statement; their late alerts otherwise move the target
    // between Playwright's hit test and its click. No sleeps or forced clicks.
    await expect(page.locator('.payment-overview')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.payment-accounts').getByRole('alert')).toHaveText('Business owner or authorized finance manager access required');
    await page.getByRole('checkbox', { name: /Alex Individual at First event statement/ }).check();
    await page.getByRole('checkbox', { name: /Alex Individual at Second event statement/ }).check();
    await page.getByRole('button', { name: 'Pay 2 selected statements' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm commission payment' });
    for (const row of rows) await expect(dialog.locator('.commission-quote-statements').getByText(row.eventTitle, { exact: true })).toBeVisible();
    await expect(dialog.getByText('$12.00', { exact: true })).toBeVisible();
    await expect(dialog.getByText('$13.00', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Estimated processing fees', { exact: true })).toBeVisible();
    await expect(dialog.getByText('$1.00', { exact: true })).toHaveCount(1);
    await expect(dialog.getByText('Business fee allowance', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Create approved Stripe payment' })).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Create approved Stripe payment' }).click();
    return dialog;
  };
  await test.step('each named statement and business fee allowance require explicit approval before submission', async () => {
    const dialog = await chooseAndPay();
    await expect(dialog.getByRole('alert')).toContainText('response unavailable');
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ statementIds: rows.map(row => row.id), approvedTotalCents: 1300, feeEstimateAcknowledged: true });
    await expectNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('commission-funded-confirmation.png') });
  });
  await test.step('reload retries the saved payment identity without claiming a verified net receipt', async () => {
    await page.reload();
    await chooseAndPay();
    const dialog = page.getByRole('dialog', { name: 'Commission payment', exact: true });
    await expect(dialog.getByText('Fee review · net not verified', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Not verified', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Processing fees', { exact: true }).locator('..')).toHaveText('Processing feesAwaiting fee evidence');
    expect(mutations).toHaveLength(2);
    expect(mutations[1]).toEqual(mutations[0]);
    await expectNoOverflow(page);
  });
});

test('authorized finance fee review retains audited evidence on retry and requires a fresh residual payment approval', async ({ page, fixture }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('business-'), 'Business phone and desktop projects cover the audited merchant fee-review interface.');
  const recipient = '00000000-0000-4000-8000-000000000821', statementId = '00000000-0000-4000-8000-000000000822';
  const paymentId = '00000000-0000-4000-8000-000000000823', residualPaymentId = '00000000-0000-4000-8000-000000000824';
  let payment = { paymentId, organizationId: fixture.ids.org, recipientUserId: recipient, currency: 'USD', status: 'paid_fee_review',
    providerVerificationStatus: 'verified', fundsReceived: true, processingFeeCents: 100, invoicingFeeCents: null, feeEvidence: null, feeReview: null,
    commissionCents: 1200, totalCents: 1300, estimatedFeeCents: 100, actualFeeCents: null, verifiedNetCents: null,
    statements: [{ id: statementId, eventId: fixture.ids.event, eventTitle: 'Audited fee-review statement', currency: 'USD', amountCents: 1200 }],
    netSettlementStatus: 'invoicing_fee_unknown', residualCents: null,
    // Deliberately supply a stale URL: the UI must not render it for funds
    // already received, even if an old or malformed response includes one.
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/offline-already-paid' };
  let row = { id: statementId, organizationId: fixture.ids.org, recipientUserId: recipient, recipientDisplayName: 'Alex Individual',
    eventTitle: 'Audited fee-review statement', currency: 'USD', status: 'approved', availableAt: '2026-01-01T00:00:00Z',
    originalCommissionCents: 1200, unpaidCommissionCents: 1200, reservedCommissionCents: 1200, payableCommissionCents: 0,
    heldCommissionCents: 0, paidCommissionCents: 0, canApprove: false,
    payment: { paymentId, status: payment.status, netSettlementStatus: payment.netSettlementStatus },
    latestPaymentAttempt: { paymentId, status: payment.status, netSettlementStatus: payment.netSettlementStatus } };
  const reviews = [], payments = [], quotes = [];
  // The same server capability gates this pane for owners and explicitly
  // finance-authorized managers. This disposable manager represents the latter;
  // no real commission, Stripe or email operation is performed.
  await page.route('**/api/business/bootstrap', async route => {
    const response = await route.fetch(), payload = await response.json();
    payload.data.organizations = payload.data.organizations.map(org => ({ ...org, canManageFinance: true }));
    await route.fulfill({ response, json: payload });
  });
  await page.route('**/api/business/organizations/*/commission-statements**', route => route.fulfill({ json: { data: { items: [row], total: 1, page: 1, pageSize: 10 } } }));
  await page.route('**/api/business/organizations/*/commission-payments**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/invoicing-fee-review')) {
      const body = route.request().postDataJSON(); reviews.push(body);
      if (reviews.length === 1) return route.fulfill({ status: 503, json: { error: { code: 'REVIEW_RESPONSE_LOST', message: 'Fee review response unavailable. Retry the saved evidence.' } } });
      payment = { ...payment, feeEvidence: 'merchant_reviewed', invoicingFeeCents: body.invoicingFeeCents,
        feeReview: { invoicingFeeCents: body.invoicingFeeCents, evidenceReference: body.evidenceReference, reason: body.reason,
          reviewedAt: '2026-10-02T12:00:00Z', reviewedByUserId: fixture.accounts.business.id },
        actualFeeCents: 667, verifiedNetCents: 633, residualCents: 567, netSettlementStatus: 'net_shortfall' };
      row = { ...row, unpaidCommissionCents: 567, reservedCommissionCents: 0, payableCommissionCents: 567, paidCommissionCents: 633,
        payment: { paymentId, status: payment.status, netSettlementStatus: payment.netSettlementStatus, feeEvidence: payment.feeEvidence },
        latestPaymentAttempt: { paymentId, status: payment.status, netSettlementStatus: payment.netSettlementStatus } };
      return route.fulfill({ json: { data: payment } });
    }
    if (path.endsWith('/quote')) {
      quotes.push(route.request().postDataJSON());
      return route.fulfill({ json: { data: { recipientUserId: recipient, currency: 'USD', statementIds: [statementId],
        statements: [{ id: statementId, eventTitle: row.eventTitle, currency: 'USD', amountCents: 567 }],
        installmentFingerprint: 'a'.repeat(64), commissionCents: 567, estimatedFeeCents: 100, totalCents: 667 } } });
    }
    if (route.request().method() === 'POST' && path.endsWith('/commission-payments')) {
      payments.push(route.request().postDataJSON());
      return route.fulfill({ json: { data: { paymentId: residualPaymentId, currency: 'USD', status: 'awaiting_payment',
        providerVerificationStatus: 'verified', fundsReceived: false, feeEvidence: null, commissionCents: 567, totalCents: 667,
        actualFeeCents: null, verifiedNetCents: null, hostedInvoiceUrl: 'https://invoice.stripe.com/i/offline-residual' } } });
    }
    if (route.request().method() === 'GET' && path.endsWith(`/${paymentId}`)) return route.fulfill({ json: { data: payment } });
    throw new Error(`Unexpected offline commission operation: ${route.request().method()} ${path}`);
  });
  await loginViaApi(page, fixture, 'business', 'business', `/?section=payments&paymentOrganization=${fixture.ids.org}`);
  const openPayment = async () => {
    await page.getByRole('button', { name: 'View payment for Audited fee-review statement', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Commission payment', exact: true });
    await expect(modal.getByRole('form', { name: 'Merchant processing-fee review' })).toBeVisible();
    await expect(modal.locator('.commission-quote-statements')).toContainText('$12.00');
    return modal;
  };
  await test.step('received funds hide the stale invoice and audited fee evidence needs explicit confirmation', async () => {
    const dialog = await openPayment();
    await expect(dialog.getByRole('link', { name: /Pay from business/ })).toHaveCount(0);
    await expect(dialog.getByText('Processing fees', { exact: true }).locator('..')).toHaveText('Processing feesAwaiting fee evidence');
    await expect(dialog.getByLabel('Processing fees (USD)', { exact: true })).toBeEmpty();
    await expect(dialog.getByRole('button', { name: 'Record merchant fee review' })).toBeDisabled();
    await dialog.getByLabel('Processing fees (USD)', { exact: true }).fill('6.67');
    await dialog.getByLabel('Evidence reference', { exact: true }).fill('Stripe invoicing statement INV-823');
    await dialog.getByRole('textbox', { name: 'Reason for fee review', exact: true }).fill('Finance reviewed the invoicing fee statement for this paid commission.');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Record merchant fee review' }).click();
    await expect(dialog.getByRole('alert')).toContainText('response unavailable');
    expect(reviews).toHaveLength(1); expect(reviews[0].invoicingFeeCents).toBe(567);
    expect(payments).toHaveLength(0); expect(quotes).toHaveLength(0);
  });
  await test.step('reload retains immutable evidence, reauthorizes its retry and records only merchant-reviewed net', async () => {
    await page.reload();
    const dialog = await openPayment();
    await expect(dialog.getByLabel('Processing fees (USD)', { exact: true })).toHaveValue('6.67');
    await expect(dialog.getByLabel('Evidence reference', { exact: true })).toHaveValue('Stripe invoicing statement INV-823');
    // The wrapping label contains the textarea's restored text; its accessible
    // textbox name stays stable while an exact label-text lookup does not.
    const reason = dialog.getByRole('textbox', { name: 'Reason for fee review', exact: true });
    await expect(reason).toHaveValue('Finance reviewed the invoicing fee statement for this paid commission.');
    for (const name of ['Processing fees (USD)', 'Evidence reference']) await expect(dialog.getByLabel(name, { exact: true })).toBeDisabled();
    await expect(reason).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Retry saved fee review' })).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Retry saved fee review' }).click();
    await expect(dialog.getByText('Merchant-reviewed fees · residual commission owed', { exact: true })).toBeVisible();
    expect(reviews).toHaveLength(2); expect(reviews[1]).toEqual(reviews[0]);
    await expect(dialog.getByText('Stripe net · merchant reviewed', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Processing fees', { exact: true }).locator('..')).toHaveText('Processing fees$6.67');
    await expect(dialog.getByText('Provider-verified Stripe net', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Net credit verified', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('form', { name: 'Merchant processing-fee review' })).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: /Pay from business/ })).toHaveCount(0);
    await expect(dialog.getByText(/fresh quote and separate approval/)).toBeVisible();
    await expect(dialog.getByText('Evidence reference: Stripe invoicing statement INV-823', { exact: true })).toBeVisible();
    expect(payments).toHaveLength(0); expect(quotes).toHaveLength(0);
    await expectNoOverflow(page);
    const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
    expect(bounds.width).toBeLessThanOrEqual(viewport.width - 8); expect(bounds.height).toBeLessThanOrEqual(viewport.height - 8);
    await page.screenshot({ path: testInfo.outputPath('audited-merchant-fee-review.png') });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  });
  await test.step('the residual requires a fresh quote, a separate approval and a distinct payment identity', async () => {
    const select = page.getByRole('checkbox', { name: /Alex Individual at Audited fee-review statement/ });
    await expect(select).toBeEnabled(); await select.check();
    await page.getByRole('button', { name: 'Pay 1 selected statement', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Confirm commission payment', exact: true });
    await expect(confirmation.locator('dl').getByText('$5.67', { exact: true })).toBeVisible();
    await expect(confirmation.getByText('$6.67', { exact: true })).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'Create approved Stripe payment' })).toBeDisabled();
    expect(payments).toHaveLength(0); expect(quotes).toHaveLength(1);
    await confirmation.getByRole('checkbox').check();
    await confirmation.getByRole('button', { name: 'Create approved Stripe payment' }).click();
    const dialog = page.getByRole('dialog', { name: 'Commission payment', exact: true });
    await expect(dialog.getByRole('link', { name: /Pay from business/ })).toHaveAttribute('href', 'https://invoice.stripe.com/i/offline-residual');
    expect(payments).toHaveLength(1); expect(payments[0].statementIds).toEqual([statementId]);
    expect(payments[0].approvedTotalCents).toBe(667); expect(payments[0].feeEstimateAcknowledged).toBe(true);
    expect(payments[0].idempotencyKey).not.toBe(reviews[0].idempotencyKey);
    await expectNoOverflow(page);
  });
});
