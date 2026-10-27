// The "Check my books" view-model (src/client/check-model.js): grouping by
// heading inside three sections, the counts the report carries, "show more",
// the notices and the hidden-money rules. Concrete shapes and values, with the
// refused paths: money hidden shows no amount and no sentence that says which
// way money went; a group never claims more than it holds.
import assert from "node:assert/strict";
import test from "node:test";

import { applyHiddenChange, buildCheckView, formatShortDay, headingIdForKind, maskAmounts } from "../src/client/check-model.js";

const formatMoney = (minor, currency) => (currency === "SGD" ? `$${(minor / 100).toFixed(2)}` : `${currency} ${(minor / 100).toFixed(2)}`);
const formatTime = () => "27 Oct 2026, 3:42 pm";
const base = { areTotalsVisible: true, formatMoney, formatTime, thisYear: 2026 };

function finding(overrides = {}) {
  const id = overrides.id ?? `unmatched_transfer:a${Math.random().toString(16).slice(2, 8)}`;
  return {
    id,
    kind: "unmatched_transfer",
    tier: "high",
    title: "Two sides of one transfer are not linked",
    summary: "A $450.00 transfer out of UOB Savings and a $450.00 transfer into OCBC 365 are the same move.",
    evidence: [{ role: "entry", label: "FAST to Joyce", date: "2026-09-03", amountMinor: 45000, currency: "SGD", accountName: "UOB Savings" }],
    amountMinor: null,
    currency: "SGD",
    occurredOn: "2026-09-03",
    personIds: [],
    fix: { label: "Open the entry", path: "/entries?view=household&month=2026-09&editing_entry=txn-1" },
    fixNote: null,
    evidenceKey: "00aa",
    dismissed: false,
    ...overrides
  };
}

function report(overrides = {}) {
  return {
    ok: true,
    generatedAt: "2026-10-27T07:42:00.000Z",
    tierCounts: { high: 0, check: 0, note: 0 },
    kindCounts: {},
    dismissedCount: 0,
    findings: [],
    moreByKind: {},
    incompleteKinds: [],
    unavailableKinds: [],
    ...overrides
  };
}

// 3 to fix (two transfers, one wrong card), 2 to check, 4 good to know.
function mixedReport() {
  const findings = [
    finding({ id: "wrong_card_duplicate:1", kind: "wrong_card_duplicate", title: "Counted twice on two cards", amountMinor: 784 }),
    finding({ id: "unmatched_transfer:1" }),
    finding({ id: "unmatched_transfer:2" }),
    finding({ id: "duplicate_entry:1", kind: "duplicate_entry", tier: "check", title: "Two entries look the same", amountMinor: 1200 }),
    finding({ id: "duplicate_split:1", kind: "duplicate_split", tier: "check", title: "May be entered twice in Splits", amountMinor: 52592 }),
    finding({ id: "quiet_account:1", kind: "quiet_account", tier: "note", title: "An account has gone quiet", fix: null, fixNote: "Nothing to fix in the books." }),
    finding({ id: "other_category:1", kind: "other_category", tier: "note", title: "Could be filed under a better category" }),
    finding({ id: "unmatched_transfer:3", tier: "note", title: "A transfer with no matching entry" }),
    finding({ id: "unmatched_transfer:4", tier: "note", title: "A transfer with no matching entry" })
  ];
  return report({
    findings,
    tierCounts: { high: 3, check: 2, note: 4 },
    kindCounts: {
      wrong_card_duplicate: { high: 1, check: 0, note: 0 },
      unmatched_transfer: { high: 2, check: 0, note: 2 },
      duplicate_entry: { high: 0, check: 1, note: 0 },
      duplicate_split: { high: 0, check: 1, note: 0 },
      quiet_account: { high: 0, check: 0, note: 1 },
      other_category: { high: 0, check: 0, note: 1 }
    }
  });
}

