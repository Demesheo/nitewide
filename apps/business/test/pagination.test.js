import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paginate, PAGE_SIZES } from '../src/lib/pagination.js';

test('tables default to 10 rows and support 25 and 50 without losing records', () => {
  const rows = Array.from({ length: 61 }, (_, index) => index + 1);
  assert.deepEqual(PAGE_SIZES, [10, 25, 50]);
  assert.deepEqual(paginate(rows).rows, rows.slice(0, 10));
  assert.deepEqual(paginate(rows, 2, 25).rows, rows.slice(25, 50));
  assert.deepEqual(paginate(rows, 2, 50).rows, rows.slice(50));
  assert.deepEqual(paginate(rows, 99, 10).rows, [61]);
  assert.deepEqual([paginate([], 1, 10).from, paginate([], 1, 10).to], [0, 0]);
});

test('business table pagination scrolls to its own card on both page directions', () => {
  const component = readFileSync(new URL('../src/components/TablePagination.jsx', import.meta.url), 'utf8');
  assert.match(component, /const changePage = \(page\) => \{/);
  assert.match(component, /paginationRef\.current\?\.closest\('section'\)/);
  assert.match(component, /window\.scrollTo\(/);
  assert.match(component, /onClick=\{\(\) => changePage\(pager\.currentPage - 1\)\}/);
  assert.match(component, /onClick=\{\(\) => changePage\(pager\.currentPage \+ 1\)\}/);
  assert.match(component, /if \(onPageChange\) return onPageChange\(\)/);
});

test('Current team and Event collection supply their own card-top targets', () => {
  const team = readFileSync(new URL('../src/components/Team.jsx', import.meta.url), 'utf8');
  const events = readFileSync(new URL('../src/components/Events.jsx', import.meta.url), 'utf8');
  assert.match(team, /<section ref=\{rosterRef\} className="panel team-roster">/);
  assert.match(team, /<TablePagination pager=\{pager\} onPageChange=\{scrollToRoster\}\/>/);
  assert.match(events, /<section ref=\{collectionRef\} className="panel event-library">/);
  assert.match(events, /onPageChange=\{scrollToCollection\}/);
});
