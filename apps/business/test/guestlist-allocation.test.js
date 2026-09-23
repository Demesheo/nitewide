import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allocationInputIsReadOnly, closeOtherAllocationEditors, focusAllocationInput, normalizeAllocationInput } from '../src/lib/guestlist-allocation.js';

const guestlistsSource = readFileSync(new URL('../src/components/Guestlists.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('the active capacity pool unlocks its existing input without creating a duplicate field', () => {
  assert.equal(allocationInputIsReadOnly(null, 'direct'), true);
  assert.equal(allocationInputIsReadOnly('direct', 'direct'), false);
  assert.equal(allocationInputIsReadOnly('promoter-1', 'promoter-1'), false);
  assert.equal(allocationInputIsReadOnly('promoter-1', 'promoter-2'), true);

  const directCard = guestlistsSource.slice(guestlistsSource.indexOf('<form onSubmit={(e) => saveLimit(e)}'), guestlistsSource.indexOf('{settings.promoters.map'));
  const promoterCard = guestlistsSource.slice(guestlistsSource.indexOf('{settings.promoters.map'), guestlistsSource.indexOf('</div>\n        </section>', guestlistsSource.indexOf('{settings.promoters.map')));
  for (const card of [directCard, promoterCard]) {
    assert.match(card, /<Field[\s\S]*?readOnly=\{allocationInputIsReadOnly/);
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
  const toolbar = guestlistsSource.slice(guestlistsSource.indexOf('<div className="toolbar">'), guestlistsSource.indexOf('{referralUrl &&'));
  const guestExperience = guestlistsSource.slice(guestlistsSource.indexOf('<section className="panel guest-experience-panel">'), guestlistsSource.indexOf('{loading ? ('));
  assert.doesNotMatch(toolbar, /MultiSelect label="Request status"/);
  assert.match(guestExperience, /guest-experience-filters[\s\S]*MultiSelect label="Request status"/);
});

test('guest invitation action is right aligned in the event toolbar', () => {
  assert.match(guestlistsSource, /selected\?\.status === 'published' && invitePools\?\.open && \(invitePools\.direct \|\| invitePools\.own\.length > 0\) && <Button className="guestlist-invite-button" type="button"/);
  assert.match(styles, /\.guestlist-invite-button \{ margin-left: auto; \}/);
  assert.match(guestlistsSource, /className="guestlist-invitation-actions"><Button[^>]*type="submit">\{busy \? 'Checking…' : 'Create invitation'\}/);
  assert.match(styles, /\.guestlist-invitation-actions \{ display: flex; justify-content: flex-end; \}/);
});
