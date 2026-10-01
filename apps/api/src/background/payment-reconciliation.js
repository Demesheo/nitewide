// Payment creation/reconciliation is durable and idempotent in the domain
// services. A small independent worker lane recovers lost provider responses
// without dispatching work from API timers or overlapping a previous batch.
function createPaymentReconciliationLane({ paymentCheckouts, refunds, enabled = false, intervalMs = 30000 }) {
  let stopping = false, active;
  function drain() {
    if (!enabled || stopping) return Promise.resolve();
    if (active) return active;
    active = (async () => {
      // At most two provider reconciliation chains at once. Normal completion
      // uses webhooks; this lane is only bounded recovery work.
      const results = await Promise.allSettled([
        paymentCheckouts.sweepReservations({ limit: 1 }), refunds.sweepPendingRefunds({ limit: 1 }),
      ]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    })().finally(() => { active = undefined; });
    return active;
  }
  async function stop() { stopping = true; await active; }
  return { enabled, intervalMs, drain, stop };
}
module.exports = { createPaymentReconciliationLane };
