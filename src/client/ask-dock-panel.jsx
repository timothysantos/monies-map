import { Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { askConversationPresence } from "./ask-conversation-presence";
import { askDockHandle, isAskShortcutKey, takeAskDockRequest } from "./ask-dock-entry";
import { AskDockField, AskDockLoading } from "./ask-dock-field";
import { askDockBandWidth, askDockModeOnOpen, selectAskDockLayout } from "./ask-dock-layout";
import { CHAT_INTENT, getAskDockStore } from "./ask-dock-state";
import { isAskDockWide, useIsAskDockWide, useIsMobileLayout } from "./use-viewport";

// Desktop Ask (design.md "Desktop Ask"; docs/flows/ask-flow.md "Desktop").
// The dock's code, loaded by the launcher (ask-dock.jsx) on the first way in
// (so it is not in the first screen) in the Ask page's chunk, which the
// conversation needs anyway (ask-panel.jsx re-exports it): the store, the layout rules, the field
// once it takes over from the launcher's, and the frame of the panel the
// field opens (docked beside the page from 1,280 px, a popup below that).
// The conversation inside, with its Close and expand controls
// and Escape, is the Ask page itself (ask-panel.jsx, lazy, the chunk /ask
// loads) bound to the shared conversation store, so the phone's Ask tab and
// this panel are one conversation. App renders this on every desktop route
// but /ask, where the page is Ask.

/**
 * Opens Ask beside the page (the field, or on a wide screen the Entries +
 * and Splits receipt buttons with their new entry's way in). An open panel
 * keeps its mode; otherwise the window's width picks it. `insight` (a
 * Money insights line's "Ask about this") is asked in the chat once the
 * conversation takes it.
 * @param {{ intent?: object, file?: File | null, insight?: object | null }} [options]
 */
export function openAskDockNow({ intent = undefined, file = null, insight = null } = {}) {
  const store = getAskDockStore();
  const current = store.getSnapshot();
  store.open({
    mode: current.open ? current.mode : askDockModeOnOpen(askDockBandWidth({ phone: false, wide: isAskDockWide() })),
    intent,
    file,
    insight
  });
}

// A way in from the field: reopening goes back to the conversation in
// progress, as the phone's Ask tab does: a new entry still being filled, else
// the chat.
function openFromField(file = null) {
  const resume = askConversationPresence.getSnapshot().resumeIntent;
  openAskDockNow({
    intent: getAskDockStore().getSnapshot().open ? undefined : resume ? { ...CHAT_INTENT, ...resume, savedEntryId: "" } : CHAT_INTENT,
    file
  });
}

/**
 * @param {{
 *   besideFab: boolean,
 *   intentProps?: Record<string, Function>,
 *   canLoad: boolean,
 *   onMounted?: () => void,
 *   takeOver?: { current: HTMLInputElement | null },
 *   renderConversation: (dock: { layout: "docked" | "popup", canExpand: boolean, intent: import("./ask-dock-state").AskIntent, visit: number }) => import("react").ReactNode
 * }} props
 */
export default function AskDockPanel({ besideFab, intentProps = undefined, canLoad, onMounted = undefined, takeOver = undefined, renderConversation }) {
  const store = getAskDockStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { layout, canExpand } = selectAskDockLayout({
    width: askDockBandWidth({ phone: useIsMobileLayout(), wide: useIsAskDockWide() }),
    mode: state.mode
  });
  const open = state.open && layout !== "hidden";
  const docked = open && layout === "docked";
  const fieldRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  // Focus given back after Close must not reopen Ask.
  const quietFocusRef = useRef(false);

  // The Ask code loads once the page beside it is usable (a panel restored
  // open after a reload never gets in the first screen's way), or at once
  // when the person opens it.
  const [loadAllowed, setLoadAllowed] = useState(false);
  if (open && !loadAllowed && (canLoad || state.openedByHand)) {
    setLoadAllowed(true);
  }

  // Take over from the launcher's field: what was typed or dropped before this
  // code arrived, the way in it asked for, and the caret if it had one.
  useLayoutEffect(() => {
    const request = takeAskDockRequest();
    const typed = takeOver?.current;
    if (typed?.value) store.setDraftText(typed.value);
    if (typed && document.activeElement === typed) {
      quietFocusRef.current = true;
      fieldRef.current?.focus();
    }
    if (request?.options) openAskDockNow(request.options);
    else if (request?.open) openFromField(request.file);
    askDockHandle.open = openAskDockNow;
    onMounted?.();
    return () => {
      askDockHandle.open = null;
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A docked panel pushes the page: the shell narrows by the panel's width
  // (public/styles.css, body[data-ask-dock="docked"]).
  useLayoutEffect(() => {
    if (!docked) {
      delete document.body.dataset.askDock;
      return undefined;
    }
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

  if (layout === "hidden") {
    return null;
  }

  const loading = <AskDockLoading onClose={() => store.close({ returnFocus: true })} />;

  return (
    <>
      {open && state.ready ? null : (
        <AskDockField
          besideFab={besideFab}
          intentProps={intentProps}
          inputRef={fieldRef}
          quietFocusRef={quietFocusRef}
          value={state.draftText}
          onText={(text) => store.setDraftText(text)}
          onOpen={openFromField}
        />
      )}
      {open ? (
        <aside className={`ask-dock is-${layout}${besideFab ? " is-beside-fab" : ""}`} aria-labelledby="ask-page-title">
          {loadAllowed ? (
            <Suspense fallback={loading}>{renderConversation({ layout, canExpand, intent: state.intent, visit: state.visit })}</Suspense>
          ) : loading}
        </aside>
      ) : null}
    </>
  );
}
