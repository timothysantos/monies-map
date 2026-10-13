export function selectAllOnFocus(event) {
  const input = event.currentTarget;
  if (event.type === "mousedown") {
    event.preventDefault();
    input.focus();
    input.select();
    return;
  }

  // Keyboard focus selects on the next frame so the browser's own caret
  // placement does not undo it. A late frame (busy tab, slow device) must not
  // select text the person has already started typing or navigating, or the
  // next keystroke would replace their digits.
  let interacted = false;
  const markInteracted = () => {
    interacted = true;
  };
  input.addEventListener("keydown", markInteracted);
  input.addEventListener("input", markInteracted);
  window.requestAnimationFrame(() => {
    input.removeEventListener("keydown", markInteracted);
    input.removeEventListener("input", markInteracted);
    if (!interacted && document.activeElement === input) {
      input.select();
    }
  });
}

// A dialog or sheet that must not raise the phone keyboard (so no field takes
// focus when it opens) still has to take focus itself: otherwise it stays on
// the control behind the dimmed page and Tab, Enter or a screen reader act on
// the page. Pass as `onOpenAutoFocus`; the dialog content takes the focus.
export function focusDialogOnOpen(event) {
  event.preventDefault();
  const content = event.currentTarget;
  if (content instanceof HTMLElement) {
    content.focus({ preventScroll: true });
  }
}
