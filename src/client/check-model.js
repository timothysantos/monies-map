// The "Check my books" page's view-model (docs/flows/check-flow.md): the
// report from GET /api/ledger-checkup in, plain rows out. Pure and with no
// React: grouping, order, counts, "show more", notices and the hidden-money
// rules are decided here and proved in tests/check-model.test.mjs.
//
// The report is grouped by what went wrong, never listed flat: a household with
// years of unlinked card payments has about a hundred of one sort. Three
// sections (Needs fixing, Worth checking, Good to know), inside each one group
// per heading with its own count, five rows showing and the rest behind
// "Show N more". Totals come from the report's own counts (kindCounts), so a
// group that holds only the first 50 says "Showing 50 of 137".
import { checkCopy } from "./copy/check-copy.js";

export const INITIAL_ROWS = 5;
export const TIER_ORDER = ["high", "check", "note"];
const TIER_TONE = { high: "rose", check: "butter", note: "sky" };

// Which heading each kind of problem sits under. Related kinds share one
// heading (three plan problems read as "Plan problems").
const HEADING_BY_KIND = {
  wrong_card_duplicate: "wrong_card",
  duplicate_entry: "duplicates",
  duplicate_split: "duplicates",
  unmatched_transfer: "transfers",
  statement_gap: "statements",
  stale_estimate: "estimates",
  balance_mismatch: "balances",
  statement_join: "balances",
  plan_overspent: "plan",
  plan_line_unpaid: "plan",
  plan_line_no_category: "plan",
  settled_period_error: "settle_up",
  other_category: "tidy",
  odd_entry: "tidy",
  quiet_account: "tidy"
};

export function headingIdForKind(kind) {
  return HEADING_BY_KIND[kind] ?? "tidy";
}

// These say which way money went (who was charged too much, a plan that spends
// more than comes in), so with money hidden the sentence is replaced, not just
// its numbers (AGENTS.md: hidden money shows no words that reveal its sign).
const SIGN_REVEALING_KINDS = new Set(["plan_overspent", "settled_period_error", "balance_mismatch"]);

// "$1,234.56" or "IDR 159,000.00": how the report writes an amount in a sentence.
const AMOUNT_IN_TEXT = /\$[\d,]+(?:\.\d{1,2})?|\b[A-Z]{3} [\d,]+(?:\.\d{1,2})?\b/g;

