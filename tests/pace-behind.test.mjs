// "Statements behind" for If this keeps up (src/domain/pace.ts,
// paceAccountsBehind; DOMAIN.md "Pace"): an account behind only matters if it
// matters this month, by its own cadence, and several smaller ones count
// together. And the quiet words (pace-quiet.ts) the note under Summary's
// chart and Ask both say.
import assert from "node:assert/strict";
import test from "node:test";

import { paceAccountsBehind, PACE_BEHIND_MAX_DAYS } from "../src/domain/pace.ts";
import { paceBehindClause, paceQuietAnswer, paceQuietNote } from "../src/domain/pace-quiet.ts";
import { findAppJargon, findPaceProblems, findToneProblems } from "../src/domain/money-signals/tone.ts";

const TODAY = "2026-11-10";

// An account that spends every `every` days over the last 3 months, up to
// `lastEntryDate`, with `spendMinor` in total.
function account(name, { lastEntryDate, spendMinor, every = 3, thisMonth = 0 }) {
  const chargeDays = [];
  const end = new Date(`${lastEntryDate}T00:00:00Z`).getTime();
  for (let at = new Date("2026-08-02T00:00:00Z").getTime(); at <= end; at += every * 86_400_000) {
    chargeDays.push(new Date(at).toISOString().slice(0, 10));
  }
  return { accountId: name.toLowerCase().replace(/\W+/g, "-"), name, lastEntryDate, spendMinor, chargeDays, chargesThisMonth: thisMonth };
}
const names = (list) => paceAccountsBehind(list, TODAY).map((item) => item.name);

test("a main account behind: named with its last entry date", () => {
  const behind = paceAccountsBehind([
    account("Citi Rewards", { lastEntryDate: "2026-10-15", spendMinor: 600_000 }),
    account("UOB One Card", { lastEntryDate: "2026-11-10", spendMinor: 400_000, thisMonth: 20 })
  ], TODAY);
  assert.deepEqual(behind, [{ accountId: "citi-rewards", name: "Citi Rewards", lastDate: "2026-10-15" }]);
});

test("a minor account behind is ignored: under a quarter, not the biggest, nothing this month", () => {
  assert.deepEqual(names([
    account("UOB One Card", { lastEntryDate: "2026-11-10", spendMinor: 900_000, thisMonth: 25 }),
    account("Old Card", { lastEntryDate: "2026-08-20", spendMinor: 60_000 })
  ]), []);
});

test("a minor account behind that has charges this month still counts", () => {
  // Under a quarter of the spending, but it is being used right now and its
  // statement stops 11 days ago.
  assert.deepEqual(names([
    account("UOB One Card", { lastEntryDate: "2026-11-10", spendMinor: 900_000, thisMonth: 25 }),
    account("Side Card", { lastEntryDate: "2026-10-29", spendMinor: 60_000, thisMonth: 3 })
  ]), ["Side Card"]);
});

test("a fresh account is never behind, and 10 days exactly is not yet", () => {
  assert.deepEqual(names([account("Citi Rewards", { lastEntryDate: "2026-11-09", spendMinor: 600_000, thisMonth: 4 })]), []);
  assert.deepEqual(names([account("Citi Rewards", { lastEntryDate: "2026-10-31", spendMinor: 600_000, thisMonth: 4 })]), []);
  assert.deepEqual(names([account("Citi Rewards", { lastEntryDate: "2026-10-30", spendMinor: 600_000, thisMonth: 4 })]), ["Citi Rewards"]);
});

test("the busiest account counts even when no account reaches a quarter", () => {
  assert.deepEqual(names([
    account("A", { lastEntryDate: "2026-10-20", spendMinor: 240_000 }),
    account("B", { lastEntryDate: "2026-11-10", spendMinor: 230_000, thisMonth: 9 }),
    account("C", { lastEntryDate: "2026-11-10", spendMinor: 230_000, thisMonth: 9 }),
    account("D", { lastEntryDate: "2026-11-10", spendMinor: 150_000, thisMonth: 9 }),
    account("E", { lastEntryDate: "2026-11-10", spendMinor: 150_000, thisMonth: 9 })
  ]), ["A"]);
});

test("each account's own cadence: a card used every 6 days is not behind at 12 days, one used every 2 days is", () => {
  const slow = account("Slow Card", { lastEntryDate: "2026-10-29", spendMinor: 600_000, every: 6 });
  const fast = account("Fast Card", { lastEntryDate: "2026-10-29", spendMinor: 600_000, every: 2 });
  assert.deepEqual(names([slow]), []);
  assert.deepEqual(names([fast]), ["Fast Card"]);
  // The wait is capped: even a card used once a month is behind past 21 days.
  const monthly = account("Monthly Card", { lastEntryDate: "2026-10-15", spendMinor: 600_000, every: 30 });
  assert.equal(PACE_BEHIND_MAX_DAYS, 21);
  assert.deepEqual(names([monthly]), ["Monthly Card"]);
});

