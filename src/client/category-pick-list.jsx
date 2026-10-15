import "./category-pick.css";
import { Check, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { requestCategoryGuess } from "./category-guess-api";
import { buildCategoryList, flattenCategoryList } from "./category-pick-model";
import { categoryPickCopy as copy } from "./copy/category-pick-copy";
import { paletteColour } from "./palette-colour";
import { CategoryGlyph } from "./ui-components";

// The one category list (design.md "Category list"), drawn in a popover on a
// wide screen and in the picker sheet on a phone: a search field on top, the
// best guess first with its tag, then every other category alphabetically,
// with the current one checked wherever it sits. It never changes a category
// itself: `onChoose(value)` does, and may return a promise.
//
// - A search matches names and everyday words ("kopi" finds Food & Drinks).
// - Focus: a mouse and keyboard device (hover and a fine pointer) focuses the
//   search when the list opens, so typing just works. A touch device does not:
//   the keyboard would cover the list, so the field waits for a tap.
// - Keys, with the search focused: Up and Down move through the results,
//   Enter picks, Escape closes (the caller's dialog or popover handles it).
// - The best guess is asked for once when the list opens (only when a
//   `description` is given). The list waits for that answer for up to
//   GUESS_WAIT_MS before it draws, so rows never jump under a finger.

export const GUESS_WAIT_MS = 350;

// A mouse and keyboard device, not a touch one.
export function canFocusSearchOnOpen() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function useBestGuess(description) {
  const text = String(description ?? "").trim();
  const [state, setState] = useState({ ready: !text, guess: null });
  useEffect(() => {
    if (!text) {
      return undefined;
    }
    const controller = new AbortController();
    const finish = (guess) => setState((current) => (current.ready ? current : { ready: true, guess }));
    const timer = window.setTimeout(() => finish(null), GUESS_WAIT_MS);
    requestCategoryGuess(text, { signal: controller.signal }).then((guess) => {
      if (!controller.signal.aborted) {
        window.clearTimeout(timer);
        finish(guess);
      }
    });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [text]);
  return state;
}

/**
 * @param {{
 *   options: Array<{ value: string, label: string, icon?: any, iconKey?: string, colorHex?: string }>,
 *   value?: string | string[],
 *   multiple?: boolean,
 *   pinned?: Array<{ value: string, label: string }>,
 *   description?: string,
 *   variant?: "popover" | "sheet",
 *   onChoose: (value: string) => any,
 *   onClose?: () => void,
 *   focusSearch?: boolean
 * }} props
 */
export default function CategoryPickList({
  options,
  value = "",
  multiple = false,
  pinned = [],
  description = "",
  variant = "popover",
  onChoose,
  onClose = () => {},
  focusSearch = canFocusSearchOnOpen()
}) {
  const listId = useId();
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pendingValue, setPendingValue] = useState("");
  const [error, setError] = useState("");
  const { ready, guess } = useBestGuess(description);

  const list = useMemo(
    () => buildCategoryList({ options, value, bestGuess: guess, query, pinned }),
    [options, value, guess, query, pinned]
  );
  const rows = useMemo(() => flattenCategoryList(list), [list]);
  const isBusy = pendingValue !== "";

  useEffect(() => {
    if (focusSearch) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [focusSearch]);

  // Typing starts at the first result, so Enter picks the top match.
  function changeQuery(next) {
    setQuery(next);
    setActiveIndex(next.trim() ? 0 : -1);
  }

  function move(step) {
    if (!rows.length) {
      return;
    }
    const next = activeIndex < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, activeIndex + step));
    setActiveIndex(next);
    document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
  }

  async function choose(row) {
    if (isBusy) {
      return;
    }
    setError("");
    setPendingValue(row.value);
    try {
      const result = await onChoose(row.value);
      if (result && result.ok === false) {
        setError(result.error || copy.saveFailed);
        return;
      }
      if (!multiple) {
        onClose();
      }
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : copy.saveFailed);
    } finally {
      setPendingValue("");
    }
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row) {
        void choose(row);
      }
    }
  }

  function renderRow(row, index, extra = null) {
    const isActive = index === activeIndex;
    const colour = paletteColour(row.colorHex);
    return (
      <button
        key={`${row.value}-${index}`}
        id={`${listId}-${index}`}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={row.isCurrent}
        disabled={isBusy && pendingValue !== row.value}
        data-category-option={row.value}
        className={`category-pick-row ${row.isCurrent ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
        // The list is for pointing at: keep the search focused (and the touch
        // keyboard where it is) while a row is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => (isActive ? undefined : setActiveIndex(index))}
        onClick={() => void choose(row)}
      >
        <span className="category-pick-row-main">
          {row.icon || row.iconKey ? (
            <span className="category-pick-row-icon" style={colour ? { "--category-color": colour } : undefined} aria-hidden="true">
              {row.icon ?? <CategoryGlyph iconKey={row.iconKey} />}
            </span>
          ) : null}
          <span className="category-pick-row-label">{row.label}</span>
        </span>
        {extra}
        {row.isCurrent ? <Check size={18} aria-hidden="true" /> : null}
      </button>
    );
  }

  const bestIndex = list.pinned.length;
  const restStart = bestIndex + (list.best ? 1 : 0);
  return (
    <div className={`category-pick is-${variant}`} aria-busy={!ready || isBusy}>
      <div className="category-pick-search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 && rows[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          aria-label={copy.searchLabel}
          placeholder={copy.searchPlaceholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="category-pick-clear"
            aria-label={copy.clearSearchIcon}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              changeQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {error ? <p className="category-pick-error" role="alert">{error}</p> : null}
      <div
        className={`category-pick-options ${variant === "sheet" ? "mobile-select-options" : ""}`}
        data-sheet-body={variant === "sheet" ? "" : undefined}
      >
        {ready ? (
          <>
            {rows.length ? (
              <div
                id={listId}
                role="listbox"
                aria-label={copy.listLabel}
                aria-multiselectable={multiple || undefined}
                className="category-pick-listbox"
              >
                {list.pinned.map((row, index) => renderRow(row, index))}
                {list.best ? renderRow(list.best, bestIndex, <span className="category-pick-tag">{copy.bestGuess}</span>) : null}
                {list.rest.map((row, index) => renderRow(row, restStart + index))}
              </div>
            ) : null}
            {list.isEmpty ? (
              <div className="category-pick-empty" role="status">
                <p>{copy.noMatch(query.trim())}</p>
                <button
                  type="button"
                  className="subtle-action"
                  onClick={() => {
                    changeQuery("");
                    inputRef.current?.focus();
                  }}
                >
                  {copy.clearSearch}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
