function createHealth({ check, timeoutMs = 3000 }) {
  let draining = false, inFlight;
  async function ready() {
    if (draining) return false;
    // Single flight prevents health probes from filling the DB pool when an
    // injected/network probe hangs. The original query remains bounded by PG.
    if (!inFlight) {
      const running = Promise.resolve().then(check).then(() => true, () => false);
      inFlight = running;
      running.finally(() => { if (inFlight === running) inFlight = undefined; });
    }
    let timer;
    const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
    try { return !draining && await Promise.race([inFlight, deadline]) && !draining; }
    finally { clearTimeout(timer); }
  }
  return { ready, drain() { draining = true; }, get draining() { return draining; } };
}
module.exports = { createHealth };
