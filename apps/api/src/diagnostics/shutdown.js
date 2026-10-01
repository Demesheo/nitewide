function createShutdown({ server, sequelize, health, diagnostics, timeoutMs = 30000, exit = code => process.exit(code) }) {
  let closing;
  return function shutdown(initialCode = 0) {
    if (closing) return closing;
    // Signal listeners pass a signal name, not an exit code. Only an explicit
    // failure requested by the startup/runtime caller changes graceful exit.
    const failureCode = initialCode === 1 ? 1 : 0;
    health.drain();
    closing = new Promise(resolve => {
      let finished = false;
      function finish(code, outcome) {
        if (finished) return; finished = true; clearTimeout(deadline);
        diagnostics.log('api_shutdown', { outcome }, code ? 'error' : 'info');
        resolve(code); exit(code);
      }
      // Keep this deadline referenced: it must fire even when only a stuck DB
      // close promise remains. A failed graceful drain must not hang forever.
      const deadline = setTimeout(() => { server.closeAllConnections?.(); finish(1, 'forced'); }, timeoutMs);
      server.close(async closeError => {
        try { await sequelize.close(); finish(closeError || failureCode ? 1 : 0, closeError || failureCode ? 'error' : 'ok'); }
        catch { finish(1, 'error'); }
      });
      server.closeIdleConnections?.();
    });
    return closing;
  };
}
module.exports = { createShutdown };
