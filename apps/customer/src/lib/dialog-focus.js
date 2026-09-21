// Start long event dialogs at their heading rather than the first booking control.
export function focusEventDialogStart(content, heading) {
  if (!content) return;
  (heading || content).focus({ preventScroll: true });
  content.scrollTop = 0;
}

export function openEventDialogAtTop(event, content, heading) {
  event.preventDefault();
  focusEventDialogStart(content, heading);
}
