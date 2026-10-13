import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { askDockHandle, forgetAskDockOpen, isAskShortcutKey, onAskDockRequest, requestAskDock, storedAskDockMode, takeAskDockRequest } from "./ask-dock-entry";
import { AskDockField, AskDockLoading } from "./ask-dock-field";
import { loadRouteModule } from "./route-modules.js";
import { useIsAskDockWide, useIsMobileLayout } from "./use-viewport";

// Desktop Ask, first-screen part (design.md "Desktop Ask"; docs/flows/
// ask-flow.md "Desktop"): the bottom-right field, the "/" key, and the
// panel's loading frame. The dock itself (store, layout rules, panel) loads
// in the Ask page's chunk on the first way in (focus, click, typing, "/", a
// dropped or pasted photo, the paperclip, the + and receipt buttons), or once
// the page is usable when a panel was left open in this tab. What the person
// did meanwhile waits in ask-dock-entry.js and the dock takes it when it
// mounts, so words typed before it arrives still reach the message box.
const AskDockPanel = lazy(() => loadRouteModule("ask").then((module) => ({ default: module.AskDockPanel })));

/**
 * Opens Ask beside the page (the + and receipt buttons, with their new
 * entry's way in; a lead's "Ask about this", with its question as `text`
 * in the message box; a Money insights line's "Ask about this", with its
 * insight). The dock's code loads on this first call.
 * @param {{ intent?: object, file?: File | null, text?: string, insight?: object | null }} [options]
 */
export function openAskDock(options = {}) {
  if (askDockHandle.open) askDockHandle.open(options);
  else requestAskDock({ options });
}

/**
 * @param {{
 *   besideFab: boolean,
 *   intentProps?: Record<string, Function>,
 *   canLoad: boolean,
 *   renderConversation: (dock: { layout: "docked" | "popup", canExpand: boolean, intent: import("./ask-dock-state").AskIntent, visit: number }) => import("react").ReactNode
 * }} props
 */
export function AskDock({ besideFab, intentProps = undefined, canLoad, renderConversation }) {
  const phone = useIsMobileLayout();
  const wide = useIsAskDockWide();
  // A panel left open in this tab shows its frame at once; its code waits for canLoad.
  const [restored] = useState(storedAskDockMode);
  const [framed, setFramed] = useState(restored !== null);
  // Loading has started; then the dock's code has taken over from this part.
  const [active, setActive] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fieldRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const docked = framed && !mounted && !phone && wide && restored !== "popup";

  useEffect(() => onAskDockRequest(() => {
    setActive(true);
    setFramed(true);
  }), []);
  if (!active && !phone && restored !== null && canLoad) setActive(true);

  // A docked frame pushes the page, as the docked panel does; the panel takes
  // the attribute over once it is here.
  useEffect(() => {
    if (docked) document.body.dataset.askDock = "docked";
  }, [docked]);

  // "/" focuses the field (which opens Ask). Once the dock's code is here it
  // owns the key.
  useEffect(() => {
    if (mounted) return undefined;
    const onKeyDown = (event) => {
      if (!isAskShortcutKey(event)) return;
      event.preventDefault();
      fieldRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mounted]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {mounted || phone ? null : (
        <AskDockField
          besideFab={besideFab}
          intentProps={intentProps}
          inputRef={fieldRef}
          onOpen={(file = null) => requestAskDock(file ? { open: true, file } : { open: true })}
        />
      )}
      {framed && !mounted && !phone ? (
        <aside className={`ask-dock is-${docked ? "docked" : "popup"}${besideFab ? " is-beside-fab" : ""}`} aria-labelledby="ask-page-title">
          <AskDockLoading
            onClose={() => {
              takeAskDockRequest();
              forgetAskDockOpen();
              delete document.body.dataset.askDock;
              setFramed(false);
            }}
          />
        </aside>
      ) : null}
      {active ? (
        <Suspense fallback={null}>
          <AskDockPanel
            besideFab={besideFab}
            intentProps={intentProps}
            canLoad={canLoad}
            renderConversation={renderConversation}
            takeOver={fieldRef}
            onMounted={() => setMounted(true)}
          />
        </Suspense>
      ) : null}
    </>,
    document.body
  );
}
