import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
test('account tabs retain a stable viewport height and transitions respect reduced motion', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
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
