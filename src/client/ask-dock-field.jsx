import { Paperclip, Sparkles } from "lucide-react";

import { messages } from "./copy/en-SG";

const imageFrom = (files) => [...(files ?? [])].find((file) => file?.type?.startsWith("image/")) ?? null;

// The one-line "Ask, or drop a receipt..." field fixed at the bottom right
// (design.md "Desktop Ask"). Focusing, clicking or typing in it opens Ask
// (the words follow into the message box), as do a photo dropped or pasted
// on it and the paperclip. First-screen markup only: the launcher
// (ask-dock.jsx) shows it before the dock's code has loaded, and the dock
// panel (ask-dock-panel.jsx) takes over with the same field.
/**
 * @param {{
 *   besideFab: boolean,
 *   intentProps?: Record<string, Function>,
 *   inputRef: import("react").Ref<HTMLInputElement>,
 *   quietFocusRef?: { current: boolean },
 *   value?: string,
 *   onText?: (text: string) => void,
 *   onOpen: (file?: File | null) => void
 * }} props
 */
export function AskDockField({ besideFab, intentProps = undefined, inputRef, quietFocusRef = undefined, value = undefined, onText = undefined, onOpen }) {
  const takePhoto = (event, files) => {
    const file = imageFrom(files);
    if (file) {
      event.preventDefault();
      onOpen(file);
    }
  };
  return (
    <div
      className={`ask-dock-field${besideFab ? " is-beside-fab" : ""}`}
      role="region"
      aria-label={messages.askDock.fieldLabel}
      onDragOver={(event) => {
        if ([...(event.dataTransfer?.types ?? [])].includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => takePhoto(event, event.dataTransfer?.files)}
    >
      <Sparkles size={18} aria-hidden="true" className="ask-dock-field-icon" />
      <input
        ref={inputRef}
        className="ask-dock-field-input"
        type="text"
        aria-label={messages.askDock.fieldLabel}
        aria-keyshortcuts="/"
        placeholder={messages.askDock.placeholder}
        autoComplete="off"
        enterKeyHint="send"
        value={value}
        {...intentProps}
        onFocus={(event) => {
          intentProps?.onFocus?.(event);
          // Focus given back after Close must not reopen Ask.
          if (quietFocusRef?.current) quietFocusRef.current = false;
          else onOpen();
        }}
        onClick={() => onOpen()}
        onChange={(event) => {
          onText?.(event.target.value);
          onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onOpen();
          }
        }}
        onPaste={(event) => takePhoto(event, event.clipboardData?.files)}
      />
      {/* The photo picker's input is made on the click, so no file input sits
          on every page. */}
      <button
        type="button"
        className="ask-dock-field-attach"
        aria-label={messages.askDock.attach}
        title={messages.askDock.attach}
        onClick={() => {
          const picker = document.createElement("input");
          picker.type = "file";
          picker.accept = "image/*";
          picker.addEventListener("change", () => {
            const file = picker.files?.[0];
            if (file) onOpen(file);
          });
          picker.click();
        }}
      >
        <Paperclip size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

// The panel's frame while the Ask page's code loads: the title, Close and a
// loading note. The launcher shows it at once, and the dock keeps it until
// the conversation is ready.
/** @param {{ onClose: () => void }} props */
export function AskDockLoading({ onClose }) {
  return (
    <div className="ask-dock-loading">
      <header className="ask-head">
        <h2 id="ask-page-title">{messages.tabs.ask}</h2>
        <button type="button" className="ask-dock-close" aria-label={messages.askDock.closeLabel} onClick={onClose}>
          {messages.askDock.close}
        </button>
      </header>
      <p className="ask-dock-loading-note" role="status">{messages.common.loading}</p>
    </div>
  );
}
