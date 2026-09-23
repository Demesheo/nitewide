import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationTarget, loadNotificationBooking, activateNotification } from '../src/lib/notification-target.js';

test('guestlist decisions and accepted invitations open the exact entry, not event checkout', async () => {
  for (const kind of ['guestlist_approved', 'guestlist_invited', 'guestlist_declined']) {
    const target = notificationTarget({ kind, eventId: 'event', metadata: { entryId: 'entry' } });
    assert.deepEqual(target, { type: 'booking', kind: 'guestlist', id: 'entry' });
    const result = await loadNotificationBooking(target, async (path, options) => {
      assert.equal(path, '/customer/guestlists/entry/pass'); assert.equal(options.token, 'customer-token');
      return { id: 'entry', kind: 'guestlist' };
    }, 'customer-token');
    assert.equal(result.id, 'entry');
  }
});
test('all purchased offering types use their exact order, independent of booking pagination', async () => {
  for (const offering of ['General admission', 'VIP package', 'Table', 'Other offering']) {
    const target = notificationTarget({ kind: 'purchase_confirmed', eventId: 'same-event', metadata: { orderId: offering } });
    await loadNotificationBooking(target, async path => {
      assert.equal(path, `/customer/purchases/${encodeURIComponent(offering)}/tickets`);
    }, 'token');
  }
});
test('unrelated business sale notifications never open another buyer’s credentials', () => {
  for (const kind of ['referral_purchase', 'event_purchase', 'guestlist_request']) {
    assert.deepEqual(notificationTarget({ kind, eventId: 'event', metadata: { orderId: 'someone-elses-order', entryId: 'someone-elses-entry' } }), { type: 'event', id: 'event' });
  }
  assert.equal(notificationTarget({ kind: 'general' }), null);
});
test('missing or unavailable bookings fail clearly instead of opening the wrong event', async () => {
  await assert.rejects(loadNotificationBooking(notificationTarget({ kind: 'purchase_confirmed' }), () => assert.fail('must not fetch')), /no longer has a linked booking/);
  const denied = new Error('Purchase not found');
  await assert.rejects(loadNotificationBooking({ kind: 'purchase', id: 'removed' }, async () => { throw denied; }), error => error === denied);
});
test('successful booking navigation dismisses even already-read notifications only after opening', async () => {
  const calls = [];
  const result = await activateNotification({ id: 'notification', readAt: 'yesterday' }, async () => { calls.push('opened'); return true; }, async (path, options) => {
    calls.push('dismissed'); assert.equal(path, '/notifications/notification'); assert.equal(options.method, 'DELETE'); assert.equal(options.token, 'token');
  }, 'token');
  assert.equal(result, true); assert.deepEqual(calls, ['opened', 'dismissed']);
});
test('failed navigation never dismisses and failed dismissal is surfaced for retry', async () => {
  await assert.rejects(activateNotification({ id: 'notice' }, async () => { throw new Error('Missing booking'); }, () => assert.fail('must retain notification')), /Missing booking/);
  await assert.rejects(activateNotification({ id: 'notice' }, async () => true, async () => { throw new Error('Unable to dismiss'); }), /Unable to dismiss/);
});
test('non-booking navigation preserves existing mark-as-read behavior', async () => {
  await activateNotification({ id: 'notice' }, async () => false, async (path, options) => { assert.equal(path, '/notifications/notice/read'); assert.equal(options.method, 'POST'); });
  await activateNotification({ id: 'notice', readAt: 'yesterday' }, async () => false, () => assert.fail('already read'));
});
