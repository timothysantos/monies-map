// The Splits activity list in two parts: the open records by date, and one
// collapsed section per settlement at the end ("Settled up on 27 Aug ·
// 287 entries · $28,823.06"). Which records a settlement covers is the open
// period's own rule (partitionActivityBySettlement, split-open-period.ts),
// so the list, the chip and the balance can never disagree.
import { partitionActivityBySettlement } from "../domain/split-open-period";
import { formatCurrencyMinor } from "../domain/split-currency";
import { messages } from "./copy/en-SG";
import { filterSplitActivityForSearch } from "./split-search";
import { groupSplitActivityByDate } from "./split-helpers";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HIDDEN_MONEY = "••••";

/**
 * `activity` is the open group's activity outside closed batches; the search
 * narrows both parts, so a settled record that matches stays findable in its
 * section (which the page then shows opened).
 */
export function buildSplitActivitySections({ activity, checkpoints = [], searchQuery = "" }) {
  const shown = filterSplitActivityForSearch(activity, searchQuery);
  const { open, sections } = partitionActivityBySettlement(shown, checkpoints);
  return {
    shownActivity: shown,
    groupedOpenActivity: groupSplitActivityByDate(open),
    settledSections: sections.map((section) => ({
      ...section,
      currency: section.items[0]?.currency ?? "SGD",
      groups: groupSplitActivityByDate(section.items)
    }))
  };
}

// "27 Aug", or "27 Aug 2025" when it is not this year.
function settlementDay(isoDate, today) {
  const [year, month, day] = String(isoDate ?? "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }
  const sameYear = String(today ?? "").slice(0, 4) === String(year);
  return `${day} ${MONTHS[month - 1]}${sameYear ? "" : ` ${year}`}`;
}

function settledTitle(section, today) {
  const day = settlementDay(section.settlementDate, today);
  return section.isPaid ? messages.splits.settledSection.settledOn(day) : messages.splits.settledSection.simplifiedOn(day);
}

function sectionMoney(amountMinor, currency, areTotalsVisible) {
  return areTotalsVisible ? formatCurrencyMinor(amountMinor, currency) : HIDDEN_MONEY;
}

/** The section's one-line heading; the amount is dots while money is hidden. */
export function settledSectionHeading(section, { today, areTotalsVisible }) {
  return [
    settledTitle(section, today),
    messages.splits.entryCount(section.entryCount),
    sectionMoney(section.spendMinor, section.currency, areTotalsVisible)
  ].join(" · ");
}

/**
 * A settlement's row in the Archived batches sheet: when, the one payment it
 * came to (for every group it covered) and this group's entry count.
 */
export function settledSectionArchiveSummary(section, checkpoints, { viewId, areTotalsVisible }) {
  const copy = messages.splits.settledSection;
  const checkpoint = checkpoints.find((candidate) => candidate.id === section.checkpointId);
  const amount = sectionMoney(checkpoint?.amountMinor ?? 0, checkpoint?.currency ?? section.currency, areTotalsVisible);
  let subtitle = copy.evenedOut;
  if (checkpoint && checkpoint.amountMinor > 0 && checkpoint.fromPersonName && checkpoint.toPersonName) {
    const from = checkpoint.fromPersonId === viewId ? copy.you : checkpoint.fromPersonName;
    const to = checkpoint.toPersonId === viewId ? copy.youObject : checkpoint.toPersonName;
    subtitle = copy.payment({ from, to, amount, isPaid: section.isPaid });
  }
  // The row's own date column says when, so the title is short enough for a phone.
  return {
    title: section.isPaid ? copy.settledTitle : copy.simplifiedTitle,
    subtitle,
    meta: messages.splits.entryCount(section.entryCount)
  };
}

/** The Archived batches row's small line. */
export function archiveTriggerSummary(batchCount, settlementCount) {
  const copy = messages.splits.settledSection;
  if (!batchCount && !settlementCount) {
    return copy.noArchive;
  }
  return [
    batchCount ? copy.settledBatches(batchCount) : "",
    settlementCount ? copy.earlierSettleUps(settlementCount) : ""
  ].filter(Boolean).join(" · ");
}
