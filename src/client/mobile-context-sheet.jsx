import "./mobile-context-sheet.css";
import "./mobile-sheet-head.css";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { messages } from "./copy/en-SG";
import { mobileContextCopy as copy } from "./copy/mobile-context-copy";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { useKeyboardInset } from "./use-keyboard-inset";
import { BottomActions } from "./ui-components";

// The island's context line shares this chunk (App.jsx loads it from here): the
// sheet is where filters are set, so the chunk is usually loaded already, and
// a chunk of its own would split React DOM out of the first screen.
export { default as IslandContextLine } from "./mobile-context-line.jsx";

const EntriesFilterStack = lazy(() => import("./entries-filter-stack.jsx").then((module) => ({ default: module.EntriesFilterStack })));

// The inside of the phone's View and scope sheet, in the Lead · Support ·
// Detail language (design.md, "Phone chrome"). Lead: who you are viewing, with the scope and
// what it counts. Support: the view and the scope as segmented chips. Detail:
// the Entries filters as quiet rows that open the existing pickers. Reset
// filters and Done sit in the bottom bar. It swipes down to close
// (SheetSwipeDismiss lives here, so the first screen never carries the
// gesture code). App.jsx owns the dialog (its Portal, Content and head stay
// in the first-screen chunk so Radix is not split out of it), every choice
// and the URL; this only lays the inside out. The person chip comes in as an
// element: importing App's own modules here would make this chunk import the
// entry chunk and split the first screen into more files.
export default function MobileContextSheetBody({
  viewLabel,
  personChip,
  people,
  selectedViewId,
  scopeLabel,
  scopeHint,
  scopes,
  selectedScopeKey,
  scrollToFilters = false,
  filterProps,
  onViewChange,
  onScopeChange,
  onClose
}) {
  // The search field can open the phone keyboard: the sheet (this body's
  // parent, App's Dialog.Content) lifts itself above it with its bottom bar.
  const [body, setBody] = useState(/** @type {HTMLElement | null} */ (null));
  useKeyboardInset(body?.parentElement ?? null);
  // Opened from the island's filter summary: start at the filters.
  const filtersRef = useRef(/** @type {HTMLElement | null} */ (null));
  useEffect(() => {
    if (scrollToFilters) {
      filtersRef.current?.scrollIntoView({ block: "start" });
    }
  }, [scrollToFilters]);
  return (
    <>
      <SheetSwipeDismiss onClose={onClose} />
      <div ref={setBody} className="mobile-context-body" data-sheet-body>
        <section className="mobile-context-lead" aria-label={viewLabel}>
          {personChip}
          {scopeLabel ? <strong className="mobile-context-lead-scope">{scopeLabel}</strong> : null}
          {scopeHint ? <span className="mobile-context-lead-hint">{scopeHint}</span> : null}
        </section>

        <section className="mobile-context-support">
          <div className="mobile-context-group" role="group" aria-label={copy.viewGroup}>
            <span className="mobile-context-group-title" aria-hidden="true">{copy.viewGroup}</span>
            <div className="mobile-context-segments">
              <button
                type="button"
                className="mobile-context-segment"
                aria-pressed={selectedViewId === "household"}
                onClick={() => onViewChange("household")}
              >
                {messages.views.household}
              </button>
              {people.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="mobile-context-segment"
                  aria-pressed={selectedViewId === person.id}
                  title={person.name}
                  onClick={() => onViewChange(person.id)}
                >
                  {person.name}
                </button>
              ))}
            </div>
          </div>
          {scopes.length > 1 ? (
            <div className="mobile-context-group" role="group" aria-label={copy.scopeGroup}>
              <span className="mobile-context-group-title" aria-hidden="true">{copy.scopeGroup}</span>
              <div className="mobile-context-segments">
                {scopes.map((scope) => (
                  <button
                    key={scope.key}
                    type="button"
                    className="mobile-context-segment"
                    aria-pressed={scope.key === selectedScopeKey}
                    onClick={() => onScopeChange(scope.key)}
                  >
                    {scope.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {filterProps ? (
          <section ref={filtersRef} className="mobile-context-filters" aria-label={copy.filtersGroup}>
            <Suspense fallback={null}>
              <EntriesFilterStack {...filterProps} hideActions />
            </Suspense>
          </section>
        ) : null}
      </div>

      <BottomActions
        className="is-sheet-bar mobile-context-actions"
        quietLabel={filterProps ? messages.entries.resetFilters : null}
        onQuiet={filterProps?.onResetFilters}
        primaryLabel={copy.done}
        onPrimary={onClose}
      />
    </>
  );
}