test("every kind sits under one of the nine plain headings, and related kinds share one", () => {
  assert.equal(headingIdForKind("duplicate_entry"), headingIdForKind("duplicate_split"));
  assert.equal(headingIdForKind("plan_overspent"), "plan");
  assert.equal(headingIdForKind("plan_line_unpaid"), "plan");
  assert.equal(headingIdForKind("statement_join"), "balances");
  assert.equal(headingIdForKind("odd_entry"), "tidy");
  assert.equal(headingIdForKind("settled_period_error"), "settle_up");
  assert.equal(new Set([
    "wrong_card_duplicate", "duplicate_split", "duplicate_entry", "unmatched_transfer", "statement_gap", "statement_join",
    "stale_estimate", "balance_mismatch", "plan_overspent", "plan_line_unpaid", "plan_line_no_category", "settled_period_error",
    "other_category", "odd_entry", "quiet_account"
  ].map(headingIdForKind)).size, 9);
});

test("the summary counts match the report and read in plain words", () => {
  const view = buildCheckView({ ...base, report: mixedReport() });
  assert.equal(view.headline.text, "3 things need fixing · 2 worth checking · 4 good to know");
  assert.deepEqual(view.headline.parts.map((part) => [part.tier, part.count]), [["high", 3], ["check", 2], ["note", 4]]);
  assert.equal(view.headline.tone, "rose");
  assert.equal(view.isEmpty, false);
  assert.equal(view.announcement, "Check finished. 3 things need fixing · 2 worth checking · 4 good to know.");
  assert.deepEqual(view.tiers.map((section) => [section.title, section.tone, section.count]), [
    ["Needs fixing", "rose", 3], ["Worth checking", "butter", 2], ["Good to know", "sky", 4]
  ]);
});

test("one thing to fix reads in the singular, and zero parts are left out", () => {
  const one = buildCheckView({ ...base, report: report({ tierCounts: { high: 1, check: 0, note: 0 }, kindCounts: { odd_entry: { high: 1, check: 0, note: 0 } }, findings: [finding({ kind: "odd_entry" })] }) });
  assert.equal(one.headline.text, "1 thing needs fixing");
  const noteOnly = buildCheckView({ ...base, report: report({ tierCounts: { high: 0, check: 0, note: 2 }, kindCounts: { odd_entry: { high: 0, check: 0, note: 2 } }, findings: [] }) });
  assert.equal(noteOnly.headline.text, "2 good to know");
  assert.equal(noteOnly.headline.tone, "sky");
});

test("an empty report says everything checks out, with the time it was checked", () => {
  const view = buildCheckView({ ...base, report: report() });
  assert.equal(view.isEmpty, true);
  assert.equal(view.headline.text, "Everything checks out");
  assert.equal(view.headline.detail, "Checked 27 Oct 2026, 3:42 pm. Nothing looks wrong in your entries, statements, shared expenses or plans.");
  assert.equal(view.headline.tone, "mint");
  assert.deepEqual(view.tiers, []);
});

test("an empty report with a check that could not run never claims a full all-clear", () => {
  const view = buildCheckView({ ...base, report: report({ unavailableKinds: ["duplicate_entry", "duplicate_split", "statement_gap"] }) });
  assert.equal(view.isEmpty, true);
  assert.equal(view.headline.text, "Nothing found in the checks that ran");
  assert.match(view.headline.detail, /not a full all-clear/);
  assert.equal(view.headline.tone, "butter");
  // Two kinds under one heading are one notice.
  assert.deepEqual(view.unavailable, [
    { headingId: "duplicates", heading: "Possible duplicates" },
    { headingId: "statements", heading: "Missing statements" }
  ]);
});

test("rows are grouped by heading inside their section, never flat, with the report's totals", () => {
  const view = buildCheckView({ ...base, report: mixedReport() });
  const [high, check, note] = view.tiers;
  assert.deepEqual(high.groups.map((group) => [group.heading, group.count, group.rows.length]), [
    ["Purchases that may be on the wrong card", 1, 1],
    ["Transfers waiting for their other side", 2, 2]
  ]);
  // Two kinds under one heading add up inside one group.
  assert.deepEqual(check.groups.map((group) => [group.heading, group.count, group.rows.length]), [["Possible duplicates", 2, 2]]);
  assert.deepEqual(new Set(note.groups.map((group) => `${group.heading}:${group.count}`)), new Set(["Tidy-ups:2", "Transfers waiting for their other side:2"]));
  // A group is keyed by section and heading, so one heading in two sections is two groups.
  assert.ok(high.groups.some((group) => group.key === "high:transfers"));
  assert.ok(note.groups.some((group) => group.key === "note:transfers"));
});