test("several smaller accounts behind count together, but the tiny ones are still left out", () => {
  const list = [
    account("Card One", { lastEntryDate: "2026-10-14", spendMinor: 160_000 }),
    account("Card Two", { lastEntryDate: "2026-10-11", spendMinor: 150_000 }),
    account("Card Three", { lastEntryDate: "2026-10-12", spendMinor: 140_000 }),
    account("Tiny Card", { lastEntryDate: "2026-10-02", spendMinor: 20_000 }),
    account("Fresh Card", { lastEntryDate: "2026-11-10", spendMinor: 530_000, thisMonth: 30 })
  ];
  assert.deepEqual(names(list), ["Card One", "Card Two", "Card Three"]);
  // The same accounts with only one behind and under a quarter: ignored.
  assert.deepEqual(names([list[0], { ...list[1], lastEntryDate: "2026-11-10", chargesThisMonth: 5 }, { ...list[2], lastEntryDate: "2026-11-10", chargesThisMonth: 5 }, list[4], { ...list[3], spendMinor: 700_000, lastEntryDate: "2026-11-10", chargesThisMonth: 5 }]), []);
});

test("an account with no charges in the window is not asked about", () => {
  assert.deepEqual(names([{ accountId: "idle", name: "Idle", lastEntryDate: "2026-06-01", spendMinor: 0, chargeDays: [], chargesThisMonth: 0 }]), []);
  assert.deepEqual(names([]), []);
});

// ---- The words ------------------------------------------------------------

const behind = [
  { accountId: "a", name: "Citi Rewards", lastDate: "2026-10-15" },
  { accountId: "b", name: "UOB One (Joyce)", lastDate: "2026-10-14" },
  { accountId: "c", name: "Citi Miles", lastDate: "2026-10-15" },
  { accountId: "d", name: "OCBC 360", lastDate: "2026-10-05" }
];

test("Summary's note: the reason in plain words, with the part that opens Imports", () => {
  const one = paceQuietNote("imports", { month: "2026-11", behind: behind.slice(0, 1) });
  assert.deepEqual(one, { before: "No pace yet: Citi Rewards has nothing after 15 Oct. ", action: "Import its statement", after: " to see it." });
  const two = paceQuietNote("imports", { month: "2026-11", behind: behind.slice(0, 2) });
  assert.equal(`${two.before}${two.action}${two.after}`, "No pace yet: Citi Rewards has nothing after 15 Oct and UOB One (Joyce) has nothing after 14 Oct. Import their statements to see it.");
  const many = paceQuietNote("imports", { month: "2026-11", behind });
  assert.equal(many.before, "No pace yet: Citi Rewards has nothing after 15 Oct and UOB One (Joyce) has nothing after 14 Oct, and 2 more accounts are behind too. ");
  assert.equal(paceQuietNote("early", { month: "2026-11" }).before, "No pace yet: it's too early in November.");
  assert.equal(paceQuietNote("history", { month: "2026-11" }).before, "No pace yet: it needs 3 complete months of entries.");
  assert.equal(paceQuietNote("early", { month: "2026-11" }).action, "");
  // A month that has ended is never shown a note.
  assert.equal(paceQuietNote("past", { month: "2026-10" }), null);
});

test("Ask says the same reasons, and the shared words pass every lint", () => {
  assert.equal(paceBehindClause(behind.slice(0, 1)), "Citi Rewards has nothing after 15 Oct");
  assert.equal(paceQuietAnswer("imports", { month: "2026-11", behind: behind.slice(0, 1) }), "Citi Rewards has nothing after 15 Oct, so there's no pace until its statement is imported.");
  assert.equal(paceQuietAnswer("early", { month: "2026-11" }), "It's too early in November to say where it ends. Ask again after the 5th.");
  const lines = [];
  for (const reason of ["early", "history", "imports"]) {
    for (const list of [[], behind.slice(0, 1), behind.slice(0, 2), behind]) {
      const note = paceQuietNote(reason, { month: "2026-11", behind: list });
      lines.push(`${note.before}${note.action}${note.after}`, paceQuietAnswer(reason, { month: "2026-11", behind: list }));
    }
  }
  for (const line of lines) {
    assert.deepEqual([...findPaceProblems(line), ...findToneProblems(line), ...findAppJargon(line)], [], line);
    assert.doesNotMatch(line, /[$!]|\d{2,},\d{3}/, "no amounts, no exclamation marks");
  }
});
