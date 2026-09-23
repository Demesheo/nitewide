import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Overview performance shows sales before orders on both layouts, with compact mobile labels', () => {
  const component = read('src/components/TeamPerformanceTable.jsx');
  const desktop = component.slice(component.indexOf('performance-desktop-table'), component.indexOf('performance-mobile-table'));
  const mobile = component.slice(component.indexOf('performance-mobile-table'), component.indexOf('{!filtered.length'));
  assert.match(desktop, /head\('Name', 'name'\)/);
  assert.ok(desktop.indexOf("head('Attributed sales', 'salesCents')") < desktop.indexOf("head('Paid orders', 'orders')"));
  assert.match(mobile, /head\('Name', 'name'\)/);
  assert.ok(mobile.indexOf("head('Sales', 'salesCents')") < mobile.indexOf("head('Orders', 'orders')"));
  assert.match(component, /\{name\}\{role\}\{sales\}\{orders\}/);
});

test('mobile hides initials and stacks first and last names without changing desktop', () => {
  const css = read('src/mobile.css');
  assert.match(css, /\.team-performance-panel \.performance-desktop-table \{ display: none; \}/);
  assert.match(css, /\.team-performance-panel \.performance-mobile-table \{ display: block; \}/);
  assert.match(css, /\.performance-mobile-table \.person \.avatar \{ display: none; \}/);
  assert.match(css, /\.performance-mobile-table \.performance-name span \{ display: block;/);
  assert.match(read('src/styles.css'), /\.performance-mobile-table \{ display: none; \}/);
});

test('Overview search sits beneath the role filter and filters visible people before pagination', () => {
  const component = read('src/components/TeamPerformanceTable.jsx');
  assert.ok(component.indexOf('<MultiSelect label="Roles"') < component.indexOf('aria-label="Search team performance"'));
  assert.ok(component.indexOf('aria-label="Search team performance"') < component.indexOf('<TeamRows people='));
  assert.match(component, /filterPerformancePeople\(people, selectedRoles\)\.filter/);
  assert.match(component, /\$\{selectedRoles\.join\(','\)\}:\$\{search\}/);
});

test('Overview performance pagination returns to the top of its card', () => {
  const component = read('src/components/TeamPerformanceTable.jsx');
  assert.match(component, /<TablePagination pager=\{pager\} onPageChange=\{onPageChange\}\/>/);
  assert.match(component, /panelRef\.current\?\.scrollIntoView/);
  assert.match(component, /<section ref=\{panelRef\} className="panel team-performance-panel">/);
  assert.match(read('src/styles.css'), /\.team-performance-panel \{[^}]*scroll-margin-top: 76px;/);
});
