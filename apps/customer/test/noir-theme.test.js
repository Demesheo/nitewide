import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isPremiumHost } from '../src/lib/premium-host.js';

test('Premium treatment requires an explicit server entitlement', () => {
  assert.equal(isPremiumHost({ isPremiumHost: true }), true);
  for (const event of [null, {}, { isPremiumHost: false }, { isPremiumHost: 'true' }, { category: 'vip' }, { organization: { name: 'Premium Club' } }]) {
    assert.equal(isPremiumHost(event), false);
  }
});
test('Noir theme loads after responsive layout and preserves QR readability and touch targets', async () => {
  const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.ok(main.indexOf('./noir-theme.css') > main.indexOf('./mobile.css'));
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  assert.match(css, /\.premium-host-card\s*\{[^}]*border-color: var\(--noir-gold-border\)/);
  assert.match(css, /\.pass-code img\s*\{\s*background: #fff/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /@supports not \(backdrop-filter/);
  assert.doesNotMatch(css, /animation:.*infinite/);
});
test('soft nightlife accents, reflective panels and dialog glass retain accessible fallbacks', async () => {
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  assert.match(css, /--noir-action:\s*linear-gradient\(180deg, #594763, #493751\)/);
  assert.match(css, /--noir-dialog:\s*radial-gradient/);
  assert.match(css, /\[data-slot="dialog-content"\], \.account-modal\[data-slot="dialog-content"\]\s*\{\s*background: var\(--noir-dialog\)/);
  assert.match(css, /\.event-card, \.purchase-card, \.circle-grid article, \.search-bar, \.vip-copy, \.expanded-filters\s*\{[^}]*backdrop-filter: blur\(8px\)/);
  assert.match(css, /\.event-card\.premium-host-card, \.purchase-card\.premium-host-card\s*\{[^}]*box-shadow: var\(--noir-gold-glow\)/);
  assert.match(css, /--noir-gold-glow:.*0 0 34px/);
  assert.match(css, /prefers-reduced-transparency: reduce\)[\s\S]*\.skeleton-card \{ background: #100d16; backdrop-filter: none/);
  assert.match(css, /--noir-panel:.*#0b0a10e0/);
  assert.match(css, /--noir-panel-shadow:.*inset 0 1px 8px/);
  assert.match(css, /\.admission-pass \{ background: var\(--noir-panel\); color: var\(--text-primary\)/);
});
test('quiet primary controls keep readable labels and clear focus/selection states', async () => {
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  const luminance = (hex) => {
    const rgb = hex.match(/\w{2}/g).map(v => parseInt(v, 16) / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const name of ['noir-action', 'noir-action-hover']) {
    const value = css.match(new RegExp(`--${name}: ([^;]+);`))[1];
    for (const hex of value.match(/#[0-9a-f]{6}/g)) {
      assert.ok(1.05 / (luminance(hex.slice(1)) + .05) >= 4.5, `${name} white label contrast`);
    }
  }
  assert.match(css, /--noir-control-shadow:.*inset.*0 0 10px/);
  assert.match(css, /--noir-dialog-shadow:.*inset.*0 0 28px/);
  assert.match(css, /button:focus-visible[\s\S]*outline: 2px solid var\(--highlight\)/);
  assert.match(css, /\.offering\[aria-pressed="true"\]/);
});
