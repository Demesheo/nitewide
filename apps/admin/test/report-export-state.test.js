import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const analytics = readFileSync(new URL('../src/components/Analytics.jsx', import.meta.url), 'utf8');
const analyticsDrill = readFileSync(new URL('../src/components/AnalyticsDrillTable.jsx', import.meta.url), 'utf8');

test('Overview export is unavailable until the current workspace request has data', () => {
  assert.match(dashboard, /const workspaceKey = `\$\{days\}:\$\{organizationId\}`/);
  assert.match(dashboard, /const data = workspaceResult\?\.key === workspaceKey \? workspaceResult\.value : null/);
  assert.match(dashboard, /function exportCurrent\(\) \{ if \(!data \|\| workspaceLoading\) return;/);
  assert.match(dashboard, /disabled=\{!data \|\| workspaceLoading\} onClick=\{exportCurrent\}>Export CSV/);
});

test('rapid Overview filter changes and refreshes cancel and sequence old workspace responses', () => {
  assert.match(dashboard, /const sequence = \+\+requestSequence\.current/);
  assert.match(dashboard, /requestController\.current\?\.abort\(\)/);
  assert.match(dashboard, /if \(sequence === requestSequence\.current\) setWorkspaceResult\(\{ key, value \}\)/);
  assert.match(dashboard, /return \(\) => requestController\.current\?\.abort\(\)/);
  assert.match(dashboard, /\['operations', 'management', 'reports', 'organizations', 'events', 'orders', 'users', 'audit'\]\.includes\(section\)/);
});

test('Analytics export and results are keyed to the current complete request', () => {
  assert.match(analytics, /const data = request && result\?\.request === request \? result\.data : null/);
  assert.match(analytics, /if \(!active \|\| latestRequest\.current !== request\) return/);
  assert.match(analytics, /controller\.abort\(\)/);
  assert.match(analytics, /disabled=\{!data \|\| exporting\} onClick=\{async \(\) => \{ if \(!data \|\| exporting\) return/);
  assert.match(analytics, /await downloadBusinessReport\(readSession\(\), request, \{ audience: 'admin' \}\)/);
  assert.match(analytics, /request && !data && !error && <p className="loading" role="status">Loading analytics/);
  assert.match(analyticsDrill, /: !current\.length \? <p className="p-8 text-center text-sm text-muted-foreground">No matching records in this range\./);
});

test('custom Analytics dates do not request or export until the range is complete and ordered', () => {
  assert.match(analytics, /const invalidDateRange = period === 'custom' && startDate && endDate && startDate > endDate/);
  assert.match(analytics, /period === 'custom' && \(!startDate \|\| !endDate \|\| startDate > endDate\)/);
  assert.match(analytics, /Choose a start and end date to load a custom report\./);
  assert.match(analytics, /End date must be on or after start date\./);
  assert.match(analytics, /const customDatePrompt = period !== 'custom' \? null : invalidDateRange[\s\S]{0,180}End date must be on or after start date\.[\s\S]{0,120}: !startDate \|\| !endDate \?/);
  assert.match(analytics, /value=\{startDate\} onInput=\{syncStartDate\} onChange=\{syncStartDate\} onBlur=\{syncStartDate\}/);
  assert.match(analytics, /value=\{endDate\} onInput=\{syncEndDate\} onChange=\{syncEndDate\} onBlur=\{syncEndDate\}/);
  assert.match(analytics, /disabled=\{!data \|\| exporting\}/);
});

test('Analytics uses server-side drill paging and exports the full filtered SQL report', () => {
  assert.match(analytics, /\/admin\/reports\/summary\?/);
  assert.doesNotMatch(analytics, /\/admin\/analytics\?|exportCsv/);
  assert.match(analyticsDrill, /const kinds = \['regions', 'venues', 'events', 'customers'\]/);
  assert.match(analyticsDrill, /params\.set\('page', String\(page\)\)/);
  assert.match(analyticsDrill, /params\.set\('pageSize', String\(pageSize\)\)/);
  assert.match(analyticsDrill, /\/admin\/reports\/\$\{kind\}\?/);
  assert.match(analyticsDrill, /result\?\.key === key/);
  assert.match(analyticsDrill, /controller\.abort\(\)/);
  assert.match(analyticsDrill, /row\.kind === 'venues'/);
  assert.match(analyticsDrill, /row\.kind === 'events'/);
  assert.doesNotMatch(analyticsDrill, /sortRecords|useTablePager|data\.hierarchy/);
});