export function maskAmounts(text) {
  return typeof text === "string" ? text.replace(AMOUNT_IN_TEXT, "••••") : "";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "27 Aug", with the year when it is not this year's.
export function formatShortDay(isoDate, thisYear) {
  const [year, month, day] = String(isoDate ?? "").split("-").map(Number);
  if (!year || !month || !day) return String(isoDate ?? "");
  const base = `${day} ${MONTHS[month - 1]}`;
  return year === thisYear ? base : `${base} ${year}`;
}

function evidenceLine(line, { areTotalsVisible, formatMoney, thisYear }) {
  const detail = [
    line.date ? formatShortDay(line.date, thisYear) : "",
    line.accountName ?? "",
    areTotalsVisible && Number.isFinite(line.amountMinor) ? formatMoney(line.amountMinor, line.currency ?? "SGD") : ""
  ].filter(Boolean).join(" · ");
  const clean = (text) => (areTotalsVisible ? text : maskAmounts(text));
  return {
    label: clean(String(line.label ?? "")),
    detail,
    note: line.note ? clean(String(line.note)) : ""
  };
}

function rowFor(finding, context) {
  const { areTotalsVisible, formatMoney } = context;
  const signRevealing = !areTotalsVisible && SIGN_REVEALING_KINDS.has(finding.kind);
  return {
    id: finding.id,
    kind: finding.kind,
    headingId: headingIdForKind(finding.kind),
    tier: finding.tier,
    title: signRevealing && finding.kind === "plan_overspent" ? checkCopy.item.planNeutralTitle : finding.title,
    summary: areTotalsVisible ? finding.summary : signRevealing ? checkCopy.item.moneyHidden : maskAmounts(finding.summary),
    evidence: signRevealing ? [] : (finding.evidence ?? []).map((line) => evidenceLine(line, context)),
    money: areTotalsVisible && Number.isFinite(finding.amountMinor) && finding.amountMinor > 0
      ? checkCopy.item.involved(formatMoney(finding.amountMinor, finding.currency ?? "SGD"))
      : null,
    fix: finding.fix ?? null,
    fixNote: finding.fix ? null : finding.fixNote ?? null,
    evidenceKey: finding.evidenceKey,
    dismissed: Boolean(finding.dismissed)
  };
}

function groupFor({ key, headingId, tier, count, rows, expanded, openState, defaultOpen, incompleteHeadings, clearPairCount = 0 }) {
  const isExpanded = expanded.has(key);
  const shownRows = isExpanded ? rows : rows.slice(0, INITIAL_ROWS);
  const moreCount = rows.length - shownRows.length;
  const allShown = moreCount === 0;
  const loaded = rows.filter((row) => !row.justHidden).length;
  return {
    key,
    headingId,
    heading: checkCopy.headings[headingId],
    tier,
    count,
    rows,
    shownRows,
    moreCount,
    canShowFewer: isExpanded && rows.length > INITIAL_ROWS,
    showing: allShown && loaded > 0 && loaded < count ? checkCopy.group.showing(loaded, count) : null,
    notListed: loaded === 0 && count > 0 ? checkCopy.group.notListed(count) : null,
    incomplete: incompleteHeadings.has(headingId),
    // "Link these N clear pairs", on the group of transfers waiting for their
    // other side only, and only while the server counts some.
    clearPairs: clearPairCount > 0
      ? { count: clearPairCount, explain: checkCopy.clear.explain, label: checkCopy.clear.button(clearPairCount), ariaLabel: checkCopy.clear.buttonFor(clearPairCount) }
      : null,
    // The row just hidden keeps its group open, so the Undo is in view.
    isOpen: rows.some((row) => row.justHidden) || (openState[key] ?? defaultOpen)
  };
}

function summaryParts(tierCounts) {
  return [
    { tier: "high", count: tierCounts.high, text: checkCopy.summary.needFixing(tierCounts.high) },
    { tier: "check", count: tierCounts.check, text: checkCopy.summary.worthChecking(tierCounts.check) },
    { tier: "note", count: tierCounts.note, text: checkCopy.summary.goodToKnow(tierCounts.note) }
  ].filter((part) => part.count > 0);
}

/**
 * @param {{
 *   report: any,
 *   openState?: Record<string, boolean>,
 *   expanded?: Set<string>,
 *   showHidden?: boolean,
 *   justHiddenId?: string,
 *   areTotalsVisible: boolean,
 *   formatMoney: (minor: number, currency: string) => string,
 *   formatTime: (iso: string) => string,
 *   thisYear: number
 * }} input
 */
export function buildCheckView({ report, openState = {}, expanded = new Set(), showHidden = false, justHiddenId = "", areTotalsVisible, formatMoney, formatTime, thisYear }) {
  const context = { areTotalsVisible, formatMoney, thisYear };
  const tierCounts = report.tierCounts ?? { high: 0, check: 0, note: 0 };
  const kindCounts = report.kindCounts ?? {};
  // The one just hidden stays in its place as "Hidden. Undo" (justHidden); it is
  // in no count, which come from the report.
  const live = (report.findings ?? [])
    .filter((finding) => !finding.dismissed || finding.id === justHiddenId)
    .map((finding) => ({ ...rowFor(finding, context), justHidden: Boolean(finding.dismissed) }));
  const dismissedRows = (report.findings ?? []).filter((finding) => finding.dismissed && finding.id !== justHiddenId).map((finding) => rowFor(finding, context));
  const incompleteHeadings = new Set((report.incompleteKinds ?? []).map(headingIdForKind));
  const unavailableHeadings = [...new Set((report.unavailableKinds ?? []).map(headingIdForKind))];

  // A group is one heading inside one section. Its total adds the report's
  // count for every kind under that heading in that section.
  const tiers = TIER_ORDER.map((tier) => {
    const byHeading = new Map();
    for (const row of live.filter((item) => item.tier === tier)) {
      byHeading.set(row.headingId, [...(byHeading.get(row.headingId) ?? []), row]);
    }
    for (const [kind, counts] of Object.entries(kindCounts)) {
      if ((counts?.[tier] ?? 0) > 0 && !byHeading.has(headingIdForKind(kind))) {
        byHeading.set(headingIdForKind(kind), []);
      }
    }
    const totalFor = (headingId) => Object.entries(kindCounts)
      .filter(([kind]) => headingIdForKind(kind) === headingId)
      .reduce((sum, [, counts]) => sum + (counts?.[tier] ?? 0), 0);
    return { tier, byHeading, totalFor };
  });

  const sections = tiers.map(({ tier, byHeading, totalFor }) => {
    const groups = [...byHeading.entries()]
      .map(([headingId, rows]) => groupFor({
        key: `${tier}:${headingId}`,
        headingId,
        tier,
        count: Math.max(totalFor(headingId), rows.filter((row) => !row.justHidden).length),
        rows,
        expanded,
        openState,
        defaultOpen: false,
        incompleteHeadings,
        clearPairCount: tier === "high" && headingId === "transfers" ? report.clearTransferPairCount ?? 0 : 0
      }))
      // Money first: the report already orders rows by section, money at
      // stake and recency, so a group sorts by its first row; groups with no
      // rows loaded go last.
      .sort((left, right) => {
        const leftAt = left.rows[0] ? live.indexOf(left.rows[0]) : Number.MAX_SAFE_INTEGER;
        const rightAt = right.rows[0] ? live.indexOf(right.rows[0]) : Number.MAX_SAFE_INTEGER;
        return leftAt - rightAt;
      });
    return {
      tier,
      title: checkCopy.tiers[tier].title,
      detail: checkCopy.tiers[tier].detail,
      tone: TIER_TONE[tier],
      count: tierCounts[tier] ?? 0,
      groups
    };
  }).filter((section) => section.count > 0 || section.groups.length > 0);

  // The first group of the highest section starts open; the rest are shut
  // until the person opens them (their choice is kept per device).
  const firstGroup = sections.find((section) => section.groups.length)?.groups[0];
  if (firstGroup) {
    firstGroup.isOpen = openState[firstGroup.key] ?? true;
  }

  const parts = summaryParts(tierCounts);
  const total = tierCounts.high + tierCounts.check + tierCounts.note;
  const checkedAt = report.generatedAt ? formatTime(report.generatedAt) : "";
  const isEmpty = total === 0;
  const hasGaps = unavailableHeadings.length > 0;
  const headlineText = isEmpty
    ? (hasGaps ? checkCopy.summary.partialClear : checkCopy.summary.allClear)
    : parts.map((part) => part.text).join(" · ");

  let hidden = null;
  if (showHidden && (report.dismissedCount ?? 0) > 0) {
    const byHeading = new Map();
    for (const row of dismissedRows) {
      byHeading.set(row.headingId, [...(byHeading.get(row.headingId) ?? []), row]);
    }
    hidden = {
      count: report.dismissedCount,
      groups: [...byHeading.entries()].map(([headingId, rows]) => groupFor({
        key: `hidden:${headingId}`,
        headingId,
        tier: "hidden",
        count: rows.length,
        rows,
        expanded,
        openState,
        defaultOpen: false,
        incompleteHeadings: new Set()
      }))
    };
  }

  return {
    isEmpty,
    headline: {
      text: headlineText,
      detail: isEmpty ? (hasGaps ? checkCopy.summary.partialClearDetail(checkedAt) : checkCopy.summary.allClearDetail(checkedAt)) : checkCopy.checkedAt(checkedAt),
      parts,
      tone: total === 0 ? (hasGaps ? "butter" : "mint") : tierCounts.high > 0 ? "rose" : tierCounts.check > 0 ? "butter" : "sky"
    },
    announcement: checkCopy.announceDone(headlineText),
    tiers: sections,
    hidden,
    hiddenToggle: (report.dismissedCount ?? 0) > 0
      ? (showHidden ? checkCopy.hidden.toggleOff(report.dismissedCount) : checkCopy.hidden.toggle(report.dismissedCount))
      : null,
    unavailable: unavailableHeadings.map((headingId) => ({ headingId, heading: checkCopy.headings[headingId] }))
  };
}

// "2025-07" as "Jul 2025".
function monthLabel(month) {
  const [year, number] = String(month ?? "").split("-").map(Number);
  return year && number ? `${MONTHS[number - 1]} ${year}` : "";
}

/**
 * What the "Link clear pairs" dialog shows for a preview: the count and month
 * range, the first rows, what the confirming button says. With money hidden
 * a row carries no amount at all.
 * @param {{ preview: any, areTotalsVisible: boolean, formatMoney: (minor: number, currency: string) => string, thisYear: number }} input
 */
export function buildClearPairsView({ preview, areTotalsVisible, formatMoney, thisYear }) {
  const count = preview.linkCount;
  const rows = preview.rows.map((row) => ({
    key: `${row.fromEntryId}>${row.toEntryId}`,
    date: formatShortDay(row.date, thisYear),
    amount: areTotalsVisible ? formatMoney(row.amountMinor, row.currency) : "",
    accounts: checkCopy.clear.rowFrom(row.fromAccountName, row.toAccountName)
  }));
  return {
    count,
    isEmpty: count === 0,
    title: checkCopy.clear.title(count),
    summary: checkCopy.clear.summary(count, monthLabel(preview.firstMonth), monthLabel(preview.lastMonth)),
    rows,
    moreText: count > rows.length ? checkCopy.clear.more(count - rows.length) : "",
    capNote: preview.remaining > 0 ? checkCopy.clear.capNote(count, preview.remaining) : "",
    confirmLabel: checkCopy.clear.confirm(count)
  };
}

// The line the dialog ends on.
export function describeClearPairsResult({ linked, skipped }) {
  return checkCopy.clear.result(linked, skipped);
}

// The report after "This is fine" or its undo, worked out on the page so the
// counts answer at once; the refresh that follows brings the server's own.
export function applyHiddenChange(report, finding, dismissed) {
  const step = dismissed ? -1 : 1;
  const kindCounts = { ...report.kindCounts };
  const counts = { high: 0, check: 0, note: 0, ...(kindCounts[finding.kind] ?? {}) };
  counts[finding.tier] = Math.max(0, counts[finding.tier] + step);
  kindCounts[finding.kind] = counts;
  return {
    ...report,
    tierCounts: { ...report.tierCounts, [finding.tier]: Math.max(0, report.tierCounts[finding.tier] + step) },
    kindCounts,
    dismissedCount: Math.max(0, (report.dismissedCount ?? 0) - step),
    findings: report.findings.map((item) => (item.id === finding.id ? { ...item, dismissed } : item))
  };
}
