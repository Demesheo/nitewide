export function allocationInputIsReadOnly(editingKey, allocationKey) {
  return String(editingKey ?? '') !== String(allocationKey);
}

export function normalizeAllocationInput(value) {
  return value === '' ? null : Number(value);
}

export function focusAllocationInput(input) {
  if (!input) return false;
  input.focus();
  input.select?.();
  return true;
}

export function closeOtherAllocationEditors(grid, activeEditor) {
  if (!grid?.querySelectorAll) return;
  for (const editor of grid.querySelectorAll('details.allocation-editor[open]')) {
    if (editor === activeEditor) continue;
    editor.closest('form')?.reset();
    editor.open = false;
  }
}
