// Fixing on the "Check my books" page and coming back (docs/flows/check-flow.md,
// "Fixing and coming back"): which problems can be fixed in place, the
// optimistic removal and its rollback, the line "Fixed. 3 things left.", the
// row to focus next, and the marker that gives the next page its way back.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyResolved,
  applyUnresolved,
  buildCheckView,
  describeCheckChange,
  inPlaceFor,
  nextRowIdAfter,
  reportTotal
} from "../src/client/check-model.js";
import { createCheckOwner } from "../src/client/check-data-owner.js";
import {
  forgetReturnToCheck,
  isReturnToCheckOver,
  planReturnToCheck,
  readReturnToCheck,
  rememberReturnToCheck,
  returnToCheckFor
} from "../src/client/return-to-check.js";

const entryFix = (id) => ({ label: "Open the transfer and link them", path: `/entries?view=household&month=2026-09&editing_entry=${id}` });

function finding(overrides = {}) {
  return {
    id: "unmatched_transfer:txn-a+txn-b", kind: "unmatched_transfer", tier: "high", title: "Two sides of one transfer are not linked", summary: "$450.00 left UOB.",
    evidence: [], amountMinor: null, currency: "SGD", occurredOn: "2026-09-02", personIds: [], fix: entryFix("txn-a"), fixNote: null, evidenceKey: "k", dismissed: false, ...overrides
  };
}

function report(findings, extra = {}) {
  const tierCounts = { high: 0, check: 0, note: 0 };
  const kindCounts = {};
  for (const item of findings) {
    tierCounts[item.tier] += 1;
    kindCounts[item.kind] = { high: 0, check: 0, note: 0, ...kindCounts[item.kind] };
    kindCounts[item.kind][item.tier] += 1;
  }
  return { generatedAt: "2026-10-27T07:42:00.000Z", tierCounts, kindCounts, dismissedCount: 0, findings, moreByKind: {}, incompleteKinds: [], unavailableKinds: [], clearTransferPairCount: 0, ...extra };
}

test("a pair with exactly one match is fixed by linking the two; other transfers open the transfer dialog", () => {
  assert.deepEqual(inPlaceFor(finding()), { type: "link_pair", entryIds: ["txn-a", "txn-b"] });
  // Several possible matches: the id names only the transfer.
  assert.deepEqual(inPlaceFor(finding({ id: "unmatched_transfer:txn-c", tier: "check", fix: entryFix("txn-c") })), { type: "transfer", entryId: "txn-c" });
  // No match at all, a series: the latest one opens its details.
  assert.deepEqual(inPlaceFor(finding({ id: "unmatched_transfer:series:acc:out:45000:SGD", tier: "note", fix: entryFix("txn-z") })), { type: "transfer", entryId: "txn-z" });
});

test("a settled-period mistake is corrected in place, from the record in its own link", () => {
  const fix = { label: "Correct this settled mistake", path: "/splits?view=household&month=2026-10&split_group=g1&correct_settled=split-expense-9" };
  assert.deepEqual(inPlaceFor(finding({ id: "settled_period_error:s1", kind: "settled_period_error", fix })), { type: "correct_settled", recordId: "split-expense-9" });
});

test("everything else stays a page to open, and a problem with no fix has no fix here", () => {
  for (const kind of ["wrong_card_duplicate", "duplicate_entry", "duplicate_split", "statement_gap", "statement_join", "balance_mismatch", "stale_estimate", "plan_overspent", "plan_line_unpaid", "plan_line_no_category", "other_category", "odd_entry", "quiet_account"]) {
    assert.equal(inPlaceFor(finding({ id: `${kind}:x`, kind })), null, kind);
  }
  assert.equal(inPlaceFor(finding({ fix: null })), null);
  // A transfer whose link carries no entry cannot open its dialog.
  assert.equal(inPlaceFor(finding({ id: "unmatched_transfer:txn-c", fix: { label: "Open", path: "/entries?view=household" } })), null);
  // A settled mistake without its record does not offer the correction.
  assert.equal(inPlaceFor(finding({ id: "settled_period_error:s1", kind: "settled_period_error", fix: { label: "x", path: "/splits?view=household" } })), null);
});

