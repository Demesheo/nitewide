const { spawn } = require('node:child_process');
const path = require('node:path');

// Compatibility for the free demo: two OS processes, not API timers. Real
// production runs these commands in independently scaled services.
function supervise({ spawnImpl = spawn, graceMs = 160000, onExit = code => { process.exitCode = code; } } = {}) {
  const children = new Set(); let closing = false, exitCode = 0, deadline;
  const stop = (code = 0) => {
    if (closing) return; closing = true; exitCode = code;
    for (const child of children) child.kill('SIGTERM');
    deadline = setTimeout(() => { exitCode = 1; for (const child of children) child.kill('SIGKILL'); }, graceMs);
    deadline.unref();
    if (!children.size) finish();
  };
  function finish() { clearTimeout(deadline); process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', interrupt); onExit(exitCode); }
  const terminate = () => stop(), interrupt = () => stop();
  process.once('SIGTERM', terminate); process.once('SIGINT', interrupt);
  for (const entry of ['server.js', 'worker.js']) {
    const child = spawnImpl(process.execPath, [path.resolve(__dirname, '../apps/api/src', entry)], { env: process.env, stdio: 'inherit' });
    children.add(child);
    child.once('error', () => stop(1));
    child.once('close', () => { children.delete(child); if (!closing) stop(1); if (!children.size) finish(); });
  }
  return { stop };
}
module.exports = { supervise };
