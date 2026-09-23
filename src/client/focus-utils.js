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
