const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

function abortError(code = 'SANDBOX_INTERRUPTED') {
  return Object.assign(new Error('Sandbox test stopped.'), { code });
}

function createRuntime({ timeoutMs = 600000 } = {}) {
  const controller = new AbortController();
  const interrupt = () => controller.abort(abortError());
  const timer = setTimeout(() => controller.abort(abortError('SANDBOX_TIMEOUT')), timeoutMs);
  timer.unref();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  return { signal: controller.signal, check: () => controller.signal.throwIfAborted(),
    dispose() { clearTimeout(timer); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); } };
}

async function command(args, env, { cwd, signal, timeoutMs = 180000 } = {}) {
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
    let failure, forceTimer;
    const stop = error => {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      forceTimer.unref();
    };
    const abort = () => stop(signal.reason || abortError());
    const timer = setTimeout(() => stop(abortError('SANDBOX_PREREQUISITE_TIMEOUT')), timeoutMs);
    timer.unref();
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); code === 0 && !failure ? resolve() : reject(failure || abortError('SANDBOX_PREREQUISITE_FAILED')); });
  });
}

async function waitFor(work, predicate, label, timeoutMs = 30000, { signal, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const value = await work();
    signal?.throwIfAborted();
    if (await predicate(value)) return value;
    await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())), undefined, { signal });
  }
  throw Object.assign(new Error(label), { code: 'SANDBOX_TIMEOUT' });
}

module.exports = { createRuntime, command, waitFor };
