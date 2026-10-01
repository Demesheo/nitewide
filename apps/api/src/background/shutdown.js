// A referenced deadline also covers promises that never settle after the last
// socket has closed. Leased jobs recover on the next worker after forced exit.
function createWorkerShutdown({ runtime, sequelize, diagnostics, timeoutMs = 30000, exit = code => process.exit(code) }) {
  let closing;
  return function shutdown(initialCode = 0) {
    if (closing) return closing;
    closing = new Promise(resolve => {
      let finished = false;
      function finish(code, outcome) {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        diagnostics.log('worker_shutdown', { outcome }, code ? 'error' : 'info');
        resolve(code);
        exit(code);
      }
      const deadline = setTimeout(() => finish(1, 'forced'), timeoutMs);
      Promise.resolve().then(() => runtime.stop()).then(() => sequelize.close())
        .then(() => finish(initialCode === 1 ? 1 : 0, initialCode === 1 ? 'error' : 'ok'), () => finish(1, 'error'));
    });
    return closing;
  };
}
module.exports = { createWorkerShutdown };
