// The client side of "Link these N clear pairs" (docs/flows/check-flow.md,
// "Link clear pairs"): the group carries the button only on the high group of
// transfers waiting for their other side and only while the server counts some;
// the dialog's view-model (count, month range, first rows, cap note, confirm
// label, hidden money); the readers refuse what is not a preview; the owner's
// two calls hit the right routes, send exactly the pairs shown and throw when
// nothing was linked.
import assert from "node:assert/strict";
import test from "node:test";

import { buildClearPairsPath, postLinkClearPairs, readCheckupReport, readClearPairsPreview } from "../src/client/check-api.js";
import { createCheckOwner } from "../src/client/check-data-owner.js";
import { buildCheckView, buildClearPairsView, describeClearPairsResult } from "../src/client/check-model.js";

const formatMoney = (minor) => `$${(minor / 100).toFixed(2)}`;
const formatTime = () => "27 Oct 2026, 3:42 pm";
const base = { areTotalsVisible: true, formatMoney, formatTime, thisYear: 2026 };

const transferFinding = (id, tier = "high") => ({
  id, kind: "unmatched_transfer", tier, title: "Two sides of one transfer are not linked", summary: "A $450.00 move.", evidence: [], amountMinor: null, currency: "SGD",
  occurredOn: "2026-09-03", personIds: [], fix: { label: "Open the transfer and link them", path: "/entries?editing_entry=x" }, fixNote: null, evidenceKey: "aa", dismissed: false
});
const report = (overrides = {}) => ({
  ok: true, generatedAt: "2026-10-27T07:42:00.000Z", tierCounts: { high: 3, check: 1, note: 0 },
  kindCounts: { unmatched_transfer: { high: 2, check: 1, note: 0 }, duplicate_entry: { high: 1, check: 0, note: 0 } },
  dismissedCount: 0, moreByKind: {}, incompleteKinds: [], unavailableKinds: [], clearTransferPairCount: 2,
  findings: [transferFinding("unmatched_transfer:1"), transferFinding("unmatched_transfer:2"), transferFinding("unmatched_transfer:3", "check"), { ...transferFinding("duplicate_entry:1"), kind: "duplicate_entry" }],
  ...overrides
});
const groups = (view) => view.tiers.flatMap((section) => section.groups);

test("only the high group of transfers waiting for their other side carries the button, and the count is the server's", () => {
  const withButton = groups(buildCheckView({ report: report(), ...base })).filter((group) => group.clearPairs);
  assert.deepEqual(withButton.map((group) => group.key), ["high:transfers"]);
  assert.deepEqual({ ...withButton[0].clearPairs }, {
    count: 2,
    explain: "Only pairs with exactly one possible match on each side.",
    label: "Link these 2 clear pairs",
    ariaLabel: "Link these 2 clear pairs of transfers"
  });
  assert.equal(groups(buildCheckView({ report: report({ clearTransferPairCount: 1 }), ...base })).find((group) => group.clearPairs).clearPairs.label, "Link this clear pair");
  // None counted, or a report from before the count existed: no button.
  for (const missing of [report({ clearTransferPairCount: 0 }), (({ clearTransferPairCount, ...rest }) => rest)(report())]) {
    assert.deepEqual(groups(buildCheckView({ report: missing, ...base })).filter((group) => group.clearPairs), []);
  }
});

const preview = (overrides = {}) => ({
  total: 92, cap: 100, linkCount: 92, remaining: 0, firstMonth: "2025-07", lastMonth: "2026-08",
  pairs: Array.from({ length: 92 }, (_, index) => ({ fromEntryId: `o${index}`, toEntryId: `i${index}` })),
  rows: Array.from({ length: 10 }, (_, index) => ({ fromEntryId: `o${index}`, toEntryId: `i${index}`, date: index === 0 ? "2025-07-01" : "2026-08-01", amountMinor: 45_000, currency: "SGD", fromAccountName: "UOB Savings", toAccountName: "Joyce Bank" })),
  ...overrides
});