test("rows carry the fix here, its words, the quiet page link, and keep the report's own fix for the rest", () => {
  const settled = finding({ id: "settled_period_error:s1", kind: "settled_period_error", tier: "check", fix: { label: "Correct this settled mistake", path: "/splits?view=household&month=2026-10&correct_settled=r1" } });
  const view = buildCheckView({
    report: report([finding(), settled, finding({ id: "odd_entry:o", kind: "odd_entry", tier: "note", fix: { label: "Open the entry", path: "/entries?view=household&month=2026-09&editing_entry=e1" } })]),
    areTotalsVisible: true,
    formatMoney: (minor) => `$${minor}`,
    formatTime: () => "today",
    thisYear: 2026
  });
  const rows = view.tiers.flatMap((section) => section.groups.flatMap((group) => group.rows));
  const byKind = Object.fromEntries(rows.map((row) => [row.kind, row]));
  assert.equal(byKind.unmatched_transfer.inPlace.label, "Link these two");
  assert.equal(byKind.unmatched_transfer.openLabel, "Open in Entries");
  assert.equal(byKind.unmatched_transfer.month, "2026-09");
  assert.equal(byKind.settled_period_error.inPlace.label, "Correct this");
  assert.equal(byKind.settled_period_error.openLabel, "Open in Splits");
  assert.equal(byKind.odd_entry.inPlace, null);
  assert.equal(byKind.odd_entry.openLabel, null);
  assert.equal(byKind.odd_entry.fix.label, "Open the entry");
});

test("taking a problem out moves the list and its counts, and putting it back restores them exactly", () => {
  const first = finding();
  const second = finding({ id: "unmatched_transfer:txn-c+txn-d" });
  const odd = finding({ id: "odd_entry:o", kind: "odd_entry", tier: "note", fix: null });
  const before = report([first, second, odd]);
  const after = applyResolved(before, first);
  assert.deepEqual(after.findings.map((item) => item.id), [second.id, odd.id]);
  assert.deepEqual(after.tierCounts, { high: 1, check: 0, note: 1 });
  assert.deepEqual(after.kindCounts.unmatched_transfer, { high: 1, check: 0, note: 0 });
  assert.equal(after.dismissedCount, 0);
  assert.equal(reportTotal(after), 2);
  // Not a hidden one: nothing is marked as fine.
  assert.ok(!after.findings.some((item) => item.dismissed));
  assert.deepEqual(applyUnresolved(after, first, 0), before);
  // Neither step does anything twice.
  assert.equal(applyResolved(after, first), after);
  assert.equal(applyUnresolved(before, first, 0), before);
  // A problem the page does not list leaves the counts alone.
  assert.equal(applyResolved(before, finding({ id: "unmatched_transfer:other" })), before);
});

test("the line after a fix says how many are left, or that nothing changed", () => {
  assert.equal(describeCheckChange(5, 3), "Fixed. 3 things left.");
  assert.equal(describeCheckChange(2, 1), "Fixed. 1 thing left.");
  assert.equal(describeCheckChange(1, 0), "Fixed. Nothing left.");
  assert.equal(describeCheckChange(4, 4), "Nothing changed.");
  assert.equal(describeCheckChange(4, 6), "Nothing changed.");
  // Nothing to compare with: no line.
  assert.equal(describeCheckChange(null, 3), "");
  assert.equal(describeCheckChange(3, undefined), "");
});

test("focus goes to the next row of the group, or the one before when the last was fixed", () => {
  assert.equal(nextRowIdAfter(["a", "b", "c"], "a"), "b");
  assert.equal(nextRowIdAfter(["a", "b", "c"], "b"), "c");
  assert.equal(nextRowIdAfter(["a", "b", "c"], "c"), "b");
  assert.equal(nextRowIdAfter(["a"], "a"), "");
  assert.equal(nextRowIdAfter(["a", "b"], "gone"), "");
});

const fetchRequiredQuery = async ({ fetcher, signal }) => fetcher({ signal });
function ownerFor(bodyReport) {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, ...bodyReport }) });
  return createCheckOwner({ fetchRequiredQuery, fetchImpl });
}

test("resolving in place removes the row at once and keeps it gone when the command is kept", async () => {
  const first = finding();
  const owner = ownerFor(report([first, finding({ id: "unmatched_transfer:txn-c+txn-d" })]));
  await owner.run({ viewId: "household" });
  let seenDuringWrite = null;
  const ok = await owner.resolveInPlace(first, async () => {
    seenDuringWrite = owner.getSnapshot().report.findings.map((item) => item.id);
    return true;
  });
  assert.equal(ok, true);
  // The write was asked for while the row was already gone.
  assert.deepEqual(seenDuringWrite, ["unmatched_transfer:txn-c+txn-d"]);
  assert.equal(owner.getSnapshot().report.tierCounts.high, 1);
  assert.equal(owner.getSnapshot().writeError, "");
});

