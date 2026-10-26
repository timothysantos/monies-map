// The Splits activity list in two parts: the open records by date, and one
// collapsed section per settlement at the end ("Settled up on 27 Aug ·
// 287 entries · $28,823.06"). Which records a settlement covers is the open
// period's own rule (partitionActivityBySettlement, split-open-period.ts),
// so the list, the chip and the balance can never disagree.
import { compareSettledSections, partitionActivityBySettlement } from "../domain/split-open-period";
import { formatCurrencyMinor } from "../domain/split-currency";
import { splitsMessages } from "./copy/en-SG-splits";
import { filterSplitActivityForSearch } from "./split-search";
import { groupSplitActivityByDate } from "./split-helpers";

// The section's and its archive row's words. They live here, with the lazy
// Splits route, not in the first screen's copy file.
const settledCopy = {
  settledOn: (day) => `Settled up on ${day}`,
  simplifiedOn: (day) => `Simplified on ${day}`,
  settledTitle: "Settled up",
  simplifiedTitle: "Simplified, not paid yet",
  you: "You",
  youObject: "you",
  payment: ({ from, to, amount, isPaid }) => `${from} ${isPaid ? "paid" : from === "You" ? "pay" : "pays"} ${to} ${amount} for every group`,
  evenedOut: "Nothing to pay: the groups evened out",
  noArchive: "No settled batches yet",
  settledBatches: (count) => `${count} settled ${count === 1 ? "batch" : "batches"}`,
  earlierSettleUps: (count) => `${count} earlier ${count === 1 ? "settle-up" : "settle-ups"}`
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HIDDEN_MONEY = "••••";

function withDateGroups(section, extra) {
  return { ...section, ...extra, groups: groupSplitActivityByDate(section.items) };
}

/**
 * `activity` is the open group's activity outside closed batches: the page
 * holds only the open records. Each settled section comes as a summary
 * (`summaries`, from the page) whose rows arrive when it is opened
 * (`sectionRows(checkpointId)`: `{ status, items }`, splits-settled-rows.js).
 * A search narrows both parts: the open records here, the settled ones on
 * the server (`searchResults`, the same rule), so a settled record that
 * matches stays findable in its section, which the page shows opened with
 * the matches' own count and total.
 */
export function buildSplitActivitySections({
  activity,
  summaries = [],
  checkpoints = [],
  searchQuery = "",
  sectionRows = (_checkpointId) => null,
  searchResults = []
}) {
  const shown = filterSplitActivityForSearch(activity, searchQuery);
  // The page's own records are outside every section; a covered one that is
  // here anyway (an older page) still gets its section.
  const { open, sections: heldSections } = partitionActivityBySettlement(shown, checkpoints);
  let settledSections;
  if (searchQuery.trim()) {
    const matches = filterSplitActivityForSearch(searchResults, searchQuery);
    const { sections } = partitionActivityBySettlement([...heldSections.flatMap((section) => section.items), ...matches], checkpoints);
    settledSections = sections.map((section) => withDateGroups(section, {
      groupId: section.items[0]?.groupId,
      currency: section.items[0]?.currency ?? "SGD",
      status: "ready"
    }));
  } else {
    const summarised = summaries.map((summary) => {
      const rows = sectionRows(summary.checkpointId);
      return withDateGroups({ ...summary, items: rows?.items ?? [] }, { status: rows?.status ?? "idle", truncated: Boolean(rows?.truncated) });
    });
    const held = heldSections
      .filter((section) => !summaries.some((summary) => summary.checkpointId === section.checkpointId))
      .map((section) => withDateGroups(section, { currency: section.items[0]?.currency ?? "SGD", status: "ready" }));
    settledSections = [...summarised, ...held].sort(compareSettledSections);
  }
  return {
    shownActivity: shown,
    groupedOpenActivity: groupSplitActivityByDate(open),
    settledSections
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
  return section.isPaid ? settledCopy.settledOn(day) : settledCopy.simplifiedOn(day);
}

function sectionMoney(amountMinor, currency, areTotalsVisible) {
  return areTotalsVisible ? formatCurrencyMinor(amountMinor, currency) : HIDDEN_MONEY;
}

/** The section's one-line heading; the amount is dots while money is hidden. */
export function settledSectionHeading(section, { today, areTotalsVisible }) {
  return [
    settledTitle(section, today),
    splitsMessages.entryCount(section.entryCount),
    sectionMoney(section.spendMinor, section.currency, areTotalsVisible)
  ].join(" · ");
}

/**
 * A settlement's row in the Archived batches sheet: when, the one payment it
 * came to (for every group it covered) and this group's entry count.
 */
export function settledSectionArchiveSummary(section, checkpoints, { viewId, areTotalsVisible }) {
  const copy = settledCopy;
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
    meta: splitsMessages.entryCount(section.entryCount)
  };
}

/** The Archived batches row's small line. */
export function archiveTriggerSummary(batchCount, settlementCount) {
  const copy = settledCopy;
  if (!batchCount && !settlementCount) {
    return copy.noArchive;
  }
  return [
    batchCount ? copy.settledBatches(batchCount) : "",
    settlementCount ? copy.earlierSettleUps(settlementCount) : ""
  ].filter(Boolean).join(" · ");
}
