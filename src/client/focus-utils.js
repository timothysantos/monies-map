export function selectAllOnFocus(event) {
  const input = event.currentTarget;
  if (event.type === "mousedown") {
    event.preventDefault();
    input.focus();
    input.select();
    return;
  }
  window.requestAnimationFrame(() => {
    input.select();
  });
}
