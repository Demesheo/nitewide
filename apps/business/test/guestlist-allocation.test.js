import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allocationInputIsReadOnly, closeOtherAllocationEditors, focusAllocationInput, normalizeAllocationInput } from '../src/lib/guestlist-allocation.js';

const guestlistsSource = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
const shareCardSource = readFileSync(new URL('../src/components/ShareEventCard.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('the active capacity pool unlocks its existing input without creating a duplicate field', () => {
  assert.equal(allocationInputIsReadOnly(null, 'direct'), true);
  assert.equal(allocationInputIsReadOnly('direct', 'direct'), false);
  assert.equal(allocationInputIsReadOnly('promoter-1', 'promoter-1'), false);
  assert.equal(allocationInputIsReadOnly('promoter-1', 'promoter-2'), true);

  const directCard = guestlistsSource.slice(guestlistsSource.indexOf('<form onSubmit={(e) => saveLimit(e)}'), guestlistsSource.indexOf('{settings.promoters.map'));
  const promoterCard = guestlistsSource.slice(guestlistsSource.indexOf('{settings.promoters.map'), guestlistsSource.indexOf('</div>\n        </section>', guestlistsSource.indexOf('{settings.promoters.map')));
  for (const card of [directCard, promoterCard]) {
    assert.match(card, /<Field[\s\S]*?readOnly=\{!canEditAllocations \|\| allocationInputIsReadOnly/);
    assert.match(card, /className=\{allocationInputIsReadOnly[\s\S]*?allocation-input-active/);
    assert.match(card, /<details className="allocation-editor"/);
    assert.doesNotMatch(card, /<details[\s\S]*?<Field/);
    assert.match(card, /<Button[^>]*type="submit"[^>]*><Save \/>Save/);
    assert.match(card, /type="button"[^>]*onClick=\{cancelAllocationEdit\}>Cancel/);
  }
  assert.match(styles, /\.allocation-editor\[open\] > \.allocation-edit-button \{ display: none; \}/);
  assert.doesNotMatch(styles, /\.allocation-editor:focus-within \.allocation-edit-button/);
  assert.doesNotMatch(styles, /\.allocation-editor\[open\] \.allocation-edit-button\s*\{[^}]*box-shadow/);
  assert.match(styles, /\.allocation-actions > button \{ flex: 1 1 0;/);
  assert.doesNotMatch(guestlistsSource, /Save allocation/);
  assert.match(guestlistsSource, /editor\.closest\('form'\)\?\.querySelector\('input\[name="limit"\]'\)/);
});

test('blank promoter override remains the inherit-default value; numeric edits become numbers', () => {
  assert.equal(normalizeAllocationInput(''), null);
  assert.equal(normalizeAllocationInput('18'), 18);
  assert.equal(normalizeAllocationInput('0'), 0);
});

test('opening an allocation editor focuses and selects its existing input', () => {
  let focused = false;
  let selected = false;
  assert.equal(focusAllocationInput({ focus() { focused = true; }, select() { selected = true; } }), true);
  assert.equal(focused, true);
  assert.equal(selected, true);
  assert.equal(focusAllocationInput(null), false);
});

test('opening one allocation editor cancels and resets any other active editor', () => {
  const grid = {};
  let priorReset = 0;
  const previous = {
    open: true,
    closest(selector) {
      assert.equal(selector, 'form');
      return { reset() { priorReset += 1; } };
    },
  };
  const active = { open: true };
  grid.querySelectorAll = (selector) => {
    assert.equal(selector, 'details.allocation-editor[open]');
    return [previous, active];
  };

  closeOtherAllocationEditors(grid, active);
  assert.equal(previous.open, false);
  assert.equal(priorReset, 1);
  assert.equal(active.open, true);
});

test('request status filter belongs to the Guest Experience controls, not the event toolbar', () => {
  const guestExperience = guestlistsSource.slice(guestlistsSource.indexOf('<section className="panel guest-experience-panel">'), guestlistsSource.indexOf('{loading ? ('));
  assert.doesNotMatch(guestlistsSource, /<div className="toolbar">/);
  assert.match(guestExperience, /guest-experience-filters[\s\S]*MultiSelect label="Request status"/);
});

test('guest invitation stays in event details Share this event card without showing the URL', () => {
  const eventDetailSource = readFileSync(new URL('../src/components/EventDetail.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(guestlistsSource, /<ShareEventCard|<GuestlistInviteDialog/);
  assert.match(eventDetailSource, /const canInviteGuest = event.status === 'published' && invitePools\?\.open && \(invitePools.direct \|\| invitePools.own.length > 0\)/);
  assert.match(eventDetailSource, /<ShareEventCard referralUrl=\{url\?\.toString\(\) \|\| ''\} canInviteGuest=\{Boolean\(canInviteGuest\)\}/);
  assert.ok(shareCardSource.indexOf('Copy link') < shareCardSource.indexOf('guestlist-share-invite'));
  assert.match(shareCardSource, /import \{ Share, UserPlus \} from 'lucide-react'/);
  assert.match(shareCardSource, /onClick=\{copyLink\}><Share size=\{16\} aria-hidden="true"\/>/);
  assert.match(shareCardSource, /guestlist-share-invite">\s*<h3>Invite to guestlist<\/h3>\s*<p>[^<]+<\/p>\s*<Button className="guestlist-invite-button"/);
  assert.match(styles, /\.guestlist-referral-card h3 \{ margin: 4px 0; font-size: 16px; \}/);
  assert.doesNotMatch(shareCardSource, /aria-label="Your event referral link"|value=\{referralUrl\}/);
  assert.match(styles, /\.guestlist-share-invite \{ display: grid; justify-items: start;/);
  const inviteDialogSource = readFileSync(new URL('../src/components/GuestlistInviteDialog.jsx', import.meta.url), 'utf8');
  assert.match(inviteDialogSource, /className="guestlist-invitation-actions"><Button[^>]*type="submit">\{busy \? 'Checking…' : 'Create invitation'\}/);
  assert.match(styles, /\.guestlist-invitation-actions \{ display: flex; justify-content: flex-end; \}/);
});

test('saving an event allocation refreshes the invite pools without a page reload', () => {
  const eventDetailSource = readFileSync(new URL('../src/components/EventDetail.jsx', import.meta.url), 'utf8');
  assert.match(guestlistsSource, /setRevision\(\(v\) => v \+ 1\);\s*onChanged\?\.\(\);/);
  assert.match(eventDetailSource, /onChanged=\{\(\) => setRevision\(\(value\) => value \+ 1\)\}/);
  assert.match(eventDetailSource, /<ReferralLink event=\{event\} session=\{session\} revision=\{revision\}/);
  assert.match(eventDetailSource, /guestlist-invite-pools[\s\S]*?\}, \[event\.id, session, revision\]\)/);
});

test('guestlist invitations default to phone and reset to phone when reopened', () => {
  const inviteDialogSource = readFileSync(new URL('../src/components/GuestlistInviteDialog.jsx', import.meta.url), 'utf8');
  assert.match(inviteDialogSource, /const \[contact, setContact\] = useState\('phone'\)/);
  assert.match(inviteDialogSource, /if \(!next\) \{ setResult\(null\); setError\(''\); setContact\('phone'\); \}/);
  assert.match(inviteDialogSource, /contact === 'email' \? <Field[^>]*name="email"[\s\S]*?: <Field[^>]*name="phone"/);
});
