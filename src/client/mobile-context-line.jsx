import { islandContextCopy as copy } from "./copy/island-context-copy";
import { PAGE_FLAG, pageFlagRef } from "./page-flags";
import { useIsMobileLayout } from "./use-viewport";

// The phone island's contextual line (design.md, "Island context line"): what
// narrows the screen in plain words, and one button that undoes it. App.jsx
// puts it in the island's own row in place of the scope text (the island stays
// the same height), or on a second row when the scope is not the default and
// must stay visible. A lazy chunk: the first screen carries only the choice
// of where the line goes (App.jsx) and the live region
// (mobile-context-status.jsx).

// The summary (a button that opens the filters, or plain text) and the action button.
export function MobileContextLine({ text, textIsStatic = false, actionLabel, actionName, onAction, onOpen = undefined, actionClassName = "" }) {
  return (
    <>
      {text ? (
        textIsStatic ? (
          <span className="mobile-context-line-text">{text}</span>
        ) : (
          <button type="button" className="mobile-context-line-text" aria-label={copy.changeFilters(text)} onClick={onOpen}>
            {text}
          </button>
        )
      ) : null}
      <button type="button" className={`mobile-context-line-action${actionClassName ? ` ${actionClassName}` : ""}`} aria-label={actionName} onClick={onAction}>
        {actionLabel}
      </button>
    </>
  );
}

/**
 * What App renders for a context: Entries filters (text, Clear) or a month
 * other than this one (a way back).
 * @param {{ kind: "filters" | "month", text: string, inline: boolean, onClear?: () => void, onOpen?: () => void, onBack?: () => void }} props
 */
export function IslandContextLineBody({ kind, text, inline, onClear, onOpen, onBack }) {
  return kind === "filters" ? (
    <MobileContextLine text={text} actionLabel={copy.clear} actionName={copy.clearName} onAction={onClear} onOpen={onOpen} />
  ) : (
    // Beside the month control the month is already named, so the row has the button only.
    <MobileContextLine text={inline ? "" : copy.viewing(text)} textIsStatic actionClassName={inline ? "is-month" : ""} actionLabel={copy.backToMonth} actionName={copy.backToMonth} onAction={onBack} />
  );
}

// The island is the phone's chrome: the line never shows on a wide screen.
// (Importing the viewport hook also keeps this chunk's shared modules in one
// group with the other lazy chunks, so the first screen does not gain a file.)
// With `stacked` the line sits on its own row above the island's controls and
// holds the page flag that lifts the round buttons above it by that row; the
// row and its flag live here so the first screen does not carry page-flags.js.
export default function IslandContextLine({ stacked = false, ...props }) {
  const line = useIsMobileLayout() ? <IslandContextLineBody {...props} /> : null;
  return stacked ? (
    <div className="mobile-context-line is-stacked" ref={pageFlagRef(PAGE_FLAG.islandStacked)}>{line}</div>
  ) : line;
}
