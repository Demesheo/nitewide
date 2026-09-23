import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('workspace and data views expose visible, accessible loading feedback', () => {
  const loader = read('src/components/LoadingState.jsx');
  assert.match(loader, /role="status" aria-live="polite"/);
  assert.match(loader, /nw-loading-icon/);
  for (const file of ['App.jsx', 'components/EventDetail.jsx', 'components/Guestlists.jsx', 'components/Analytics.jsx', 'components/Team.jsx']) {
    assert.match(read(`src/${file}`), /<LoadingState/);
  }
});

test('motion is restrained and can be disabled for reduced-motion users', () => {
  const css = read('src/styles.css');
  assert.match(css, /@keyframes nw-enter/);
  assert.match(css, /\.nw-loading-icon \{[^}]*animation: spin/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration: 0\.01ms !important/);
});
