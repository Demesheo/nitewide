import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const management = readFileSync(new URL('../src/components/Management.jsx', import.meta.url), 'utf8');

test('focused record sections and exact deep links use server-paged Management', () => {
  assert.match(dashboard, /function edit\(kind, record\) \{ setManagementRecord\(\{ kind, id: record\.id \}\); setSection\('management'\); \}/);
  assert.match(dashboard, /<Management initialRecord=\{managementRecord\}\/>/);
  assert.match(dashboard, /initialRecord=\{\{ kind: section, id: null, edit: false \}\}/);
  assert.match(management, /if \(!initialRecord\?\.id\) return/);
});

test('Management loads the exact selected record and opens its edit form', () => {
  assert.match(management, /useState\(initialRecord\?\.kind \|\| 'users'\)/);
  assert.match(management, /useState\(initialRecord\?\.id \|\| ''\)/);
  assert.match(management, /api\('\/admin\/management\/' \+ initialRecord\.kind \+ '\/' \+ initialRecord\.id\)/);
  assert.match(management, /setSelected\(detail\)/);
  assert.match(management, /const \[initialEdit, setInitialEdit\] = useState\(Boolean\(initialRecord && initialRecord\.edit !== false\)\)/);
  assert.match(management, /startEditing=\{initialEdit\}/);
  assert.match(management, /useState\(startEditing\)/);
});

test('a missing selected record shows an error and stale detail responses are ignored', () => {
  assert.match(management, /\.catch\(\(err\) => \{ if \(active && currentResource\.current === initialRecord\.kind\) setError\(err\.message\); \}\)/);
  assert.match(management, /\.then\(\(detail\) => \{ if \(active && currentResource\.current === initialRecord\.kind\) setSelected\(detail\); \}\)/);
  assert.match(management, /\{error && <div className="error" role="alert">\{error\}/);
});

test('changing the Management resource clears the selected-record edit intent', () => {
  assert.match(management, /setKey\(event\.target\.value\); setPage\(1\); setSearch\(''\); setSelected\(null\); setInitialEdit\(false\)/);
  assert.match(dashboard, /if \(id === 'management'\) setManagementRecord\(null\); if \(id === 'operations'\) setOperationKind\(null\); setSection\(id\)/);
});

test('Management page controls return to the top of the containing card', () => {
  assert.match(management, /<section ref=\{listRef\} className="panel management-panel">/);
  assert.match(management, /movePage\(page - 1\)/);
  assert.match(management, /movePage\(page \+ 1\)/);
  assert.match(management, /listRef\.current\?\.scrollIntoView\(\{ block: 'start'/);
});
