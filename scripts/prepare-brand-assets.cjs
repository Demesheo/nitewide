// Deterministic web-size copies of the approved logo, with its colors and
// transparency preserved. Regenerate with: node scripts/prepare-brand-assets.cjs
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const sharp = require('sharp');

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'assets/brand/nitewide-logo-source.png');
  for (const app of ['customer', 'business', 'admin']) {
    const directory = path.join(root, 'apps', app, 'src/assets');
    await mkdir(directory, { recursive: true });
    for (const [name, size] of [['logo', 192], ['favicon', 64], ['touch-icon', 180]]) {
      await sharp(source).resize(size, size, { fit: 'contain' }).png({ compressionLevel: 9 })
        .toFile(path.join(directory, `nitewide-${name}-v1.png`));
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
