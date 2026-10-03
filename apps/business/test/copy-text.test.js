import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { copyText, ClipboardCopyError } from '../../shared/copy-text.js';

test('prepared links write synchronously within the initiating tap', async () => {
  const calls = [];
  const result = copyText('https://nitewide.test/?ref=test', { navigator: { clipboard: { writeText: text => { calls.push(text); return Promise.resolve(); } } } });
  assert.deepEqual(calls, ['https://nitewide.test/?ref=test']);
  await result;
});

test('Safari clipboard write starts synchronously with an already prepared plain-text Blob', async () => {
  let writeStarted = false;
  const link = 'https://nitewide.test/?guestlistInvite=synthetic-private-token';
  const environment = { Blob, ClipboardItem: class { constructor(data) { this.data = data; } }, navigator: { clipboard: {
    write: async items => {
      writeStarted = true;
      assert.equal(items.length, 1);
      assert.deepEqual(Object.keys(items[0].data), ['text/plain']);
      const blob = items[0].data['text/plain'];
      assert.ok(blob instanceof Blob, 'clipboard data is ready, not a pending promise');
      assert.equal(blob.type, 'text/plain');
      assert.equal(await blob.text(), link);
    },
  } } };
  const copying = copyText(link, environment);
  assert.equal(writeStarted, true);
  await copying;
});

test('copy refuses asynchronous loaders and promises instead of starting requests during a tap', async () => {
  let loads = 0, writes = 0;
  const environment = { navigator: { clipboard: { writeText: () => { writes++; } } } };
  await assert.rejects(copyText(async () => { loads++; return 'private link'; }, environment), TypeError);
  await assert.rejects(copyText(Promise.resolve('private link'), environment), TypeError);
  assert.equal(loads, 0);
  assert.equal(writes, 0);
});

test('selected-text fallback stays inside a modal, restores focus and selection, and removes its temporary input', async () => {
  const dom = new JSDOM('<div role="dialog"><input value="Guest name"></div>');
  try {
    const active = dom.window.document.querySelector('input');
    active.focus(); active.setSelectionRange(2, 5);
    let copied;
    dom.window.document.execCommand = command => {
      assert.equal(command, 'copy');
      const temporary = dom.window.document.activeElement;
      assert.equal(temporary.closest('[role="dialog"]'), active.parentElement);
      assert.equal(temporary.readOnly, true);
      copied = temporary.value;
      assert.equal(temporary.selectionStart, 0);
      assert.equal(temporary.selectionEnd, temporary.value.length);
      return true;
    };
    await copyText('https://nitewide.test/?invite=test', { document: dom.window.document, navigator: { clipboard: { writeText: async () => { throw new Error('Clipboard denied'); } } } });
    assert.equal(copied, 'https://nitewide.test/?invite=test');
    assert.equal(dom.window.document.activeElement, active);
    assert.equal(active.selectionStart, 2);
    assert.equal(active.selectionEnd, 5);
    assert.equal(dom.window.document.querySelector('textarea'), null);
  } finally { dom.window.close(); }
});

test('unsupported or refused copying returns a selectable link without claiming success or requiring permissions', async () => {
  const text = 'https://nitewide.test/?guestlistInvite=synthetic-private-token';
  for (const navigator of [{}, { clipboard: { writeText: async () => { throw new Error('Denied'); } } }]) {
    await assert.rejects(copyText(text, { navigator }), error => {
      assert.ok(error instanceof ClipboardCopyError);
      assert.equal(error.text, text);
      assert.doesNotMatch(error.message, /synthetic-private-token|allow clipboard/i);
      assert.match(error.message, /Press and hold/);
      return true;
    });
  }
});

test('a denied modern copy preserves the prepared link only for manual copying', async () => {
  const text = 'https://nitewide.test/?guestlistInvite=test';
  await assert.rejects(copyText(text, {
    Blob, ClipboardItem: class { constructor(data) { this.data = data; } },
    navigator: { clipboard: { write: async () => { throw new Error('Denied'); } } },
  }), error => error instanceof ClipboardCopyError && error.text === text);
});

test('empty or cancelled link sources never claim copy success', async () => {
  let writes = 0;
  await assert.rejects(copyText('', { navigator: { clipboard: { writeText: async () => { writes++; } } } }), TypeError);
  assert.equal(writes, 0);
});