test("groups follow the report's order: money at stake first, a group with no money after", () => {
  const view = buildCheckView({ ...base, report: mixedReport() });
  // wrong card carries $7.84; the transfers carry none and sort behind it.
  assert.deepEqual(view.tiers[0].groups.map((group) => group.headingId), ["wrong_card", "transfers"]);
});

test("only the first group of the highest section starts open; a saved choice wins", () => {
  const view = buildCheckView({ ...base, report: mixedReport() });
  const open = view.tiers.flatMap((section) => section.groups).filter((group) => group.isOpen).map((group) => group.key);
  assert.deepEqual(open, ["high:wrong_card"]);

  const saved = buildCheckView({ ...base, report: mixedReport(), openState: { "high:wrong_card": false, "check:duplicates": true } });
  const savedOpen = saved.tiers.flatMap((section) => section.groups).filter((group) => group.isOpen).map((group) => group.key);
  assert.deepEqual(savedOpen, ["check:duplicates"]);
});

test("the first group to open is the first of the highest section that has one", () => {
  const view = buildCheckView({ ...base, report: report({
    tierCounts: { high: 0, check: 0, note: 1 },
    kindCounts: { quiet_account: { high: 0, check: 0, note: 1 } },
    findings: [finding({ id: "quiet_account:1", kind: "quiet_account", tier: "note" })]
  }) });
  assert.deepEqual(view.tiers.flatMap((section) => section.groups).filter((group) => group.isOpen).map((group) => group.key), ["note:tidy"]);
});

function transferReport(loaded, total, { extra = {} } = {}) {
  const findings = Array.from({ length: loaded }, (_, index) => finding({ id: `unmatched_transfer:${String(index).padStart(3, "0")}`, tier: "high" }));
  return report({
    findings,
    tierCounts: { high: total, check: 0, note: 0 },
    kindCounts: { unmatched_transfer: { high: total, check: 0, note: 0 } },
    moreByKind: total > loaded ? { unmatched_transfer: total - loaded } : {},
    ...extra
  });
}

test("a group shows five rows, then 'Show N more' for the rest it holds", () => {
  const view = buildCheckView({ ...base, report: transferReport(12, 12) });
  const [group] = view.tiers[0].groups;
  assert.equal(group.shownRows.length, 5);
  assert.equal(group.moreCount, 7);
  assert.equal(group.showing, null);
  assert.equal(group.canShowFewer, false);

  const expanded = buildCheckView({ ...base, report: transferReport(12, 12), expanded: new Set(["high:transfers"]) });
  const [open] = expanded.tiers[0].groups;
  assert.equal(open.shownRows.length, 12);
  assert.equal(open.moreCount, 0);
  assert.equal(open.canShowFewer, true);
});

test("a group of five or fewer has no 'show more' and no 'show fewer'", () => {
  const [group] = buildCheckView({ ...base, report: transferReport(5, 5), expanded: new Set(["high:transfers"]) }).tiers[0].groups;
  assert.equal(group.moreCount, 0);
  assert.equal(group.canShowFewer, false);
});

test("more exist than the 50 the report sent: the group says 'Showing 50 of N', and the section count stays whole", () => {
  const view = buildCheckView({ ...base, report: transferReport(50, 137), expanded: new Set(["high:transfers"]) });
  const [group] = view.tiers[0].groups;
  assert.equal(group.count, 137);
  assert.equal(group.rows.length, 50);
  assert.equal(group.showing, "Showing 50 of 137");
  assert.equal(view.tiers[0].count, 137);
  assert.equal(view.headline.text, "137 things need fixing");
  // Not yet expanded: the 'show more' button comes first, the note after it.
  const collapsed = buildCheckView({ ...base, report: transferReport(50, 137) });
  assert.equal(collapsed.tiers[0].groups[0].moreCount, 45);
  assert.equal(collapsed.tiers[0].groups[0].showing, null);
});

