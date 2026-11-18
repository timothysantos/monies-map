import { useLayoutEffect } from "react";

/**
 * Keeps a growing text box exactly as tall as its text: after each change
 * of `value`, and again when its width changes (the amount moving under the
 * title, a turned phone, a sheet settling), since a new width wraps the
 * text onto a different number of lines. Without the second, a line hides
 * above or below the box (the fit check, docs/code-spec.md).
 * @param {{ current: HTMLTextAreaElement | null }} ref
 * @param {string} value
 */
export function useFitHeight(ref, value) {
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return undefined;
    const fit = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== width) {
        width = field.clientWidth;
        fit();
      }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [ref, value]);
}
