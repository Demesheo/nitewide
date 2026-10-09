// Mobile uses a bounded workspace scrollport so bottom navigation stays in
// normal layout. Desktop keeps the document's existing scrolling behavior.
function scrollTarget() {
  return window.matchMedia('(max-width: 850px)').matches
    ? document.querySelector('.app-shell > .main-shell') || window
    : window;
}

export function workspaceScrollY() {
  const target = scrollTarget();
  return target === window ? window.scrollY : target.scrollTop;
}

export function scrollWorkspaceTo(options) {
  scrollTarget().scrollTo(options);
}

export function scrollWorkspaceToElement(element, { offset = 76, behavior = 'instant' } = {}) {
  const target = scrollTarget();
  const origin = target === window ? 0 : target.getBoundingClientRect().top;
  const current = target === window ? window.scrollY : target.scrollTop;
  target.scrollTo({ top: Math.max(0, current + element.getBoundingClientRect().top - origin - offset), behavior });
}