test("the dialog names the count, the months and the first ten pairs, and what the button says", () => {
  const view = buildClearPairsView({ preview: preview(), areTotalsVisible: true, formatMoney, thisYear: 2026 });
  assert.equal(view.title, "Link 92 clear pairs");
  assert.equal(view.summary, "92 pairs, Jul 2025 to Aug 2026");
  assert.equal(view.rows.length, 10);
  assert.deepEqual({ ...view.rows[0] }, { key: "o0>i0", date: "1 Jul 2025", amount: "$450.00", accounts: "UOB Savings → Joyce Bank" });
  assert.equal(view.rows[1].date, "1 Aug");
  assert.equal(view.moreText, "and 82 more");
  assert.equal(view.capNote, "");
  assert.equal(view.confirmLabel, "Link 92 pairs");
  assert.equal(view.isEmpty, false);
});

test("at the cap the dialog says how many are left; one pair and one month read naturally; an empty preview is empty", () => {
  const capped = buildClearPairsView({ preview: preview({ total: 130, linkCount: 100, remaining: 30, pairs: Array.from({ length: 100 }, (_, index) => ({ fromEntryId: `o${index}`, toEntryId: `i${index}` })) }), areTotalsVisible: true, formatMoney, thisYear: 2026 });
  assert.equal(capped.confirmLabel, "Link 100 pairs");
  assert.equal(capped.capNote, "This links the first 100. 30 more pairs are still waiting afterwards.");
  const one = buildClearPairsView({ preview: preview({ total: 1, linkCount: 1, remaining: 1 - 1, firstMonth: "2026-08", lastMonth: "2026-08", pairs: [{ fromEntryId: "o0", toEntryId: "i0" }], rows: preview().rows.slice(0, 1) }), areTotalsVisible: true, formatMoney, thisYear: 2026 });
  assert.equal(one.summary, "1 pair in Aug 2026");
  assert.equal(one.confirmLabel, "Link 1 pair");
  assert.equal(one.moreText, "");
  const oneLeft = buildClearPairsView({ preview: preview({ linkCount: 100, remaining: 1, pairs: [] }), areTotalsVisible: true, formatMoney, thisYear: 2026 });
  assert.match(oneLeft.capNote, /1 more pair is still waiting/);
  const empty = buildClearPairsView({ preview: preview({ total: 0, linkCount: 0, pairs: [], rows: [], firstMonth: null, lastMonth: null }), areTotalsVisible: true, formatMoney, thisYear: 2026 });
  assert.equal(empty.isEmpty, true);
  assert.equal(empty.summary, "0 pairs");
});

test("with money hidden no row carries an amount", () => {
  const view = buildClearPairsView({ preview: preview(), areTotalsVisible: false, formatMoney, thisYear: 2026 });
  assert.deepEqual(view.rows.map((row) => row.amount), Array(10).fill(""));
  assert.doesNotMatch(JSON.stringify(view), /\$|450/);
});

test("the result line says what was linked and what changed", () => {
  assert.equal(describeClearPairsResult({ linked: 92, skipped: 0 }), "Linked 92 pairs. 0 skipped.");
  assert.equal(describeClearPairsResult({ linked: 90, skipped: 2 }), "Linked 90 pairs. 2 changed since you looked and were skipped.");
  assert.equal(describeClearPairsResult({ linked: 1, skipped: 1 }), "Linked 1 pair. 1 changed since you looked and was skipped.");
});

test("the readers keep a good answer and refuse what is not one", () => {
  const body = { ok: true, total: 2, cap: 100, linkCount: 2, remaining: 0, firstMonth: "2026-01", lastMonth: "2026-02", pairs: [{ fromEntryId: "o1", toEntryId: "i1" }, { fromEntryId: 5 }, { fromEntryId: "o2", toEntryId: "i2" }], rows: [{ fromEntryId: "o1", toEntryId: "i1", date: "2026-01-02", amountMinor: 100, currency: "SGD", fromAccountName: "A", toAccountName: "B" }, { fromEntryId: "o2" }] };
  const read = readClearPairsPreview(body);
  assert.deepEqual(read.pairs, [{ fromEntryId: "o1", toEntryId: "i1" }, { fromEntryId: "o2", toEntryId: "i2" }]);
  assert.equal(read.rows.length, 1);
  assert.equal(read.linkCount, 2);
  for (const bad of [null, [], { ok: false, pairs: [], rows: [] }, { ok: true, pairs: "x", rows: [] }, { ok: true, pairs: [] }]) {
    assert.equal(readClearPairsPreview(bad), null);
  }
  assert.equal(readCheckupReport({ ok: true, findings: [], tierCounts: {}, clearTransferPairCount: 7.9 }).clearTransferPairCount, 7);
  assert.equal(readCheckupReport({ ok: true, findings: [], tierCounts: {} }).clearTransferPairCount, 0);
  assert.equal(buildClearPairsPath({ viewId: "household" }), "/api/ledger-checkup/clear-pairs");
  assert.equal(buildClearPairsPath({ viewId: "person-joyce" }), "/api/ledger-checkup/clear-pairs?view=person-joyce");
});

