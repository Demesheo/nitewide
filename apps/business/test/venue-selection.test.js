import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('workspace venue multiselect reaches the API and resets when organization scope changes', async () => {
  const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /selectedVenues\.forEach\(\(id\) => query\.append\('venueIds', id\)\)/);
  assert.match(source, /data\?\.venues\?\.length \|\| 0\) > 1/);
  assert.match(source, /label="Venues" options=\{data\.venues\} selected=\{selectedVenues\}/);
  assert.match(source, /setSelectedOrganizations\(ids\); setSelectedVenues\(\[\]\)/);
  assert.match(source, /session, selectedOrganizations, selectedVenues, days/);
});
test('analytics uses authorized venue options and sends all selected venue IDs', async () => {
  const source = await readFile(new URL('../src/components/Analytics.jsx', import.meta.url), 'utf8');
  assert.match(source, /venues\.forEach\(\(value\) => params\.append\('venueIds', value\)\)/);
  assert.match(source, /label="Venues" options=\{data.options.venues\} selected=\{venues\}/);
  assert.match(source, /setOrganizations\(ids\); setVenues\(\[\]\)/);
});
