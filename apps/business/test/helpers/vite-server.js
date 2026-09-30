import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

// Each instance gets its own cache: neither another test worker nor a running
// dev server can replace the dependency metadata used by this test.
export async function createTestServer(options, create = createServer) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'nitewide-vite-test-'));
  let server;
  try {
    server = await create({ ...options, cacheDir });
  } catch (error) {
    await rm(cacheDir, { recursive: true, force: true });
    throw error;
  }
  const close = server.close.bind(server);
  let closing;
  server.close = () => {
    // Preserve Vite's idempotent close behavior and await cleanup, even if
    // closing the server fails. Only remove the directory we just created.
    closing ??= Promise.resolve().then(close).finally(() => rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    return closing;
  };
  return server;
}
