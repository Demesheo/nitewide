const { spawn } = require('node:child_process');

function assertExecutedTests(summary) {
  const count = (label) => [...summary.matchAll(new RegExp(`^# ${label} (\\d+)\\s*$`, 'gm'))].at(-1)?.[1];
  const tests = count('tests');
  const skipped = count('skipped');
  const cancelled = count('cancelled');
  const todo = count('todo');
  if (!tests || Number(tests) < 1 || skipped === undefined || Number(skipped) !== 0 || cancelled === undefined || Number(cancelled) !== 0 || todo === undefined || Number(todo) !== 0) {
    throw new Error('A required test suite did not execute its tests without skips or cancellations. Standard coverage cannot be optional.');
  }
}

function createProcessSupervisor({ cwd, spawnProcess = spawn, killProcess = process.kill.bind(process), processGroupExists, platform = process.platform, stdout = process.stdout, terminationGraceMillis = 5000, killGraceMillis = 5000 } = {}) {
  const active = new Set();
  let stopped = null;
  let shutdown = null;

  function groupExists(entry) {
    if (platform === 'win32' || !entry.handle.pid) return false;
    if (processGroupExists) return processGroupExists(entry.handle.pid);
    try { killProcess(-entry.handle.pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  }

  function signal(entry, value) {
    if (entry.closed || !entry.handle.pid) return;
    try {
      if (platform === 'win32') entry.handle.kill(value);
      else killProcess(-entry.handle.pid, value);
    } catch (error) {
      if (error.code !== 'ESRCH') entry.signalError = error;
    }
  }

  function run(command, args, environment, { requireExecutedTests = false, scope = '' } = {}) {
    if (stopped) return Promise.reject(new Error('Test run stopped before starting another command.'));
    return new Promise((resolve, reject) => {
      let handle;
      try {
        handle = spawnProcess(command, args, { cwd, stdio: requireExecutedTests ? ['inherit', 'pipe', 'inherit'] : 'inherit', env: environment, detached: platform !== 'win32' });
      } catch (error) { reject(error); return; }
      let close;
      const entry = { handle, scope, closed: false, rejectRun: reject, closePromise: new Promise((resolveClose) => { close = resolveClose; }) };
      active.add(entry);
      let summary = '';
      if (requireExecutedTests) handle.stdout.on('data', (chunk) => {
        stdout.write(chunk);
        summary = (summary + chunk.toString()).slice(-65536);
      });
      handle.once('error', (error) => { entry.error = error; });
      handle.once('close', async (status, exitSignal) => {
        // npm can leave a grandchild behind after its own close event. Keep
        // ownership of the whole process group until it has exited too.
        try {
          if (groupExists(entry)) {
            signal(entry, 'SIGTERM');
            const started = Date.now();
            let escalated = false;
            while (groupExists(entry)) {
              const elapsed = Date.now() - started;
              if (!escalated && elapsed >= terminationGraceMillis) { signal(entry, 'SIGKILL'); escalated = true; }
              if (elapsed >= terminationGraceMillis + killGraceMillis) throw new Error('A test process group survived shutdown; its database was retained.');
              await new Promise((done) => setTimeout(done, 25));
            }
          }
        } catch (error) { reject(error); return; }
        entry.closed = true;
        active.delete(entry);
        close();
        if (entry.error) return reject(entry.error);
        if (stopped || status !== 0) return reject(new Error(exitSignal ? `Test command interrupted by ${exitSignal}.` : stopped ? 'Test run stopped.' : `Test command exited with status ${status}.`));
        try {
          if (requireExecutedTests) assertExecutedTests(summary);
          resolve();
        } catch (error) { reject(error); }
      });
    });
  }

  function stop(reason = 'Test run stopped.') {
    stopped ||= reason;
    if (shutdown) return shutdown;
    shutdown = (async () => {
      const children = [...active];
      if (!children.length) return;
      for (const entry of children) signal(entry, 'SIGTERM');
      let escalation;
      let deadline;
      try {
        await Promise.race([
          Promise.all(children.map((entry) => entry.closePromise)),
          new Promise((_, reject) => {
            escalation = setTimeout(() => {
              for (const entry of children) signal(entry, 'SIGKILL');
            }, terminationGraceMillis);
            deadline = setTimeout(() => reject(new Error('Test process shutdown timed out. Databases used by running children were retained for safe cleanup.')), terminationGraceMillis + killGraceMillis);
          }),
        ]);
      } catch (error) {
        // Reject command waits after the bounded shutdown deadline, while
        // retaining ownership of live groups so database cleanup fails closed.
        for (const entry of active) {
          entry.rejectRun(error);
          entry.handle.unref?.();
          entry.handle.stdout?.destroy?.();
          entry.handle.stderr?.destroy?.();
        }
        throw error;
      } finally {
        clearTimeout(escalation);
        clearTimeout(deadline);
      }
    })();
    return shutdown;
  }

  function forceStop() {
    for (const entry of active) signal(entry, 'SIGKILL');
  }

  function assertScopeStopped(scope) {
    if ([...active].some((entry) => entry.scope === scope)) {
      throw new Error('Refusing to drop a test database while its test or migration child is still running.');
    }
  }

  return { run, stop, forceStop, assertScopeStopped, get stopped() { return stopped; }, get activeCount() { return active.size; } };
}

module.exports = { assertExecutedTests, createProcessSupervisor };
