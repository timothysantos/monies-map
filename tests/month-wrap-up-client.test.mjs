// The Month wrap-up card on the client (month-wrap-up-api.js,
// month-wrap-up-model.js): the reader keeps only what it understands, and
// the card's rows say each check's words, figures and one action; with
// money hidden there is no amount, no tone and no word of who owes whom;
// a month with everything done is one line.
import assert from "node:assert/strict";
import test from "node:test";

import { monthWrapUpEndpoint, readMonthWrapUp, requestMonthWrapUp } from "../src/client/month-wrap-up-api.js";
import { buildMonthWrapUpView } from "../src/client/month-wrap-up-model.js";
import { queryKeys } from "../src/client/query-keys.js";
import { summaryChangedEndpoint } from "../src/client/summary-changed-api.js";

const ANSWER = {
  wrapUp: {
    viewId: "person-tim",
    scope: "direct_plus_shared",
    month: "2026-10",
    changed: {
      baseMonth: "2026-09",
      rowCount: 4,
      rows: [
        { category: "Groceries", direction: "up", diffMinor: 33_210, amountMinor: 73_210, ids: ["e5", "e10"] },
        { category: "Food & Drinks", direction: "down", diffMinor: -8_000, amountMinor: 12_000, ids: ["e6"] }
      ]
    },
    other: { ids: ["e8", "e9"], amountMinor: 6_000 },
    estimates: { ids: ["e10"], amountMinor: 3_210 },
    statements: { accountCount: 3, missing: [{ id: "a:2026-10:statement", name: "DBS Account" }, { id: "b:2026-10:statement", name: "UOB One Card" }] },
    splits: {
      balances: [{ id: "split-group-home", name: "Home", currency: "SGD", balanceMinor: -2_500, owes: "You owe Joyce", direction: "you_owe" }],
      usuallySharedIds: ["us-1", "us-2", "us-3"]
    }
  }
};
const PLAN = [{ key: "budget_buckets", rows: [{ id: "groceries", label: "Groceries", categoryName: "Groceries", plannedMinor: 60_000, actualMinor: 73_210 }] }];

test("the request names the view, scope and month; What changed asks for a month that has ended only when given one", async () => {
  assert.equal(monthWrapUpEndpoint("household", "direct", "2026-10"), "/api/month-wrap-up?view=household&month=2026-10");
  assert.equal(monthWrapUpEndpoint("person-tim", "shared", "2026-10"), "/api/month-wrap-up?view=person-tim&month=2026-10&scope=shared");
  assert.equal(summaryChangedEndpoint("household", "", ""), "/api/summary-changed?view=household");
  assert.equal(summaryChangedEndpoint("household", "", "2026-10"), "/api/summary-changed?view=household&month=2026-10");
  assert.deepEqual(queryKeys.summaryChanged("household", "direct"), ["summary-changed", "household", "direct_plus_shared"], "the month in progress keeps its key");
  assert.deepEqual(queryKeys.summaryChanged("household", "direct", "2026-10"), ["summary-changed", "household", "direct_plus_shared", "2026-10"]);
  assert.deepEqual(queryKeys.monthWrapUp("person-tim", "shared", "2026-10"), ["month-wrap-up", "person-tim", "shared", "2026-10"]);
  const failed = requestMonthWrapUp("household", "", "2026-10", { fetchImpl: async () => new Response("no", { status: 500 }) });
  await assert.rejects(failed, /failed \(500\)/);
  const unreadable = requestMonthWrapUp("household", "", "2026-10", { fetchImpl: async () => Response.json({ hello: 1 }) });
  await assert.rejects(unreadable, /unreadable/);
});

test("the reader keeps a whole answer, says nothing for a month with nothing to wrap up, and refuses a broken one", () => {
  assert.deepEqual(readMonthWrapUp({ wrapUp: null }), { wrapUp: null });
  const read = readMonthWrapUp(ANSWER);
  assert.equal(read.wrapUp.month, "2026-10");
  assert.deepEqual(read.wrapUp.splits.balances.map((balance) => balance.owes), ["You owe Joyce"]);
  assert.equal(readMonthWrapUp({ wrapUp: { ...ANSWER.wrapUp, other: { ids: "e8" } } }), null);
  assert.equal(readMonthWrapUp({}), null);
  // A settled balance (zero) is not a balance to settle.
  const settled = readMonthWrapUp({ wrapUp: { ...ANSWER.wrapUp, splits: { balances: [{ ...ANSWER.wrapUp.splits.balances[0], balanceMinor: 0 }], usuallySharedIds: [] } } });
  assert.deepEqual(settled.wrapUp.splits.balances, []);
});

