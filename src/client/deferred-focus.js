// Editors move focus to their first field shortly after opening, once the
// editor has painted. That delayed focus must never take focus from a field
// the person has already started using, or their next keystrokes land in the
// wrong field (a note typed into the amount).

const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

export function isEditableElement(target) {
  const element = target?.closest?.("input, textarea, select, [contenteditable]");
  if (!element || element.getAttribute?.("contenteditable") === "false") {
    return false;
  }
  return element.tagName !== "INPUT" || !NON_TEXT_INPUT_TYPES.has((element.type ?? "").toLowerCase());
}

// Focuses (and optionally selects) `field` unless another editable control
// already has focus. Returns whether focus moved.
export function focusFieldUnlessEditing(field, { select = false } = {}) {
  if (!field?.isConnected) {
    return false;
  }
  const active = field.ownerDocument.activeElement;
  if (active && active !== field && isEditableElement(active)) {
    return false;
  }
  field.focus({ preventScroll: true });
  if (select) {
    field.select?.();
  }
  return true;
}
