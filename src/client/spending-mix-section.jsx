import "./summary-body.css";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import {
  CategoryAppearancePopover,
  mixShareText,
  SpendingMixChart,
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
import { PrivateMoney } from "./money-privacy";
import { EmptyState } from "./ui-states";
import { useIsMobileLayout } from "./use-viewport";

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
// The margin around the ring holds a label line above and below.
const DONUT_SIZE = {
  phone: { height: 260, innerRadius: 62, outerRadius: 96 },
  phonePoster: { height: 340, innerRadius: 70, outerRadius: 110 },
  wide: { height: 380, innerRadius: 92, outerRadius: 142 },
  widePoster: { height: 440, innerRadius: 110, outerRadius: 168 }
};
// On Summary's dashboard the card is half the page: a donut about 250px
// across with the total in the middle (the list beside it from a 600px card,
// a window of about 1,400px; under that the list sits below it),
// and on a phone one about 280px across, the list under it.
const DASHBOARD_DONUT_SIZE = {
  phone: { height: 340, innerRadius: 92, outerRadius: 140 },
  phonePoster: { height: 420, innerRadius: 92, outerRadius: 140 },
  wide: { height: 340, innerRadius: 80, outerRadius: 125 },
  widePoster: { height: 440, innerRadius: 110, outerRadius: 168 }
};

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
 * @param {{ donutData: any[], categories: any[], onCategoryAppearanceChange: any, period?: string, sliceFacts?: (item: any, hidden: boolean) => ({ lines: string[], hasPlan: boolean } | null), dashboard?: boolean, className?: string }} props
 */
export function SpendingMixSection({
  donutData,
  categories,
  onCategoryAppearanceChange,
  period,
  sliceFacts = undefined,
  dashboard = false,
  className = ""
}) {
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
  const sizeKey = `${isMobileLayout ? "phone" : "wide"}${listShown ? "" : "Poster"}`;
  const size = (dashboard ? DASHBOARD_DONUT_SIZE : DONUT_SIZE)[sizeKey];

  function toggleCategoryVisibility(item) {
    setHiddenCategoryIds((current) => toggleHiddenDonutItemIds(current, getDonutItemId(item)));
  }

  function toggleList() {
    setListShown((current) => {
      writeListShown(!current);
      return !current;
    });
  }

  return (
    <section className={["chart-card", "spending-mix-card", className].filter(Boolean).join(" ")} data-fig-period={period}>
      <div className="chart-head spending-mix-head">
        <h3>{messages.summary.spendingMix}</h3>
        {donutData.length ? (
          <button type="button" className="subtle-action spending-mix-list-toggle" aria-expanded={listShown} onClick={toggleList}>
            {listShown ? mixCopy.hideList : mixCopy.showList}
          </button>
        ) : null}
      </div>
      {donutData.length ? (
        <div className={`summary-mix ${listShown ? "" : "is-poster"}`}>
          <div className="summary-mix-chart">
            <SpendingMixChart
              data={visibleDonutData}
              categories={categories}
              totalMinor={visibleTotalMinor}
              callouts={false}
              sliceLabels
              sliceFacts={sliceFacts}
              shareTotalMinor={totalMinor}
              fullSize
              {...size}
            />
            {hiddenCount ? (
              <button type="button" className="subtle-action donut-reset-action" onClick={() => setHiddenCategoryIds(new Set())}>
                {messages.common.resetHiddenCategories(hiddenCount)}
              </button>
            ) : null}
          </div>

          {listShown ? (
            <SpendingMixList
              label={messages.summary.spendingMix}
              items={donutData}
              topCount={topCount}
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
// Miles and cashback rides here too, for the same reason.
export { CardRewardsSection } from "./card-rewards-section";