test("a kind whose higher rows used up the 50 leaves a lower group with a count and no rows", () => {
  const findings = Array.from({ length: 50 }, (_, index) => finding({ id: `unmatched_transfer:h${index}`, tier: "high" }));
  const view = buildCheckView({ ...base, report: report({
    findings,
    tierCounts: { high: 50, check: 0, note: 12 },
    kindCounts: { unmatched_transfer: { high: 50, check: 0, note: 12 } },
    moreByKind: { unmatched_transfer: 12 }
  }) });
  const noteGroup = view.tiers.find((section) => section.tier === "note").groups[0];
  assert.equal(noteGroup.count, 12);
  assert.equal(noteGroup.rows.length, 0);
  assert.equal(noteGroup.notListed, "12 more are not listed yet. Sort out the ones above first.");
});

test("a kind whose read hit its limit says there may be more than shown, on that group only", () => {
  const view = buildCheckView({ ...base, report: { ...mixedReport(), incompleteKinds: ["unmatched_transfer"] } });
  const flags = view.tiers.flatMap((section) => section.groups).map((group) => [group.key, group.incomplete]);
  assert.deepEqual(flags.filter(([, incomplete]) => incomplete).map(([key]) => key).sort(), ["high:transfers", "note:transfers"]);
  assert.equal(flags.find(([key]) => key === "high:wrong_card")[1], false);
});

test("a row carries its sentence, its evidence lines, the money and the fix", () => {
  const view = buildCheckView({ ...base, report: mixedReport() });
  const row = view.tiers[0].groups[0].rows[0];
  assert.equal(row.title, "Counted twice on two cards");
  assert.equal(row.money, "$7.84 involved");
  assert.deepEqual(row.evidence, [{ label: "FAST to Joyce", detail: "3 Sep · UOB Savings · $450.00", note: "" }]);
  assert.deepEqual(row.fix, { label: "Open the entry", path: "/entries?view=household&month=2026-09&editing_entry=txn-1" });
  assert.equal(row.fixNote, null);
  assert.equal(row.evidenceKey, "00aa");
  // The short id is for developers and never reaches a row.
  assert.equal(JSON.stringify(row).includes("shortId"), false);
});

test("with no fix the row shows its quiet note; with a fix the note is dropped", () => {
  const view = buildCheckView({ ...base, report: mixedReport() });
  const quiet = view.tiers[2].groups.flatMap((group) => group.rows).find((row) => row.kind === "quiet_account");
  assert.equal(quiet.fix, null);
  assert.equal(quiet.fixNote, "Nothing to fix in the books.");
  const withBoth = buildCheckView({ ...base, report: report({ tierCounts: { high: 1, check: 0, note: 0 }, kindCounts: { odd_entry: { high: 1, check: 0, note: 0 } }, findings: [finding({ kind: "odd_entry", fixNote: "ignored" })] }) });
  assert.equal(withBoth.tiers[0].groups[0].rows[0].fixNote, null);
});

test("an amount of zero or none shows no money line", () => {
  const view = buildCheckView({ ...base, report: report({ tierCounts: { high: 1, check: 0, note: 0 }, kindCounts: { odd_entry: { high: 1, check: 0, note: 0 } }, findings: [finding({ kind: "odd_entry", amountMinor: 0 })] }) });
  assert.equal(view.tiers[0].groups[0].rows[0].money, null);
});

test("another currency keeps its code in the money line", () => {
  const view = buildCheckView({ ...base, report: report({ tierCounts: { high: 1, check: 0, note: 0 }, kindCounts: { stale_estimate: { high: 1, check: 0, note: 0 } }, findings: [finding({ kind: "stale_estimate", amountMinor: 15900000, currency: "IDR" })] }) });
  assert.equal(view.tiers[0].groups[0].rows[0].money, "IDR 159000.00 involved");
});

