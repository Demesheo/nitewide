import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const operations = readFileSync(new URL('../src/components/Operations.jsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/operations.css', import.meta.url), 'utf8');

test('Operations chooses the first nonempty queue only after its first successful count response', () => {
  assert.match(operations, /if \(!userSelected\.current && !autoSelected\.current\)/);
  assert.match(operations, /queues\.find\(\(\[, , count\]\) => result\.counts\?\.\[count\] > 0\)\?\.\[0\] \|\| queues\[0\]\[0\]/);
  assert.match(operations, /setData\(result\);[\s\S]*?const next = queues\.find/);
  assert.match(operations, /if \(next !== kind\) \{ setKind\(next\); setPage\(1\); \}/);
});

test('manual queue choice and explicit initialKind lock out future auto-selection', () => {
  assert.match(operations, /const userSelected = useRef\(Boolean\(initialKind\)\)/);
  assert.match(operations, /const autoSelected = useRef\(Boolean\(initialKind\)\)/);
  assert.match(operations, /function choose\(next\) \{ userSelected\.current = true; autoSelected\.current = true; setKind\(next\); setPage\(1\); \}/);
  assert.match(operations, /useEffect\(\(\) => \{ userSelected\.current = Boolean\(initialKind\); autoSelected\.current = Boolean\(initialKind\);/);
});

test('ordinary navigation can auto-select, while Overview alerts and validated queue deep links are explicit', () => {
  assert.match(dashboard, /const OPERATION_KINDS = \['failed_payments', 'pending_guestlist', 'suspended_organizations'\]/);
  assert.match(dashboard, /new URLSearchParams\(window\.location\.search\)\.get\('queue'\)/);
  assert.match(dashboard, /return OPERATION_KINDS\.includes\(kind\) \? kind : null/);
  assert.match(dashboard, /const \[section, setSection\] = useState\(\(\) => initialOperationQueue\(\) \? 'operations' : 'overview'\)/);
  assert.match(dashboard, /if \(kind\) \{ setOperationKind\(kind\); setSection\('operations'\); \}/);
  assert.match(dashboard, /if \(id === 'operations'\) setOperationKind\(null\)/);
  assert.match(dashboard, /<Operations initialKind=\{operationKind\}/);
});

test('queue search and selection changes reset paging; stale queue data is hidden until current response arrives', () => {
  assert.match(operations, /function choose\(next\)[\s\S]*?setPage\(1\)/);
  assert.match(operations, /setSearch\(event\.target\.value\); setPage\(1\)/);
  assert.match(operations, /const current = queue\?\.kind === kind && queue\?\.page === page/);
  assert.match(operations, /busy \|\| \(!current && !error\) \? <div className="empty" role="status">Loading queue…/);
  assert.match(operations, /if \(sequence !== request\.current\) return/);
});

test('queue records route to the corresponding Management detail by exact record ID', () => {
  assert.match(dashboard, /failed_payments: 'payments', pending_guestlist: 'guestlist', suspended_organizations: 'organizations'/);
  assert.match(dashboard, /setManagementRecord\(\{ kind: resource, id: record\.id, edit: false \}\)/);
  assert.match(operations, /onManageRecord\(kind, item\)/);
  assert.match(operations, /Open in Management/);
});

test('Operations queue cards and action controls remain usable at phone widths', () => {
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.operations-queues \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /\.operations-queue \{ flex-direction: row; justify-content: space-between; align-items: center; min-height: 72px/);
  assert.match(styles, /\.operations-record-state button \{ width: 100%; min-height: 44px; \}/);
});
