import { Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Paperclip, Sparkles } from "lucide-react";

import { askConversationPresence } from "./ask-conversation-presence";
import { askDockBandWidth, askDockModeOnOpen, isAskShortcutKey, selectAskDockLayout } from "./ask-dock-layout";
import { CHAT_INTENT, getAskDockStore } from "./ask-dock-state";
import { messages } from "./copy/en-SG";
import { isAskDockWide, useIsAskDockWide, useIsMobileLayout } from "./use-viewport";

// Desktop Ask (design.md "Desktop Ask"; docs/flows/ask-flow.md "Desktop").
// In the first screen, so it stays small: a one-line "Ask, or drop a
// receipt…" field fixed at the bottom right of every desktop page, and the
// frame of the panel it opens (docked beside the page from 1,280 px, a popup
// below that). The conversation inside, with its Close and expand controls
// and Escape, is the Ask page itself (ask-panel.jsx, lazy, the chunk /ask
// loads) bound to the shared conversation store, so the phone's Ask tab and
// this panel are one conversation. App renders this on every desktop route
// but /ask, where the page is Ask.

/**
 * @param {{
 *   besideFab: boolean,
 *   intentProps?: Record<string, Function>,
 *   canLoad: boolean,
 *   renderConversation: (dock: { layout: "docked" | "popup", canExpand: boolean, intent: import("./ask-dock-state").AskIntent }) => import("react").ReactNode
 * }} props
 */
export function AskDock({ besideFab, intentProps = undefined, canLoad, renderConversation }) {
  const store = getAskDockStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { layout, canExpand } = selectAskDockLayout({
    width: askDockBandWidth({ phone: useIsMobileLayout(), wide: useIsAskDockWide() }),
    mode: state.mode
  });
  const open = state.open && layout !== "hidden";
  const docked = open && layout === "docked";
  const fieldRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const fileRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  // Focus given back after Close must not reopen Ask.
  const quietFocusRef = useRef(false);

  // The Ask code loads once the page beside it is usable (a panel restored
  // open after a reload never gets in the first screen's way), or at once
  // when the person opens it.
  const [loadAllowed, setLoadAllowed] = useState(false);
  if (open && !loadAllowed && canLoad) {
    setLoadAllowed(true);
  }

  // A docked panel pushes the page: the shell narrows by the panel's width
  // (public/styles.css, body[data-ask-dock="docked"]).
  useLayoutEffect(() => {
    if (!docked) return undefined;
    document.body.dataset.askDock = "docked";
    return () => {
      delete document.body.dataset.askDock;
    };
  }, [docked]);

  // Closed by hand: focus goes back to the field.
  useEffect(() => {
    if (!open && store.takeReturnFocus()) {
      quietFocusRef.current = true;
      fieldRef.current?.focus();
    }
  });

  const openAsk = (file = null) => {
    const resume = askConversationPresence.getSnapshot().resumeIntent;
    setLoadAllowed(true);
    store.open({
      mode: askDockModeOnOpen(askDockBandWidth({ phone: false, wide: isAskDockWide() })),
      // Reopening goes back to the conversation in progress, as the phone's
      // Ask tab does: a new entry still being filled, else the chat.
      intent: store.getSnapshot().open ? undefined : resume ? { ...CHAT_INTENT, ...resume, savedEntryId: "" } : CHAT_INTENT,
      file
    });
  };

  // "/" focuses the field (which opens Ask), or the message box once open.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!isAskShortcutKey(event)) return;
      event.preventDefault();
      if (store.getSnapshot().ready) store.requestFocus();
      else fieldRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [store]);

  if (layout === "hidden" || typeof document === "undefined") {
    return null;
  }

  const imageFrom = (files) => [...(files ?? [])].find((file) => file?.type?.startsWith("image/")) ?? null;
  const takePhoto = (event, files) => {
    const file = imageFrom(files);
    if (file) {
      event.preventDefault();
      openAsk(file);
    }
  };
  const loading = (
    <div className="ask-dock-loading">
      <header className="ask-head">
        <h2 id="ask-page-title">{messages.tabs.ask}</h2>
        <button type="button" className="ask-dock-close" aria-label={messages.askDock.closeLabel} onClick={() => store.close({ returnFocus: true })}>
          {messages.askDock.close}
        </button>
      </header>
      <p className="ask-dock-loading-note" role="status">{messages.common.loading}</p>
    </div>
  );

  return createPortal(
    <>
      {/* Focusing, clicking or typing in the field opens Ask (the words
          follow into the message box), as do a photo dropped or pasted on
          it and the paperclip. It hides once the conversation is here. */}
      {open && state.ready ? null : (
        <div
          className={`ask-dock-field${besideFab ? " is-beside-fab" : ""}`}
          onDragOver={(event) => {
            if ([...(event.dataTransfer?.types ?? [])].includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => takePhoto(event, event.dataTransfer?.files)}
        >
          <Sparkles size={18} aria-hidden="true" className="ask-dock-field-icon" />
          <input
            ref={fieldRef}
            className="ask-dock-field-input"
            type="text"
            aria-label={messages.askDock.fieldLabel}
            aria-keyshortcuts="/"
            placeholder={messages.askDock.placeholder}
            autoComplete="off"
            enterKeyHint="send"
            value={state.draftText}
            {...intentProps}
            onFocus={(event) => {
              intentProps?.onFocus?.(event);
              if (quietFocusRef.current) quietFocusRef.current = false;
              else openAsk();
            }}
            onClick={() => openAsk()}
            onChange={(event) => {
              store.setDraftText(event.target.value);
              openAsk();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                openAsk();
              }
            }}
            onPaste={(event) => takePhoto(event, event.clipboardData?.files)}
          />
          <button type="button" className="ask-dock-field-attach" aria-label={messages.askDock.attach} title={messages.askDock.attach} onClick={() => fileRef.current?.click()}>
            <Paperclip size={18} aria-hidden="true" />
          </button>
          <input
            ref={fileRef}
            className="ask-dock-file"
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) openAsk(file);
            }}
          />
        </div>
      )}
      {open ? (
        <aside className={`ask-dock is-${layout}`} aria-labelledby="ask-page-title">
          {loadAllowed ? (
            <Suspense fallback={loading}>{renderConversation({ layout, canExpand, intent: state.intent })}</Suspense>
          ) : loading}
        </aside>
      ) : null}
    </>,
    document.body
  );
}
