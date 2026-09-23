import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import postcss from 'postcss';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = postcss.parse(read('src/mobile.css'));
const componentModule = { exports: {} };
vm.runInNewContext(transformSync(read('src/components/MobileTableSort.jsx'), { loader: 'jsx', format: 'cjs' }).code, { module: componentModule, exports: componentModule.exports, React });
const { MobileTableSort } = componentModule.exports;
const columns = [{ key: 'name', label: 'Name' }, { key: 'sales', label: 'Sales' }];

test('mobile sorting renders all columns and announces the inverse sort action', () => {
  const html = renderToStaticMarkup(React.createElement(MobileTableSort, { columns, value: 'sales', descending: true, onChange() {}, onToggle() {} }));
  assert.match(html, /aria-label="Sort table by"/);
  assert.match(html, /value="name">Name/);
  assert.match(html, /value="sales" selected="">Sales/);
  assert.match(html, /aria-label="Sort ascending"/);
  assert.match(html, /type="button"/);
});

test('mobile sorting delegates to the table state without submitting a form', () => {
  let selected; let toggled = 0;
  const tree = MobileTableSort({ columns, value: 'name', descending: false, onChange: key => { selected = key; }, onToggle: () => { toggled++; } });
  const [label, button] = tree.props.children;
  label.props.children[1].props.onChange({ target: { value: 'sales' } });
  button.props.onClick();
  assert.equal(selected, 'sales');
  assert.equal(toggled, 1);
  assert.equal(button.props['aria-label'], 'Sort descending');
});

test('responsive overrides are scoped below desktop and preserve zoom and safe areas', () => {
  for (const node of css.nodes) {
    if (node.type === 'comment') continue;
    if (node.type === 'rule') {
      assert.equal(node.selector, '.mobile-bottom-nav, .table-mobile-sort');
      assert.equal(node.nodes[0].value, 'none');
    } else {
      assert.equal(node.name, 'media');
      assert.match(node.params, /max-width: (850|600|420)px|prefers-reduced-motion/);
    }
  }
  assert.match(read('index.html'), /viewport-fit=cover/);
  assert.doesNotMatch(read('index.html'), /user-scalable=no|maximum-scale=1/);
  assert.match(read('src/mobile.css'), /safe-area-inset-bottom/);
  assert.match(read('src/mobile.css'), /100dvh/);
});

test('operational tables share phone sorting and labeled cells without dropping pagination', () => {
  for (const file of ['EventTable', 'Team', 'Guestlists']) {
    const source = read(`src/components/${file}.jsx`);
    assert.match(source, /<MobileTableSort/);
    assert.match(source, /responsive-event-table/);
    assert.match(source, /data-label=/);
    assert.match(source, /<TablePagination/);
  }
});

test('mobile navigation uses the same authorized destinations and accessible dialog as desktop', () => {
  const source = read('src/App.jsx');
  assert.match(source, /navigation\.filter\(\(\[id\]\) => id !== 'team' \|\| canManageTeam\)/);
  assert.equal((source.match(/visibleNavigation\.map\(/g) || []).length, 2);
  assert.match(source, /<Dialog open=\{mobileNav\}/);
  assert.match(source, /onCloseAutoFocus=/);
  assert.match(source, /menuTrigger\.current\?\.focus\(\)/);
  assert.match(source, /screen\.removeEventListener\("change", closeOnDesktop\)/);
});

test('active event timeline tab gets a focused accent glow without changing other tabs', () => {
  const source = read('src/styles.css');
  assert.match(source, /\.event-library \[data-slot="tabs-trigger"\]\[data-state="active"\] \{[^}]*box-shadow: 0 0 0 1px #[0-9a-f]+, 0 0 14px #[0-9a-f]+;/i);
});

test('event collection cards show status in the header and omit duplicate date/status rows on mobile', () => {
  const component = read('src/components/Events.jsx');
  const styles = read('src/mobile.css');
  assert.match(component, /event-list-name"><span className="event-mobile-status"[\s\S]*event-calendar[\s\S]*event-list-meta/);
  assert.match(component, /className:'event-date-cell'/);
  assert.match(component, /className:'event-status-cell'/);
  assert.match(styles, /\.event-library-table \.event-mobile-status \{ display: flex; justify-content: flex-end; grid-column: 2; grid-row: 1; \}/);
  assert.match(styles, /\.event-library-table \.event-calendar \{ grid-column: 1; grid-row: 1; flex-direction: row; align-items: baseline;/);
  assert.match(styles, /\.event-library-table \.event-calendar small, \.event-library-table \.event-calendar strong \{ display: block; line-height: 1\.2; \}/);
  assert.match(styles, /\.event-library-table \.event-list-meta \{ grid-column: 1 \/ -1; grid-row: 2;/);
  assert.match(styles, /\.event-library-table \.responsive-event-table td\[data-label="Orders"\] \{ text-align: right; \}/);
  assert.match(component, /className:'event-access-cell'/);
  assert.match(styles, /\.event-library-table \.event-date-cell, \.event-library-table \.event-status-cell, \.event-library-table \.event-access-cell \{ display: none !important; \}/);
  assert.match(styles, /\.event-library-table \.event-details-cell::before \{ display: none !important; \}/);
  assert.match(styles, /\.event-library-table \.event-details-cell \{ grid-column: 1 \/ -1; display: flex !important; justify-content: flex-end; padding-top: 10px !important; \}/);
  assert.match(styles, /\.event-library-table \.event-open-button \{ min-width: 0 !important; min-height: 0 !important; height: auto; gap: 4px; padding: 3px 7px; border: 1px solid #65496f; border-radius: 5px; background: #30243a;/);
  assert.match(component, /className="status-pill event-open-button"[\s\S]*>Open<ArrowRight size=\{11\} aria-hidden="true"\/>/);
  assert.doesNotMatch(component, /All event sales/);
});
