import test from 'node:test';
import assert from 'node:assert/strict';
import { focusEventDialogStart, openEventDialogAtTop } from '../src/lib/dialog-focus.js';

test('opening an event cancels booking-control autofocus, focuses its heading and resets scroll', () => {
  const calls = [];
  const content = { scrollTop: 528 };
  const heading = { focus: (options) => calls.push(['heading', options]) };
  openEventDialogAtTop({ preventDefault: () => calls.push(['cancel']) }, content, heading);
  assert.deepEqual(calls, [['cancel'], ['heading', { preventScroll: true }]]);
  assert.equal(content.scrollTop, 0);
});

test('reopening or switching events resets previous scroll positions every time', () => {
  const content = { scrollTop: 0 };
  let focusCount = 0;
  const heading = { focus: () => { focusCount += 1; } };
  for (const previousScroll of [740, 120, 980]) {
    content.scrollTop = previousScroll;
    focusEventDialogStart(content, heading);
    assert.equal(content.scrollTop, 0);
  }
  assert.equal(focusCount, 3);
});

test('focus remains inside the dialog if the heading is not mounted yet', () => {
  let options;
  const content = { scrollTop: 99, focus: (value) => { options = value; } };
  focusEventDialogStart(content, null);
  assert.deepEqual(options, { preventScroll: true });
  assert.equal(content.scrollTop, 0);
  assert.doesNotThrow(() => focusEventDialogStart(null, null));
});
