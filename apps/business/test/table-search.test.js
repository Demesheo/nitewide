import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchRows } from '../src/lib/table-search.js';

const read = (name) => readFileSync(new URL(`../src/components/${name}.jsx`, import.meta.url), 'utf8');

test('search is case-insensitive, trims whitespace, and preserves the original rows', () => {
  const rows = [{ name: 'Zoe Mitchell', role: 'Promoter' }, { name: 'Sam Rivera', role: 'Manager' }];
  assert.deepEqual(searchRows(rows, '  zoE  ', ['name', 'role']), [rows[0]]);
  assert.deepEqual(searchRows(rows, 'manager', ['name', 'role']), [rows[1]]);
  assert.equal(searchRows(rows, ' ', ['name', 'role']), rows);
  assert.deepEqual(searchRows(rows, 'nobody', ['name', 'role']), []);
});

test('Guest Experience and Team search filter before sorting and pagination', () => {
  const guestlists = read('Guestlists');
  const team = read('Team');
  assert.match(guestlists, /const visibleEntries = searchRows\(searchableEntries, search, \['guestName', 'guestEmail', 'guestPhone', 'sourceValue', 'status'\]\)/);
  assert.match(guestlists, /sortTableRows\(visibleEntries, sortKey, descending\)/);
  assert.match(guestlists, /<MobileTableSort[\s\S]*?<Input aria-label="Search guestlist"/);
  assert.ok(guestlists.indexOf('<Input aria-label="Search guestlist"') < guestlists.indexOf('{loading && loadedEventId !== eventId ? ('));
  assert.match(team, /const visibleMembers = searchRows\(members\.filter\(\(member\) => !activeRoles\.length \|\| activeRoles\.includes\(member\.role\)\), search, \['name', 'role', 'email', 'status'\]\)/);
  assert.match(team, /sortTableRows\(visibleMembers, sortKey, descending\)/);
  assert.match(team, /<MobileTableSort[\s\S]*?<Input aria-label="Search team"/);
  assert.match(team, /className="panel team-invite-summary"/);
  assert.match(team, /className="panel team-roster"/);
  assert.match(team, /className="panel team-pending"/);
});

test('guestlist status refresh retains same-event rows and Team offers only roster roles', () => {
  const guestlists = read('Guestlists');
  const team = read('Team');
  assert.match(guestlists, /if \(entriesEventRef\.current !== eventId\) \{[\s\S]*?setEntries\(\[\]\)/);
  assert.match(guestlists, /loading && loadedEventId === eventId && <LoadingState className="guest-experience-refresh">Updating requests/);
  assert.match(guestlists, /loading && loadedEventId !== eventId \? \(/);
  assert.match(team, /roleOptions = \[\.\.\.new Set\(members\.map\(\(member\) => member\.role\)\)\]/);
  assert.match(team, /<MultiSelect label="Roles" options=\{roleOptions\} selected=\{activeRoles\} onChange=\{setSelectedRoles\}/);
});
