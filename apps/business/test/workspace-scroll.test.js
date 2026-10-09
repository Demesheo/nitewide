import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { workspaceScrollY, scrollWorkspaceTo, scrollWorkspaceToElement } from '../src/lib/workspace-scroll.js';

test('workspace scrolling follows the mobile scrollport, with unchanged desktop and missing-shell fallbacks', () => {
  const dom = new JSDOM('<div class="app-shell"><div class="main-shell"></div></div>');
  const previous = new Map(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const workspace = dom.window.document.querySelector('.main-shell');
  const documentCalls = []; const workspaceCalls = [];
  let mobile = true;
  dom.window.matchMedia = query => { assert.equal(query, '(max-width: 850px)'); return { matches: mobile }; };
  dom.window.scrollTo = options => documentCalls.push(options);
  workspace.scrollTo = options => workspaceCalls.push(options);
  workspace.getBoundingClientRect = () => ({ top: 20 });
  workspace.scrollTop = 320;
  dom.window.scrollY = 900;
  const card = { getBoundingClientRect: () => ({ top: 150 }) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  try {
    assert.equal(workspaceScrollY(), 320, 'event-list history records the workspace, not the document offset');
    scrollWorkspaceTo({ top: 0, behavior: 'instant' });
    scrollWorkspaceTo({ top: 320, behavior: 'instant' });
    scrollWorkspaceToElement(card, { behavior: 'smooth' });
    scrollWorkspaceToElement(card, { offset: 1000 });
    assert.deepEqual(workspaceCalls, [
      { top: 0, behavior: 'instant' }, { top: 320, behavior: 'instant' },
      { top: 374, behavior: 'smooth' }, { top: 0, behavior: 'instant' },
    ]);
    assert.deepEqual(documentCalls, [], 'mobile actions do not pan the root document');

    mobile = false;
    assert.equal(workspaceScrollY(), 900);
    scrollWorkspaceTo({ top: 320, behavior: 'instant' });
    scrollWorkspaceToElement(card, { behavior: 'auto' });
    assert.deepEqual(documentCalls, [{ top: 320, behavior: 'instant' }, { top: 974, behavior: 'auto' }]);

    mobile = true; workspace.remove();
    assert.equal(workspaceScrollY(), 900);
    scrollWorkspaceTo({ top: 0, behavior: 'instant' });
    assert.deepEqual(documentCalls.at(-1), { top: 0, behavior: 'instant' });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
