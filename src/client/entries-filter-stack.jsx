import { RefreshCw, Search, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { messages } from "./copy/en-SG";
import { entriesMessages } from "./copy/en-SG-entries";
import { FilterMultiSelect, FilterSelect } from "./ui-components";
import { tripEventsCopy } from "./copy/trip-events-copy";

// The filter bar is URL-state driven by Entries. Keeping it in its own route
// module prevents its mobile controls from becoming part of the first shell.
export function EntriesFilterStack({
  showMobileFilters,
  activeEntryFilterCount,
  entryFilters,
  wallets,
  entryCategoryOptions,
  searchSuggestions = [],
  hideToggle = false,
  hideRefresh = false,
  hideActions = false,
  initialTarget = "",
  onToggleMobileFilters,
  onChangeFilter,
  onChangeSearch,
  onResetFilters,
  onRefresh,
  onDone,
  // Trips and events: the trip view's name, and the Trips & events sheet.
  tripName = "",
  onOpenTrips = undefined,
  // Picking many rows: a wide screen's "Pick" starts (and stops) it.
  isPicking = false,
  onTogglePicking = undefined
}) {
  const isOpen = hideToggle ? true : showMobileFilters;
  const stackRef = useRef(null);
  // Run only when this sheet mounts, never when typing updates its URL props.
  useLayoutEffect(() => {
    if (!initialTarget) return;
    const control = stackRef.current?.querySelector(initialTarget === "search"
      ? ".search-filter-input"
      : `[data-filter-target="${initialTarget}"] button`);
    if (!control) return;
    control.scrollIntoView({ block: "nearest" });
    if (initialTarget === "search") control.focus({ preventScroll: true });
    else control.click();
  }, [initialTarget]);

  return (
    <section ref={stackRef} className={`entries-filter-stack ${isOpen ? "is-open" : ""}`}>
      {!hideToggle ? (
        <button type="button" className="entries-filter-toggle" onClick={onToggleMobileFilters}>
          <span>{activeEntryFilterCount ? `Filters · ${activeEntryFilterCount}` : "Filters"}</span>
          <span>{isOpen ? "Hide" : "Show"}</span>
        </button>
      ) : null}
      <section className="entries-filter-bar">
        {!hideRefresh ? (
          <button
            type="button"
            className="icon-action entries-filter-refresh"
            onClick={() => void onRefresh?.()}
            aria-label={messages.common.refresh}
            title={messages.common.refresh}
          >
            <RefreshCw size={18} />
          </button>
        ) : null}
        <SearchFilterInput
          label={messages.common.search}
          value={entryFilters.search}
          placeholder={entriesMessages.searchPlaceholder}
          suggestions={searchSuggestions}
          listId="entries-search-suggestions"
          onChange={(value) => onChangeSearch?.(value) ?? onChangeFilter("search", value)}
        />
        <div className="entries-filter-target" data-filter-target="wallet">
          <FilterMultiSelect
            label={entriesMessages.wallet}
            values={entryFilters.wallets}
            options={wallets}
            emptyLabel={entriesMessages.allWallets}
            selectionLabel={(selectedOptions) => {
              if (selectedOptions.length === 1) {
                return selectedOptions[0].label;
              }
              return `${selectedOptions.length} wallets`;
            }}
            onChange={(values) => onChangeFilter("wallet", values)}
          />
        </div>
        <div className="entries-filter-target" data-filter-target="category">
          <FilterMultiSelect
            label={entriesMessages.category}
            values={entryFilters.categories}
            options={entryCategoryOptions}
            emptyLabel={entriesMessages.allCategories}
            categoryPick
            selectionLabel={(selectedOptions) => {
              if (selectedOptions.length === 1) {
                return selectedOptions[0].label;
              }
              return `${selectedOptions.length} categories`;
            }}
            onChange={(values) => onChangeFilter("category", values)}
          />
        </div>
        <div className="entries-filter-target" data-filter-target="type">
          <FilterSelect
            label={entriesMessages.type}
            value={entryFilters.type}
            options={["expense", "income", "transfer"]}
            emptyLabel={entriesMessages.allTypes}
            onChange={(value) => onChangeFilter("type", value)}
          />
        </div>
        {onOpenTrips ? (
          <div className="entries-filter-target" data-filter-target="trip">
            <div className="entries-filter">
              <span className="entries-filter-label">{tripEventsCopy.rowLabel}</span>
              <button type="button" className="table-edit-input entries-filter-trip-button" data-trip-filter="" onClick={onOpenTrips}>
                <span>{tripName || tripEventsCopy.filterAll}</span>
              </button>
            </div>
          </div>
        ) : null}
        {!hideActions ? (
          <div className="entries-filter-reset">
            {onTogglePicking ? (
              <button type="button" className="subtle-action entries-filter-pick" aria-pressed={isPicking} onClick={onTogglePicking}>
                {tripEventsCopy.pick}
              </button>
            ) : null}
            <button type="button" className="subtle-action" onClick={onResetFilters}>
              {entriesMessages.resetFilters}
            </button>
            <button
              type="button"
              className="subtle-action entries-filter-hide"
              onClick={onDone ?? onToggleMobileFilters}
            >
              {onDone ? "Done" : "Hide"}
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}

export function SearchFilterInput({
  label,
  value = "",
  placeholder = "Search",
  suggestions = [],
  listId,
  className = "",
  onChange
}) {
  // The box shows what was typed at once. Its value is kept in the URL,
  // which catches up a moment later (and trims spaces): binding the box to
  // the URL alone dropped keys typed quickly and a space between words. A
  // change that is the URL catching up to something typed is ignored; any
  // other change (Reset filters, From Ask, back and forward) shows here.
  const [draft, setDraft] = useState(value ?? "");
  const sentRef = useRef(/** @type {string[]} */ ([]));
  useLayoutEffect(() => {
    const incoming = (value ?? "").trim();
    const sentIndex = sentRef.current.indexOf(incoming);
    if (sentIndex !== -1) {
      sentRef.current = sentRef.current.slice(sentIndex + 1);
      return;
    }
    sentRef.current = [];
    setDraft((current) => (current.trim() === incoming ? current : value ?? ""));
  }, [value]);
  const change = (next) => {
    setDraft(next);
    // Only a change the URL will make is waited for: a trailing space
    // leaves the URL as it was.
    const words = next.trim();
    if (words !== (sentRef.current.at(-1) ?? (value ?? "").trim())) {
      sentRef.current.push(words);
    }
    onChange(next);
  };
  return (
    <label className={`entries-filter search-filter ${className}`.trim()}>
      <span className="entries-filter-label">{label}</span>
      <span className="search-filter-control">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label={label}
          className="table-edit-input search-filter-input"
          value={draft}
          placeholder={placeholder}
          enterKeyHint="search"
          autoComplete="off"
          list={listId}
          onChange={(event) => change(event.target.value)}
        />
        {draft ? (
          <button
            type="button"
            className="search-filter-clear"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => change("")}
          >
            <X size={15} />
          </button>
        ) : null}
      </span>
      {listId ? (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}
