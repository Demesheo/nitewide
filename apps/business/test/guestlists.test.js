import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactGuestlistSourceName, guestlistEventName, guestlistStatuses, guestlistStatusesForEvent, guestlistStatusQuery, recentAndUpcomingGuestlistEvents, reviewableGuestlistEvents } from '../src/lib/guestlists.js';

test('guestlist details use the compact member dialog and put event context beneath guest identity', () => {
  const view = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(view, /className="team-member-dialog guestlist-detail-dialog/);
  assert.match(view, /<DialogDescription>\{activeEntry\.user\?\.email \|\| 'No email on file'\}<\/DialogDescription>\s*<p className="guestlist-detail-event">/);
  assert.match(view, /<strong>\{selected\?\.title \|\| 'Event'\}<\/strong><span>\{selected \? eventDateLabel\(selected\) : '—'\}<\/span>/);
  for (const label of ['Event', 'Referral code', 'Request ID']) assert.doesNotMatch(view, new RegExp(`<dt>${label}<\\/dt>`));
  assert.match(styles, /\.guestlist-detail-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 8px;/);
});

test('declining a pending guestlist request requires an explicit confirmation', () => {
  const view = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
  assert.match(view, /const \[confirmDecline, setConfirmDecline\] = useState\(false\)/);
  assert.match(view, /onClick=\{\(\) => setConfirmDecline\(true\)\}><X \/> Decline/);
  assert.match(view, /onClick=\{\(\) => setConfirmDecline\(false\)\}>Keep request/);
  assert.match(view, /onClick=\{\(\) => decide\(activeEntry\.id, 'reject'\)\}>Confirm decline/);
  assert.match(view, /setActiveEntryId\(null\);\s*setConfirmCancel\(false\);\s*setConfirmDecline\(false\)/);
});

test('declined guestlist requests can be approved later and revoked approvals return to declined', () => {
  const view = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
  assert.match(view, /activeEntry\.status === 'rejected' && <Button disabled=\{busy\} onClick=\{\(\) => decide\(activeEntry\.id, 'approve'\)\}/);
  assert.match(view, /Revoke approval/);
  assert.match(view, /Confirm revocation/);
  assert.doesNotMatch(view, /Cancel approval|Confirm cancellation|Approval cancelled/);
});

test('guestlist event names are truncated only after 36 characters', () => {
  assert.equal(guestlistEventName('A'.repeat(36)), 'A'.repeat(36));
  assert.equal(guestlistEventName('A'.repeat(37)), `${'A'.repeat(36)}…`);
});

test('guest request cards abbreviate referrer names without changing direct sources', () => {
  assert.equal(compactGuestlistSourceName('Leo Carter'), 'Leo C.');
  assert.equal(compactGuestlistSourceName('Mary Jane Rivera'), 'Mary R.');
  assert.equal(compactGuestlistSourceName('Direct'), 'Direct');
  assert.equal(compactGuestlistSourceName('Unknown referrer'), 'Unknown referrer');
  const view = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
  const mobileStyles = readFileSync(new URL('../src/mobile.css', import.meta.url), 'utf8');
  assert.match(view, /className="guestlist-mobile-status status-pill guestlist-status" data-guestlist-status=\{entry\.status\}/);
  assert.match(view, /data-label="Spots"/);
  assert.match(view, /data-label="Request"/);
  assert.match(mobileStyles, /\.guest-experience-panel \.responsive-event-table td:first-child \{ display: flex; align-items: center; justify-content: space-between;/);
  assert.match(mobileStyles, /td\[data-label="Request"\] \{ order: 1;/);
  assert.match(mobileStyles, /td\[data-label="Spots"\] \{ order: 2;/);
  assert.match(mobileStyles, /td\[data-label="Source"\] \{ order: 3;/);
});

test('business guestlist requests use a concise pending label', () => {
  assert.equal(guestlistStatuses.find(({ id }) => id === 'pending')?.label, 'Pending');
});

test('guestlist status badges use distinct colors in cards and request details', () => {
  const view = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(view, /className="status-pill guestlist-status" data-guestlist-status=\{entry\.status\}/);
  assert.match(view, /className="status-pill guestlist-status" data-guestlist-status=\{activeEntry\.status\}/);
  for (const status of ['pending', 'confirmed', 'rejected']) {
    assert.match(styles, new RegExp(`\\.guestlist-status\\[data-guestlist-status="${status}"\\]`));
  }
});

test('future events cannot offer checked-in or no-show request statuses', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const future = { startsAt: '2026-09-25T22:00:00Z' };
  assert.deepEqual(guestlistStatusesForEvent(future, now).map(({ id }) => id), ['pending', 'confirmed', 'rejected']);
  assert.ok(guestlistStatusesForEvent({ startsAt: '2026-09-20T22:00:00Z' }, now).some(({ id }) => id === 'checked_in'));
});

test('guestlists include ongoing, future, and events ended within the last 24 hours', () => {
  const now = Date.parse('2026-09-22T03:00:00Z');
  const events = [
    { id: 'future', title: 'Future', startsAt: '2026-09-23T00:00:00Z', endsAt: '2026-09-23T04:00:00Z' },
    { id: 'old', title: 'Old', startsAt: '2026-09-20T22:00:00Z', endsAt: '2026-09-21T02:59:59Z' },
    { id: 'boundary', title: 'Boundary', startsAt: '2026-09-20T22:00:00Z', endsAt: '2026-09-21T03:00:00Z' },
    { id: 'ongoing', title: 'Ongoing', startsAt: '2026-09-20T22:00:00Z', endsAt: '2026-09-22T04:00:00Z' },
  ];
  assert.deepEqual(recentAndUpcomingGuestlistEvents(events, now).map((event) => event.id), ['boundary', 'ongoing', 'future']);
  assert.equal(events[0].id, 'future');
});

test('basic employees and promoters only see guestlist events with review access', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const event = (id, canReviewGuestlist) => ({ id, title: id, canReviewGuestlist, startsAt: '2026-09-25T22:00:00Z', endsAt: '2026-09-26T02:00:00Z' });
  assert.deepEqual(reviewableGuestlistEvents([event('own-referral', true), event('other', false)], now).map((item) => item.id), ['own-referral']);
});

test('guestlist status query supports multiple statuses and all', () => {
  assert.equal(guestlistStatusQuery(['pending', 'confirmed']), 'status=pending&status=confirmed');
  assert.equal(guestlistStatusQuery([]), 'status=all');
});