test("hidden money: no amount anywhere, the counts stay", () => {
  const sentence = "This $7.84 purchase is on two cards, and IDR 159,000.00 more went to the other one.";
  const view = buildCheckView({ ...base, areTotalsVisible: false, report: report({
    tierCounts: { high: 1, check: 0, note: 0 },
    kindCounts: { wrong_card_duplicate: { high: 1, check: 0, note: 0 } },
    findings: [finding({ kind: "wrong_card_duplicate", summary: sentence, amountMinor: 784, evidence: [
      { role: "entry", label: "Coffee", date: "2026-10-01", amountMinor: 784, currency: "SGD", accountName: "UOB One", note: "$7.84 on the other card" }
    ] })]
  }) });
  const row = view.tiers[0].groups[0].rows[0];
  assert.equal(row.summary, "This •••• purchase is on two cards, and •••• more went to the other one.");
  assert.equal(row.money, null);
  assert.deepEqual(row.evidence, [{ label: "Coffee", detail: "1 Oct · UOB One", note: "•••• on the other card" }]);
  assert.equal(view.headline.text, "1 thing needs fixing");
  assert.equal(/\$\s?\d|\d,\d{3}/.test(JSON.stringify(view)), false);
});

test("hidden money: a sentence that says which way money went is replaced, not just masked", () => {
  const view = buildCheckView({ ...base, areTotalsVisible: false, report: report({
    tierCounts: { high: 2, check: 1, note: 0 },
    kindCounts: { settled_period_error: { high: 1, check: 0, note: 0 }, plan_overspent: { high: 0, check: 1, note: 0 }, balance_mismatch: { high: 1, check: 0, note: 0 } },
    findings: [
      finding({ id: "settled_period_error:1", kind: "settled_period_error", title: "A settled cost was counted twice", summary: "Joyce was charged $525.93 too much.", amountMinor: 52593 }),
      finding({ id: "balance_mismatch:1", kind: "balance_mismatch", title: "The statement no longer matches", summary: "The books are $12.00 below the statement." }),
      finding({ id: "plan_overspent:1", kind: "plan_overspent", tier: "check", title: "The plan spends more than comes in", summary: "October plans $300.00 more than comes in." })
    ]
  }) });
  const rows = view.tiers.flatMap((section) => section.groups).flatMap((group) => group.rows);
  for (const row of rows) {
    assert.equal(row.summary, "Money is hidden. Show money totals to read this.");
    assert.deepEqual(row.evidence, []);
  }
  assert.equal(rows.find((row) => row.kind === "plan_overspent").title, "The plan needs a look");
  assert.equal(rows.find((row) => row.kind === "settled_period_error").title, "A settled cost was counted twice");
});

test("with money shown the same rows keep their sentences and amounts", () => {
  const view = buildCheckView({ ...base, report: report({
    tierCounts: { high: 1, check: 0, note: 0 },
    kindCounts: { settled_period_error: { high: 1, check: 0, note: 0 } },
    findings: [finding({ id: "settled_period_error:1", kind: "settled_period_error", summary: "Joyce was charged $525.93 too much.", amountMinor: 52593 })]
  }) });
  assert.equal(view.tiers[0].groups[0].rows[0].summary, "Joyce was charged $525.93 too much.");
});

test("masking leaves words, dates and counts alone", () => {
  assert.equal(maskAmounts("12 entries from 3 Sep cost $1,234.56 and USD 9.99."), "12 entries from 3 Sep cost •••• and ••••.");
  assert.equal(maskAmounts(undefined), "");
});

test("hidden items: the toggle shows the count, and only an opened list carries the rows", () => {
  const withHidden = { ...mixedReport(), dismissedCount: 2 };
  assert.equal(buildCheckView({ ...base, report: withHidden }).hiddenToggle, "Show hidden (2)");
  assert.equal(buildCheckView({ ...base, report: withHidden }).hidden, null);
  assert.equal(buildCheckView({ ...base, report: mixedReport() }).hiddenToggle, null);

  const dismissed = [
    finding({ id: "unmatched_transfer:d1", dismissed: true }),
    finding({ id: "odd_entry:d2", kind: "odd_entry", tier: "check", dismissed: true })
  ];
  const open = buildCheckView({ ...base, showHidden: true, report: { ...withHidden, findings: [...withHidden.findings, ...dismissed] } });
  assert.equal(open.hiddenToggle, "Hide hidden (2)");
  assert.deepEqual(open.hidden.groups.map((group) => [group.heading, group.rows.length, group.isOpen]), [["Transfers waiting for their other side", 1, false], ["Tidy-ups", 1, false]]);
  // Hidden rows never count in the sections or the summary.
  assert.equal(open.tiers[0].groups.flatMap((group) => group.rows).some((row) => row.dismissed), false);
  assert.equal(open.headline.text, "3 things need fixing · 2 worth checking · 4 good to know");
});

