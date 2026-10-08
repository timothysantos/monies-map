import { useEffect, useRef, useState } from "react";

// Areas of the Imports page where a dropped file must not start an intake:
// the file in review (marked data-page-drop="off"), dialogs and popovers.
export const PAGE_DROP_EXCLUDED_SELECTOR = [
  "[data-page-drop=\"off\"]",
  "[role=\"dialog\"]",
  "[role=\"alertdialog\"]",
  "dialog",
  "[data-radix-popper-content-wrapper]"
].join(", ");

// "accept" a file drag over the page, "refuse" one over an excluded area (no
// intake, and the browser does not open the file), "ignore" anything that is
// not a file (text or element drags stay with the page).
export function getPageDropAction(dataTransfer, target) {
  const types = Array.from(dataTransfer?.types ?? []);
  if (!types.includes("Files")) {
    return "ignore";
  }
  return typeof target?.closest === "function" && target.closest(PAGE_DROP_EXCLUDED_SELECTOR) ? "refuse" : "accept";
}

// While mounted, a file dropped anywhere on the page goes to `onDropFiles`
// (the drop zone's own handler stops its events first). Returns whether a
// file is being dragged over the page, for the page-wide highlight.
export function usePageFileDrop(onDropFiles) {
  const [isDragActive, setIsDragActive] = useState(false);
  const onDropFilesRef = useRef(onDropFiles);
  onDropFilesRef.current = onDropFiles;

  useEffect(() => {
    let idleTimer;
    // dragover repeats while the pointer is over the window; when it stops
    // (the drag left the window or was cancelled) the highlight goes.
    const stopSoon = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setIsDragActive(false), 200);
    };
    const handleDragOver = (event) => {
      const action = getPageDropAction(event.dataTransfer, event.target);
      if (action === "ignore") {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = action === "accept" ? "copy" : "none";
      setIsDragActive(action === "accept");
      stopSoon();
    };
    const handleDrop = (event) => {
      const action = getPageDropAction(event.dataTransfer, event.target);
      if (action === "ignore") {
        return;
      }
      event.preventDefault();
      clearTimeout(idleTimer);
      setIsDragActive(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (action === "accept" && files.length) {
        onDropFilesRef.current(files);
      }
    };
    document.addEventListener("dragenter", handleDragOver);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    return () => {
      clearTimeout(idleTimer);
      document.removeEventListener("dragenter", handleDragOver);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, []);

  return isDragActive;
}
