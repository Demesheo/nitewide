// Model Safari's tap-bound permission, not an always-successful clipboard.
// Prepared ClipboardItem data and write() must both exist during the click.
async function gestureClipboard(context, target) {
  await context.addInitScript(target => {
    let active = false;
    window.__clipboardWrites = { prepared: 0, immediate: 0 };
    // Browser microtask checkpoints run between native listeners. Reset only
    // after React's root bubble listener has handled this same click.
    document.addEventListener('click', () => { active = true; }, true);
    window.addEventListener('click', () => { queueMicrotask(() => { active = false; }); });
    document.execCommand = () => false;
    class Item {
      constructor(data) { this.data = data; }
      getType(type) { return Promise.resolve(this.data[type]); }
    }
    Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: Item });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write(items) {
        if (!active) return Promise.reject(new DOMException('Copy must start during the tap.', 'NotAllowedError'));
        if (!(items[0].data['text/plain'] instanceof Blob)) return Promise.reject(new Error('Link was not prepared before the tap.'));
        window.__clipboardWrites.immediate++;
        return items[0].getType('text/plain').then(blob => blob.text()).then(text => { window[target] = text; });
      },
      writeText(text) {
        if (!active) return Promise.reject(new DOMException('Copy must start during the tap.', 'NotAllowedError'));
        window.__clipboardWrites.prepared++;
        window[target] = text;
        return Promise.resolve();
      },
    } });
  }, target);
}

async function refusedClipboard(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async () => { throw new DOMException('Copy refused.', 'NotAllowedError'); },
      writeText: async () => { throw new DOMException('Copy refused.', 'NotAllowedError'); },
    } });
    document.execCommand = () => false;
  });
}

module.exports = { gestureClipboard, refusedClipboard };
