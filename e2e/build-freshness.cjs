const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const markerName = '.nitewide-e2e-build.json';
// Local per-app evidence only. A normal production build removes this marker,
// and CI/full browser runs always rebuild regardless of its contents.
function fingerprintPaths(root, names, ignored = new Set()) {
  const hash = crypto.createHash('sha256');
  function visit(relative) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) { hash.update(`missing:${relative}\n`); return; }
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Linked build inputs cannot prove freshness.');
    hash.update(JSON.stringify(relative));
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) if (!ignored.has(name)) visit(path.join(relative, name));
    } else if (stat.isFile()) { hash.update(String(stat.size)); hash.update(fs.readFileSync(file)); }
    else throw new Error('Unsupported build input.');
  }
  try { for (const name of names) visit(name); return hash.digest('hex'); }
  catch { return null; }
}
function inputFingerprint(root, app, environment) {
  // Cross-app imports (including Admin/Business venue UI and Customer styles)
  // make every frontend source tree and shared component a build input.
  const files = ['package.json', 'package-lock.json', 'e2e/environment.cjs', 'e2e/run.cjs', 'e2e/build-freshness.cjs',
    ...['customer', 'business', 'admin'].map(frontend => `apps/${frontend}`), 'apps/pricing', 'apps/shared',
    ...fs.readdirSync(root).filter(name => name.startsWith('.env') || name === '.npmrc').sort()];
  const content = fingerprintPaths(root, files, new Set(['dist', 'node_modules', 'test', '.git']));
  if (!content) return null;
  const buildVariables = Object.keys(environment).filter(key => key.startsWith('VITE_') || ['NODE_ENV', 'NITEWIDE_API_PROXY'].includes(key))
    .sort().map(key => [key, environment[key]]);
  return crypto.createHash('sha256').update(JSON.stringify([content, process.version, process.platform, process.arch, buildVariables])).digest('hex');
}
function outputFingerprint(root, app) {
  const dist = path.join(root, 'apps', app, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) return null;
  return fingerprintPaths(dist, ['.'], new Set([markerName]));
}
function isBuildFresh(root, app, input) {
  if (!input) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(root, 'apps', app, 'dist', markerName), 'utf8'));
    return marker.version === 1 && marker.input === input && typeof marker.output === 'string'
      && /^[a-f0-9]{64}$/.test(marker.output) && marker.output === outputFingerprint(root, app);
  } catch { return false; }
}
function recordBuild(root, app, input) {
  const output = outputFingerprint(root, app);
  if (!input || !output) return;
  fs.writeFileSync(path.join(root, 'apps', app, 'dist', markerName), JSON.stringify({ version: 1, input, output }) + '\n');
}
module.exports = { markerName, fingerprintPaths, inputFingerprint, outputFingerprint, isBuildFresh, recordBuild };
