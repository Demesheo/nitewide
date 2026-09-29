import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const table = readFileSync(new URL('../src/components/DataTable.jsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('DataTable announces the active sorted column and direction to assistive technology', () => {
  assert.match(table, /<TableHead key=\{column\.label\} aria-sort=\{sortIndex === index \? descending \? 'descending' : 'ascending' : undefined\}>/);
  assert.match(table, /<span aria-hidden="true">\{sortIndex === index \?/);
});

test('decorative sales bars have a screen-reader equivalent with every UTC day, order count, and gross value', () => {
  assert.match(dashboard, /<div className="bars" aria-hidden="true">/);
  assert.match(dashboard, /<table className="sr-only"><caption>Paid sales by UTC day<\/caption>/);
  assert.match(dashboard, /<th>Date<\/th><th>Paid orders<\/th><th>Gross sales<\/th>/);
  assert.match(dashboard, /\{rows\.map\(\(row\) => <tr key=\{row\.id\}><td>\{row\.label\}<\/td><td>\{row\.orders\}<\/td><td>\{formatMoney\(row\.salesCents\)\}<\/td><\/tr>\)\}/);
  assert.match(styles, /table\.sr-only\{min-width:0\}/);
});
