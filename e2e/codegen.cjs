const { build, run } = require('./run.cjs');
const { start, shutdown } = require('./server.cjs');
const { urls } = require('./environment.cjs');
const { mkdir } = require('node:fs/promises');
async function main() {
  const app = process.argv[2] || 'customer';
  if (!['customer', 'business', 'admin'].includes(app)) throw new Error('Choose customer, business or admin. Arbitrary URL targets are forbidden.');
  await build(); await start();
  for (const url of [urls.customer, urls.business, urls.admin]) {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(url)).ok; } catch { /* Preview starting. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Isolated preview did not start.');
  }
  await mkdir('test-results', { recursive: true });
  console.log('Record only on these disposable apps. Demo password: NitewideDemo!2026; emails: jordan/sam/admin@playwright.nitewide.test.');
  const target = app === 'business' ? `${urls.business}/` : urls[app];
  await run(process.execPath, [require.resolve('@playwright/test/cli'), 'codegen', '--device=iPhone 13', '--browser=webkit', '--timezone=America/New_York', '--block-service-workers', '--output', `test-results/codegen-${app}.spec.js`, target]);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => shutdown(process.exitCode || 0));
