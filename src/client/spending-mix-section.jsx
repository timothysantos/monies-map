import "./summary-body.css";
import { lazy, Suspense, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import {
  CategoryAppearancePopover,
  mixShareText,
  SpendingMixList
} from "./category-visuals";
import { messages } from "./copy/en-SG";
import { entriesMessages } from "./copy/en-SG-entries";
import { spendingMixCopy as mixCopy } from "./copy/spending-mix-copy";
import {
  getDonutItemId,
  getVisibleDonutData,
  sumDonutValueMinor,
  toggleHiddenDonutItemIds
} from "./donut-visibility";
import { getCategory, getCategoryTheme } from "./category-utils";
import { paletteColour } from "./palette-colour";
import { rowMotionProps } from "./row-motion";
import { money } from "./formatters";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { buildSpendChangeNote } from "./spend-change-model";
import { EmptyState } from "./ui-states";
import { useIsMobileLayout } from "./use-viewport";
import { CardHead, cardTitle } from "./summary-card-head";

// Spending Mix: spending by category as a donut, its slices labelled with
// their name and share where there is room (never a bare share: a label that
// cannot carry its name is left out), and a lean ranked list of the
// categories (design.md, "Summary body"): one line per category, a small
// colour dot (it edits the category), the name, amount and share, and an
// arrow that opens the category's figure menu. Desktop shows the top five,
// a phone the top three; "Show all N" lists the rest. "Hide list" folds the
// list away and the donut takes the whole card, like a poster, with every
// label that fits; the choice is remembered on the device.
//
// Each slice is an openable figure (design.md "Openable figures"): a hover
// (desktop), a tap, or Enter on a focused slice (the arrow keys move between
// slices) opens its menu with the category's quick facts first (amount and
// share, entries, and, where the page has them, `sliceFacts`: its plan and
// where most of it went), then View entries, Open plan where a plan line
// exists, and Ask about this.
//
// It follows the Summary tab's month choice: Summary (All months) passes the
// range's share, the Month page the picked month's (month-spending-mix.js).
// A row's main tap hides or shows its slice. Without spending it shows the
// empty state the Entries breakdown uses. The whole section is a lazy chunk
// beside the first screen.
const LIST_KEY = "monies-map:spending-mix-list";
const LazySpendingMixBubbles = lazy(() => import("./spending-mix-bubbles.jsx"));

function readListShown() {
  try {
    return window.localStorage.getItem(LIST_KEY) !== "hidden";
  } catch {
    return true;
  }
}

function writeListShown(shown) {
  try {
    window.localStorage.setItem(LIST_KEY, shown ? "shown" : "hidden");
  } catch {
    // Blocked storage: the choice lasts for the visit.
  }
}

/**
 * @param {{ donutData: any[], categories: any[], onCategoryAppearanceChange: any, period?: string, sliceFacts?: (item: any, hidden: boolean) => ({ lines: string[], hasPlan: boolean } | null), dashboard?: boolean, spendChange?: any, className?: string }} props
 */
export function SpendingMixSection({
  donutData,
  categories,
  onCategoryAppearanceChange,
  period,
  sliceFacts = undefined,
  dashboard = false,
  spendChange = undefined,
  className = ""
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const changeNote = useMemo(() => buildSpendChangeNote(spendChange, { hidden: !areTotalsVisible }), [spendChange, areTotalsVisible]);
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState(() => new Set());
  const [listShown, setListShown] = useState(readListShown);
  const isMobileLayout = useIsMobileLayout();
  const topCount = isMobileLayout ? 3 : 5;
  const visibleDonutData = useMemo(
    () => getVisibleDonutData(donutData, hiddenCategoryIds),
    [donutData, hiddenCategoryIds]
  );
  const visibleTotalMinor = sumDonutValueMinor(visibleDonutData);
  // Shares are of all spending, so they do not move when a slice is hidden.
  const totalMinor = sumDonutValueMinor(donutData);
  // Hidden categories stay hidden across months and ranges; the reset counts
  // only the ones this data has, so a month without them shows no reset.
  const hiddenCount = donutData.filter((item) => hiddenCategoryIds.has(getDonutItemId(item))).length;
  // Each slice carries its category's colour and own icon (the donut's bubbles).
  const chartData = useMemo(
    () => visibleDonutData.map((item, index) => ({ ...item, ...getCategoryTheme(categories, item, index) })),
    [visibleDonutData, categories]
  );
  const [listExpanded, setListExpanded] = useState(false);

  function toggleCategoryVisibility(item) {
    setHiddenCategoryIds((current) => toggleHiddenDonutItemIds(current, getDonutItemId(item)));
  }

  function toggleList() {
    setListShown((current) => {
      writeListShown(!current);
      return !current;
    });
  }

  const listToggle = donutData.length ? (
    <button type="button" className="subtle-action spending-mix-list-toggle" aria-expanded={listShown} onClick={toggleList}>
      {listShown ? mixCopy.hideList : mixCopy.showList}
    </button>
  ) : null;

  return (
    <section className={["chart-card", "spending-mix-card", dashboard ? "is-dashboard" : "", className].filter(Boolean).join(" ")} data-fig-period={period}>
      {/* Summary's card wears the shared head; Month's has the same title and no period line. */}
      {dashboard ? <CardHead id="mix" className="spending-mix-head is-spaced" context={{ first: period.split(":")[0], last: period.split(":")[1] }} action={listToggle} /> : (
        <div className="chart-head spending-mix-head">
          <h3>{cardTitle("mix")}</h3>
          {listToggle}
        </div>
      )}
      {donutData.length ? (
        <div className={`summary-mix ${listShown ? "" : "is-poster"}`}>
          <div className="summary-mix-chart">
            <p className="summary-mix-total">
              <span className="summary-mix-total-amount" data-total-spend><PrivateMoney>{money(visibleTotalMinor)}</PrivateMoney></span>
              {changeNote ? (
                <span className="summary-mix-note" data-change-note>
                  <b className={changeNote.tone === "mint" ? "money-in" : "money-short"}>{changeNote.arrow} {changeNote.percent}%</b>{" "}
                  {mixCopy.changeVs(changeNote.months, changeNote.partial)}
                </span>
              ) : null}
            </p>
            <Suspense fallback={<div className={`spending-mix-bubbles-reserve ${listShown ? "" : "is-poster"}`} aria-hidden="true" />}>
              <LazySpendingMixBubbles
                chartData={chartData}
                shareTotalMinor={totalMinor}
                sliceFacts={sliceFacts}
                poster={!listShown}
                onShowAll={listShown ? () => setListExpanded(true) : undefined}
              />
            </Suspense>
            {hiddenCount ? (
              <button type="button" className="subtle-action donut-reset-action" onClick={() => setHiddenCategoryIds(new Set())}>
                {messages.common.resetHiddenCategories(hiddenCount)}
              </button>
            ) : null}
          </div>

          {listShown ? (
            <SpendingMixList
              label={cardTitle("mix")}
              items={donutData}
              topCount={topCount}
              expanded={listExpanded}
              onExpandedChange={setListExpanded}
              renderRow={(item, index) => {
                const category = getCategory(categories, item);
                const categoryName = category?.name ?? item.label;
                const isHidden = hiddenCategoryIds.has(getDonutItemId(item));
                return (
                  <div
                    key={item.key}
                    data-fig-row={categoryName}
                    className={`summary-mix-row motion-row ${isHidden ? "is-hidden-from-donut" : ""}`}
                    {...rowMotionProps(
                      { name: categoryName, iconKey: category?.iconKey, color: getCategoryTheme(categories, item, index).color },
                      { "--bar-color": paletteColour(getCategoryTheme(categories, item, index).color) }
                    )}
                  >
                    <CategoryAppearancePopover category={category} onChange={onCategoryAppearanceChange} />
                    <button
                      type="button"
                      className="summary-mix-main"
                      aria-pressed={!isHidden}
                      onClick={() => toggleCategoryVisibility(item)}
                    >
                      <strong className="summary-mix-name">{categoryName}</strong>
                      {isHidden ? <span className="summary-mix-state">{messages.common.hiddenFromChart}</span> : null}
                      <span className="summary-mix-amount"><PrivateMoney>{money(item.valueMinor)}</PrivateMoney></span>
                      <span className="summary-mix-percent">{mixShareText(item.valueMinor, totalMinor)}</span>
                    </button>
                    <button
                      type="button"
                      className="summary-mix-arrow"
                      aria-label={messages.common.viewEntriesFor(categoryName)}
                      title={messages.common.viewEntries}
                      data-fig="category"
                      data-fig-arg={categoryName}
                      data-fig-colour={paletteColour(getCategoryTheme(categories, item, index).color)}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                );
              }}
            />
          ) : null}
        </div>
      ) : (
        <EmptyState compact title={entriesMessages.noSpendBreakdown}>{entriesMessages.noSpendBreakdownDetail}</EmptyState>
      )}
    </section>
  );
}

// Subscriptions and bills rides in this chunk: a lazy chunk of its own made
// the bundler move React out of the entry into a shared first-screen file
// (check:bundle). Both load beside the first screen; its data waits for
// the top summary to be usable.
export { PaceChartSection, SubscriptionsSection } from "./subscriptions-section";
// Investments over time and Tax reliefs ride here too, for the same reason.
export { InvestmentsCard } from "./investments-card";
export { TaxReliefsCard } from "./tax-reliefs-card";
export { SummaryChangedSection } from "./summary-changed-section";
// The tiles and the sheet that opens a card from one ride here too.
export { SummaryTile, SummaryTileSheet } from "./summary-tiles";
// Miles and cashback rides here too, for the same reason.
export { CardRewardsSection } from "./card-rewards-section";
