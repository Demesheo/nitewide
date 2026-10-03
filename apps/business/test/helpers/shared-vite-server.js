import { after } from 'node:test';
import { createTestServer } from './vite-server.js';

// Related cases share transformed modules; each case still owns its DOM,
// rendered roots, requests and globals. Close the server even after a failure.
export function sharedTestServer() {
  let pending;
  after(async () => {
    if (!pending) return;
    const [result] = await Promise.allSettled([pending]);
    if (result.status === 'fulfilled') await result.value.close();
  });
  return (options) => pending ??= createTestServer(options);
}