test("hiding one row moves the counts at once, and showing it again puts them back", () => {
  const start = mixedReport();
  const target = start.findings.find((item) => item.id === "unmatched_transfer:1");
  const hidden = applyHiddenChange(start, target, true);
  assert.deepEqual(hidden.tierCounts, { high: 2, check: 2, note: 4 });
  assert.deepEqual(hidden.kindCounts.unmatched_transfer, { high: 1, check: 0, note: 2 });
  assert.equal(hidden.dismissedCount, 1);
  const view = buildCheckView({ ...base, report: hidden });
  assert.equal(view.headline.text, "2 things need fixing · 2 worth checking · 4 good to know");
  assert.equal(view.tiers[0].groups.find((group) => group.headingId === "transfers").rows.length, 1);

  const restored = applyHiddenChange(hidden, target, false);
  assert.deepEqual(restored.tierCounts, start.tierCounts);
  assert.deepEqual(restored.kindCounts, start.kindCounts);
  assert.equal(restored.dismissedCount, 0);
  assert.equal(restored.findings.find((item) => item.id === target.id).dismissed, false);
  // Counts never go below zero.
  assert.equal(applyHiddenChange(report({ tierCounts: { high: 0, check: 0, note: 0 }, findings: [target] }), target, true).tierCounts.high, 0);
});

test("the row just hidden stays in its place as 'Hidden. Undo' and keeps its group open, in no count", () => {
  const start = mixedReport();
  const target = start.findings.find((item) => item.id === "unmatched_transfer:1");
  const hidden = applyHiddenChange(start, target, true);
  const view = buildCheckView({ ...base, report: hidden, justHiddenId: target.id, openState: { "high:transfers": false } });
  const group = view.tiers[0].groups.find((item) => item.headingId === "transfers");
  assert.deepEqual(group.rows.map((row) => [row.id, row.justHidden]), [["unmatched_transfer:1", true], ["unmatched_transfer:2", false]]);
  assert.equal(group.isOpen, true);
  // The group's total and the summary come from the report: one fewer than before.
  assert.equal(group.count, 1);
  assert.equal(view.headline.text, "2 things need fixing · 2 worth checking · 4 good to know");
  // Without the marker the row is simply gone.
  const gone = buildCheckView({ ...base, report: hidden });
  assert.deepEqual(gone.tiers[0].groups.find((item) => item.headingId === "transfers").rows.map((row) => row.id), ["unmatched_transfer:2"]);
});

test("a group holding the row just hidden does not claim 'Showing N of M' for it", () => {
  const rows = Array.from({ length: 50 }, (_, index) => finding({ id: `unmatched_transfer:${index}`, tier: "high" }));
  const start = report({ findings: rows, tierCounts: { high: 137, check: 0, note: 0 }, kindCounts: { unmatched_transfer: { high: 137, check: 0, note: 0 } } });
  const hidden = applyHiddenChange(start, rows[0], true);
  const view = buildCheckView({ ...base, report: hidden, justHiddenId: rows[0].id, expanded: new Set(["high:transfers"]) });
  assert.equal(view.tiers[0].groups[0].showing, "Showing 49 of 136");
});

test("dates read as day and month, with the year only when it is not this year's", () => {
  assert.equal(formatShortDay("2026-08-27", 2026), "27 Aug");
  assert.equal(formatShortDay("2025-12-02", 2026), "2 Dec 2025");
  assert.equal(formatShortDay("", 2026), "");
});
