import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isPremiumHost } from '../src/lib/premium-host.js';

test('navigation and booking tabs retain sliding selection, touch targets and reduced motion', async () => {
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  assert.match(css, /nav\[data-view="booked"\] \{ --tab-index: 1/);
  assert.match(css, /nav\[data-view="saved"\] \{ --tab-index: 2/);
  assert.match(css, /\.booking-tabs:has\([^\n]+--tab-index: 1/);
  assert.match(css, /transform: translateX\(calc\(var\(--tab-index\) \* 100%\)\)/);
  assert.match(css, /min-height: 44px;[^}]*background: transparent; border: 0; box-shadow: none/);
  assert.match(css, /prefers-reduced-motion: reduce\)[^}]+\.booking-tabs::before \{ transition: none/);
});

test('Premium treatment requires an explicit server entitlement', () => {
  assert.equal(isPremiumHost({ isPremiumHost: true }), true);
  for (const event of [null, {}, { isPremiumHost: false }, { isPremiumHost: 'true' }, { category: 'vip' }, { organization: { name: 'Premium Club' } }]) {
    assert.equal(isPremiumHost(event), false);
  }
});
test('opened Premium event uses the same gold glow as its listing card', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  assert.match(app, /className=\{`event-modal\$\{isPremiumHost\(selected\) \? ' premium-host-card' : ''\}`\}/);
  assert.match(css, /\.event-modal\.premium-host-card\[data-slot="dialog-content"\]\s*\{[^}]*box-shadow: var\(--noir-gold-glow\)/);
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
  const glass = css.match(/\.signin-button\[data-slot="button"\], \.search-submit\[data-slot="button"\], \.dark-glass-action\[data-slot="button"\] \{([^}]+)\}/)?.[1];
  assert.ok(glass);
  assert.doesNotMatch(glass, /\b(?:width|height|padding|border-radius):/);
  const icon = css.match(/\.step-icon \{([^}]+)\}/)?.[1];
  assert.ok(icon);
  assert.doesNotMatch(icon, /\b(?:width|height|padding|border-radius):/);
});
test('dialog glass and pass panels retain readable content and accessible fallbacks', async () => {
  const css = await readFile(new URL('../src/noir-theme.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /--noir-dialog:[^;]*#ffffff/);
  assert.match(css, /\.detail-art img\.uploaded-artwork \{ background: transparent/);
  assert.match(css, /\[data-slot="dialog-content"\], \.account-modal\[data-slot="dialog-content"\]\s*\{\s*background: var\(--noir-dialog\)/);
  assert.match(css, /\.event-card\.premium-host-card, \.purchase-card\.premium-host-card\s*\{[^}]*box-shadow: var\(--noir-gold-glow\)/);
  assert.match(css, /prefers-reduced-transparency: reduce\)[\s\S]*\.skeleton-card \{ background: #100d16; backdrop-filter: none/);
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
  assert.match(css, /button:focus-visible[\s\S]*outline: 2px solid var\(--highlight\)/);
  assert.match(css, /\.offering\[aria-pressed="true"\]/);
});

test('customer loads mobile-only enhancements after the base theme', async () => {
  const entry = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.ok(entry.indexOf('./mobile.css') > entry.indexOf('./styles.css'));
  const css = await readFile(new URL('../src/mobile.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /100dvh - env\(safe-area-inset-top\)/);
  assert.match(css, /overscroll-behavior-y: contain/);
  assert.match(css, /position: sticky; order: -1/);
});
test('viewport supports safe areas without disabling customer zoom', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
});
test('dialogs retain touch-sized close controls, stable account height and reduced motion', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.event-modal\[data-event-stage="details"\] > \[data-slot="dialog-close"\]\s*\{[^}]*width: 44px;[^}]*height: 44px;[^}]*border-radius: 50%;[^}]*opacity: 1;/);
  assert.match(css, /\.account-modal\[data-slot="dialog-content"\]\s*\{[^}]*height: 90dvh/);
  assert.match(css, /scrollbar-gutter: stable/);
  assert.match(css, /@keyframes customer-reveal/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
test('viewport-filling page layout preserves full-width constrained content', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /#root > \.wrap\s*\{\s*width: 100%/);
  assert.match(css, /\.wrap\s*\{[^}]*max-width: 1264px/);
});
