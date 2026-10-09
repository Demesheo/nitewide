// Let the app's genuine pre-payment safety check run once. Only later browser
// reconciliation is held so the sandbox's signed webhook must issue admission.
async function installBrowserVerificationGate(page, { base, orderId }) {
  const url = `${base}/api/customer/payment-checkouts/${encodeURIComponent(orderId)}/verify`;
  let precheck = 'waiting', reason = null, httpStatus = null, requests = 0, blockedRequests = 0;
  const handler = async route => {
    if (route.request().url() !== url || route.request().method() !== 'POST') return route.continue();
    requests += 1;
    if (precheck !== 'waiting') {
      blockedRequests += 1;
      return route.fulfill({ status: 503, json: { error: { message: 'Awaiting the sandbox webhook check.' } } });
    }
    precheck = 'running';
    try {
      const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
      const status = response.status();
      httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
      let payload;
      try { payload = await response.json(); } catch { reason = 'invalid-response'; }
      if (!reason) {
        if (status !== 200) reason = 'http-status';
        else if (payload?.data?.orderId !== orderId) reason = 'order-mismatch';
        else if (payload.data.status !== 'pending') reason = 'not-pending';
        else if (payload.data.verificationStatus === 'review') reason = 'review';
        else if (payload.data.retryable === true) reason = 'retryable';
      }
      // An uncertain pending response could otherwise let the app confirm
      // before the runner observes rejection. Fail closed, never fake pending.
      if (reason) {
        precheck = 'rejected';
        await route.abort('failed');
        return;
      }
      await route.fulfill({ response });
      precheck = 'passed';
    } catch {
      precheck = 'failed'; reason = 'request-failed';
      await route.abort('failed').catch(() => {});
    }
  };
  await page.route(url, handler);
  return {
    ready() {
      if (precheck === 'failed' || precheck === 'rejected') {
        throw Object.assign(new Error('The genuine sandbox pre-payment check did not confirm this pending order.'), { code: 'SANDBOX_PRECHECK_FAILED' });
      }
      return precheck === 'passed';
    },
    // Fixed enums/counts only: no URLs, order IDs, response bodies or messages.
    snapshot: () => ({ precheck, reason, httpStatus, requests, blockedRequests }),
    release: () => page.unroute(url, handler),
  };
}

module.exports = { installBrowserVerificationGate };