const fetchRequiredQuery = async ({ fetcher, signal }) => fetcher({ signal });
function ownerWith(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    const answer = await handler(url, init);
    return { ok: answer.ok ?? true, status: answer.status ?? 200, json: async () => answer.body ?? {} };
  };
  return { owner: createCheckOwner({ fetchRequiredQuery, fetchImpl }), calls };
}

test("the owner reads the preview for the person's view and sends exactly the pairs it was given", async () => {
  const { owner, calls } = ownerWith((url, init) => (init.method === "POST"
    ? { body: { ok: true, linked: [{}, {}], skipped: [{}] } }
    : { body: { ok: true, total: 1, cap: 100, remaining: 0, pairs: [{ fromEntryId: "o1", toEntryId: "i1" }], rows: [] } }));
  const shown = await owner.loadClearPairs({ viewId: "person-tim" });
  assert.equal(calls[0].url, "/api/ledger-checkup/clear-pairs?view=person-tim");
  const result = await owner.linkClearPairs(shown.pairs);
  assert.deepEqual(result, { linked: 2, skipped: 1 });
  assert.deepEqual(calls[1], { url: "/api/ledger-checkup/clear-pairs", method: "POST", body: { pairs: [{ fromEntryId: "o1", toEntryId: "i1" }] } });
});

test("a failed link throws, so nothing is claimed; a refused preview throws too", async () => {
  const failing = ownerWith(() => ({ ok: false, status: 500, body: { ok: false, error: "Nothing was linked. Try again." } }));
  await assert.rejects(() => failing.owner.linkClearPairs([{ fromEntryId: "o1", toEntryId: "i1" }]));
  await assert.rejects(() => failing.owner.loadClearPairs({ viewId: "household" }));
  await assert.rejects(() => postLinkClearPairs([], async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })), "an answer with no result is not a success");
  const garbled = ownerWith(() => ({ body: { nonsense: true } }));
  await assert.rejects(() => garbled.owner.loadClearPairs({ viewId: "household" }));
});

test("a check that was running when the link landed is read again, so it cannot bring a linked pair back", async () => {
  const stale = { ok: true, generatedAt: "2026-10-27T07:42:00.000Z", tierCounts: { high: 1, check: 0, note: 0 }, kindCounts: { unmatched_transfer: { high: 1, check: 0, note: 0 } }, dismissedCount: 0, findings: [transferFinding("unmatched_transfer:1")], moreByKind: {}, incompleteKinds: [], unavailableKinds: [], clearTransferPairCount: 1 };
  const fresh = { ...stale, tierCounts: { high: 0, check: 0, note: 0 }, kindCounts: {}, findings: [], clearTransferPairCount: 0 };
  let reads = 0;
  let releaseFirst;
  const { owner } = ownerWith(async (url, init) => {
    if (init.method === "POST") return { body: { ok: true, linked: [{}], skipped: [] } };
    reads += 1;
    if (reads === 1) {
      await new Promise((resolve) => { releaseFirst = resolve; });
      return { body: stale };
    }
    return { body: fresh };
  });
  const running = owner.run({ viewId: "household" });
  while (!releaseFirst) await new Promise((resolve) => setTimeout(resolve, 1));
  await owner.linkClearPairs([{ fromEntryId: "o1", toEntryId: "i1" }]);
  releaseFirst();
  await running;
  assert.equal(owner.getSnapshot().report.clearTransferPairCount, 0);
  assert.equal(reads, 2);
});