test("each row's words, figures and one action", () => {
  const card = buildMonthWrapUpView({ answer: readMonthWrapUp(ANSWER), planSections: PLAN, monthNote: "", hidden: false });
  assert.equal(card.wrappedUp, false);
  assert.deepEqual([card.done, card.total], [0, 6]);
  assert.deepEqual(card.changed.rows.map((row) => [row.name, row.move, row.diffMinor, row.figure.fig, row.figure.amountMinor, row.figure.ids]), [
    ["Groceries", "up", 33_210, "spent", 73_210, ["e5", "e10"]],
    ["Food & Drinks", "down", 8_000, "spent", 12_000, ["e6"]]
  ]);
  assert.equal(card.changed.against, "Against September");
  assert.equal(card.changed.seeAll, "See all");
  const byId = Object.fromEntries(card.rows.map((row) => [row.id, row]));
  assert.deepEqual(card.rows.map((row) => [row.id, row.label, row.value, row.action?.label ?? null]), [
    ["other", "Left in Other (no category)", "2 entries", "Open in Entries"],
    ["estimates", "Foreign currency estimates", "1 not confirmed by the bank yet", "Open in Entries"],
    ["statements", "Statements imported", "2 statements not brought in yet: DBS Account and UOB One Card", "Open Imports"],
    ["splits", "Splits to settle", "", "Open Splits"],
    ["plan", "Over plan", "", "Open plan"],
    ["note", "Monthly note", "Not written yet", "Write the note"]
  ]);
  assert.deepEqual(byId.other.figure, { fig: "spent", amountMinor: 6_000, ids: ["e8", "e9"], name: "Left in Other (no category)" });
  assert.deepEqual(byId.estimates.action.ids, ["e10"]);
  assert.deepEqual(byId.splits.lines.map((line) => [line.text, line.figure?.fig ?? null, line.figure?.amountMinor ?? null, line.figure?.tone ?? null]), [
    ["You owe Joyce", "splits", 2_500, "short"],
    ["3 entries you usually share, not on Splits yet", null, null, null]
  ]);
  assert.deepEqual(byId.plan.lines.map((line) => [line.text, line.figure.fig, line.figure.amountMinor, line.figure.tone, line.after]), [["Groceries", "plan", 13_210, "short", "over"]]);
});

test("with money hidden: counts only, names A to Z, no tone and never who owes whom", () => {
  const card = buildMonthWrapUpView({ answer: readMonthWrapUp(ANSWER), planSections: PLAN, monthNote: "", hidden: true });
  const json = JSON.stringify(card);
  assert.ok(!/owe/i.test(json), "no word of who owes whom");
  assert.ok(!/"tone"/.test(json), "no tone");
  assert.ok(!/amountMinor|diffMinor":\d/.test(json), "no amount");
  assert.deepEqual(card.changed.rows.map((row) => row.name), ["Food & Drinks", "Groceries"]);
  const byId = Object.fromEntries(card.rows.map((row) => [row.id, row]));
  assert.equal(byId.splits.value, "1 to settle");
  assert.equal(byId.plan.value, "1 category");
  assert.equal(byId.other.figure, null);
  assert.deepEqual(byId.estimates.action.ids, ["e10"], "the action still opens the estimates");
});

test("a month with everything done is one line; no answer is no card", () => {
  const done = {
    wrapUp: {
      ...ANSWER.wrapUp,
      other: { ids: [], amountMinor: 0 },
      estimates: { ids: [], amountMinor: 0 },
      statements: { accountCount: 3, missing: [] },
      splits: { balances: [], usuallySharedIds: [] }
    }
  };
  const card = buildMonthWrapUpView({ answer: readMonthWrapUp(done), planSections: [{ key: "budget_buckets", rows: [{ id: "g", label: "Groceries", plannedMinor: 80_000, actualMinor: 73_210 }] }], monthNote: "Quiet month", hidden: false });
  assert.deepEqual({ wrappedUp: card.wrappedUp, line: card.line, rows: card.rows, changed: card.changed }, { wrappedUp: true, line: "October is wrapped up", rows: [], changed: null });
  assert.equal(buildMonthWrapUpView({ answer: { wrapUp: null }, planSections: [], monthNote: "", hidden: false }), null);
  assert.equal(buildMonthWrapUpView({ answer: null, planSections: [], monthNote: "", hidden: false }), null);
  // One check left (the note): the card stays a checklist, the rest are ticks.
  const almost = buildMonthWrapUpView({ answer: readMonthWrapUp(done), planSections: [], monthNote: "", hidden: false });
  assert.deepEqual(almost.rows.map((row) => [row.id, row.done, row.value]), [
    ["other", true, "None"],
    ["estimates", true, "None"],
    ["statements", true, "All 3"],
    ["splits", true, "Nothing to settle"],
    ["note", false, "Not written yet"]
  ]);
});