test("a refused or failed command puts the row back where it stood and says so", async () => {
  for (const write of [async () => false, async () => { throw new Error("offline"); }]) {
    const rows = [finding({ id: "unmatched_transfer:txn-a+txn-b" }), finding({ id: "unmatched_transfer:txn-c+txn-d" }), finding({ id: "unmatched_transfer:txn-e+txn-f" })];
    const owner = ownerFor(report(rows));
    await owner.run({ viewId: "household" });
    const ok = await owner.resolveInPlace(rows[1], write);
    assert.equal(ok, false);
    const state = owner.getSnapshot();
    assert.deepEqual(state.report.findings.map((item) => item.id), rows.map((item) => item.id));
    assert.deepEqual(state.report.tierCounts, { high: 3, check: 0, note: 0 });
    assert.equal(state.writeError, "fix");
  }
});

test("a read that was running when a fix landed is read again, so it cannot bring the row back", async () => {
  const first = finding();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  const fetchImpl = async () => {
    reads += 1;
    if (reads === 2) {
      await gate;
      // The stale answer, from before the fix, still lists the row.
      return { ok: true, status: 200, json: async () => ({ ok: true, ...report([first]) }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, ...(reads === 1 ? report([first]) : report([])) }) };
  };
  const owner = createCheckOwner({ fetchRequiredQuery, fetchImpl });
  await owner.run({ viewId: "household" });
  const refreshing = owner.refresh();
  await owner.resolveInPlace(first, async () => true);
  release();
  await refreshing;
  assert.deepEqual(owner.getSnapshot().report.findings, []);
  assert.equal(reads, 3);
});

test("the marker for the next page is read back checked, and a path outside the app is refused", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  assert.equal(readReturnToCheck(storage), null);
  rememberReturnToCheck(storage, { id: "1", destPath: "/entries", checkPath: "/check?view=person-tim", scrollY: 640.4, before: 7, expanded: ["high:transfers", 3], checkIdx: 2 });
  assert.deepEqual(readReturnToCheck(storage), { id: "1", destPath: "/entries", checkPath: "/check?view=person-tim", scrollY: 640, before: 7, expanded: ["high:transfers"], checkIdx: 2 });
  forgetReturnToCheck(storage);
  assert.equal(readReturnToCheck(storage), null);
  for (const bad of [{ id: "1", destPath: "https://elsewhere.example" }, { id: "1", destPath: "//elsewhere.example" }, { id: "", destPath: "/entries" }, { destPath: "/entries" }]) {
    rememberReturnToCheck(storage, bad);
    assert.equal(readReturnToCheck(storage), null, JSON.stringify(bad));
  }
  // The way back is Check's own address, whatever was kept.
  rememberReturnToCheck(storage, { id: "2", destPath: "/splits", checkPath: "/settings?x=1" });
  assert.equal(readReturnToCheck(storage).checkPath, "/check");
  store.set("monies.returnToCheck.v1", "{not json");
  assert.equal(readReturnToCheck(storage), null);
});

test("the link shows only on the page Check sent the person to, and the hop ends anywhere else", () => {
  const marker = { id: "1", destPath: "/entries", checkPath: "/check", scrollY: 0, before: 3, expanded: [], checkIdx: 4 };
  assert.equal(returnToCheckFor(marker, "/entries"), marker);
  assert.equal(returnToCheckFor(marker, "/splits"), null);
  assert.equal(returnToCheckFor(null, "/entries"), null);
  assert.equal(isReturnToCheckOver(marker, "/entries"), false);
  // Check itself reads and forgets the marker, so the shell leaves it for Check.
  assert.equal(isReturnToCheckOver(marker, "/check"), false);
  assert.equal(isReturnToCheckOver(marker, "/splits"), true);
  assert.equal(isReturnToCheckOver(marker, "/month"), true);
  assert.equal(isReturnToCheckOver(null, "/month"), false);
});

test("the link goes back one step when the page is the very next history entry, else opens Check", () => {
  const marker = { id: "1", destPath: "/entries", checkPath: "/check?view=person-tim", scrollY: 0, before: 3, expanded: [], checkIdx: 4 };
  assert.deepEqual(planReturnToCheck(marker, 5), { kind: "history" });
  assert.deepEqual(planReturnToCheck(marker, 6), { kind: "navigate", to: { pathname: "/check", search: "?view=person-tim" } });
  assert.deepEqual(planReturnToCheck(marker, undefined), { kind: "navigate", to: { pathname: "/check", search: "?view=person-tim" } });
  assert.deepEqual(planReturnToCheck({ ...marker, checkIdx: null }, 5), { kind: "navigate", to: { pathname: "/check", search: "?view=person-tim" } });
});
