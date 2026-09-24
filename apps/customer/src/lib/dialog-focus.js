// Focus the dialog itself so its title is announced without outlining the title
// or jumping to the first booking control.
export function focusEventDialogStart(content) {
  if (!content) return;
  content.focus({ preventScroll: true });
  content.scrollTop = 0;
}

export function openEventDialogAtTop(event, content) {
  event.preventDefault();
  focusEventDialogStart(content);
}
