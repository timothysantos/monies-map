import { useEffect, useRef, useState } from "react";

import { entryLinkCopy as copy } from "./copy/entry-link-copy";
import { useIsMobileLayout } from "./use-viewport";

// Writes the link to the clipboard. "copied" when the browser took it,
// "failed" when there is no clipboard or the browser refused (a permission,
// an insecure page, a document without focus): never throws.
export async function writeLinkToClipboard(link, clipboard = globalThis.navigator?.clipboard) {
  try {
    if (typeof clipboard?.writeText !== "function") return "failed";
    await clipboard.writeText(link);
    return "copied";
  } catch {
    return "failed";
  }
}

// What the control and its message say for a copy state ("idle", "copied",
// "failed") on a phone or a wider screen.
export function entryLinkCopyWords(state, isPhone) {
  return {
    label: state === "copied" ? copy.copied : copy.copy,
    message: state === "failed" ? (isPhone ? copy.failedPhone : copy.failedDesktop) : ""
  };
}

const COPIED_FOR_MS = 1800;

// The entry editor's Copy link. When the clipboard is refused it says so in
// the app (never a browser alert) and shows the link, selected, so the person
// can copy it by hand.
export function EntryLinkCopyButton({ buildLink }) {
  const isPhone = useIsMobileLayout();
  const [state, setState] = useState("idle");
  const [link, setLink] = useState("");
  const linkRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const words = entryLinkCopyWords(state, isPhone);

  useEffect(() => {
    if (state !== "copied") return undefined;
    const timer = window.setTimeout(() => setState("idle"), COPIED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state !== "failed") return;
    linkRef.current?.focus({ preventScroll: true });
    linkRef.current?.select();
  }, [state]);

  async function handleCopy() {
    const nextLink = buildLink();
    setLink(nextLink);
    setState(await writeLinkToClipboard(nextLink));
  }

  return (
    <>
      <button type="button" className="lsd-quiet" onClick={() => void handleCopy()}>{words.label}</button>
      {state === "failed" ? (
        <span className="entry-link-copy-fallback">
          <span className="entry-link-copy-message" role="status">{words.message}</span>
          <input
            ref={linkRef}
            className="entry-link-copy-field"
            type="text"
            readOnly
            value={link}
            aria-label={copy.linkLabel}
            onFocus={(event) => event.currentTarget.select()}
          />
        </span>
      ) : null}
    </>
  );
}
