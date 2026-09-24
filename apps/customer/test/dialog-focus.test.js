import test from 'node:test';
import assert from 'node:assert/strict';
import { focusEventDialogStart, openEventDialogAtTop } from '../src/lib/dialog-focus.js';

test('opening an event cancels booking-control autofocus, focuses its dialog and resets scroll', () => {
  const calls = [];
  const content = { scrollTop: 528, focus: (options) => calls.push(['dialog', options]) };
  openEventDialogAtTop({ preventDefault: () => calls.push(['cancel']) }, content);
  assert.deepEqual(calls, [['cancel'], ['dialog', { preventScroll: true }]]);
  assert.equal(content.scrollTop, 0);
});

test('reopening or switching events resets previous scroll positions every time', () => {
  const content = { scrollTop: 0, focus: () => { focusCount += 1; } };
  let focusCount = 0;
  for (const previousScroll of [740, 120, 980]) {
    content.scrollTop = previousScroll;
    focusEventDialogStart(content);
    assert.equal(content.scrollTop, 0);
  }
  assert.equal(focusCount, 3);
});

test('focus remains inside the dialog without activating its heading', () => {
  let options;
  const content = { scrollTop: 99, focus: (value) => { options = value; } };
  focusEventDialogStart(content);
  assert.deepEqual(options, { preventScroll: true });
  assert.equal(content.scrollTop, 0);
  assert.doesNotThrow(() => focusEventDialogStart(null));
});
