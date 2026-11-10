// Usually shared (DOMAIN.md "Usually Shared"): a sweep over past expenses
// with the SAME rule that suggests the usual split for one entry. Every
// candidate must get exactly the suggestion the single-entry rule gives it,
// and anything that rule refuses is left out.
import assert from "node:assert/strict";
import test from "node:test";

import { suggestSplitForEntry } from "../src/domain/split-suggestion.ts";
import { suggestUsuallyShared, USUALLY_SHARED_POLICY } from "../src/domain/usually-shared.ts";

const TIM = { id: "person-tim", name: "Tim" };
const JOYCE = { id: "person-joyce", name: "Joyce" };
const PEOPLE = [TIM, JOYCE];
const GROUPS = [
  { id: "split-group-none", name: "Non-group expenses", currency: "SGD" },
  { id: "split-group-home", name: "Home", currency: "SGD" }
];

let n = 0;
const history = (overrides = {}) => {
  n += 1;
  return {
    entryId: `old-${n}`,
    date: "2026-06-01",
    entryType: "expense",
    description: "COLD STORAGE",
    categoryName: "Groceries",
    ownerPersonId: TIM.id,
    split: { groupId: "split-group-home", payerPersonId: TIM.id, shares: [{ personId: TIM.id, basisPoints: 5000 }, { personId: JOYCE.id, basisPoints: 5000 }] },
    ...overrides
  };
};
const candidate = (id, overrides = {}) => ({
  entryId: id,
  date: "2026-10-20",
  entryType: "expense",
  description: "Cold Storage",
  categoryName: "Groceries",
  ownerPersonId: TIM.id,
  currency: "SGD",
  amountMinor: 1000,
  ...overrides
});
const run = (candidates, hist, extra = {}) => suggestUsuallyShared({ candidates, history: hist, groups: GROUPS, sharePeople: PEOPLE, ...extra });

test("the policy is the documented one", () => {
  assert.deepEqual({ ...USUALLY_SHARED_POLICY }, { candidateDays: 90, maxEntriesPerAdd: 200, maxCandidates: 500, maxHistory: 6000 });
});

test("unsplit entries at a shop usually shared are grouped with their group, share, other person and evidence", () => {
  const hist = [...Array.from({ length: 8 }, () => history()), history({ split: null })];
  const groups = run([candidate("a", { date: "2026-10-01", amountMinor: 1250 }), candidate("b", { date: "2026-10-12", amountMinor: 800 })], hist);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group.shopName, "Cold Storage");
  assert.equal(group.groupId, "split-group-home");
  assert.equal(group.groupName, "Home");
  assert.equal(group.basisPoints, 5000);
  assert.equal(group.ownerName, "Tim");
  assert.equal(group.otherPersonName, "Joyce");
  assert.equal(group.evidenceCount, 8);
  assert.equal(group.matchedBy, "description");
  assert.equal(group.currency, "SGD");
  assert.equal(group.totalMinor, 2050);
  assert.deepEqual(group.entries.map((entry) => entry.id), ["b", "a"]);
  assert.equal(group.entries[0].ownerName, "Tim");
});

test("every candidate gets exactly the suggestion the single-entry rule gives it (one policy)", () => {
  const hist = [history(), history(), history(), history({ split: null }), history({ description: "Ikea", split: null })];
  const sweep = run([candidate("a"), candidate("b", { description: "Ikea", categoryName: "Home" })], hist);
  const single = (target) => suggestSplitForEntry({ target: { ...target, onSplits: false, entryId: target.entryId }, history: hist, groups: GROUPS, sharePeople: PEOPLE });
  const cold = single({ entryId: "a", entryType: "expense", description: "Cold Storage", categoryName: "Groceries", ownerPersonId: TIM.id, currency: "SGD", date: "2026-10-20" });
  assert.ok(cold);
  assert.equal(sweep.length, 1);
  assert.equal(sweep[0].evidenceCount, cold.evidenceCount);
  assert.equal(sweep[0].matchedCount, cold.matchedCount);
  assert.equal(sweep[0].groupId, cold.groupId);
  assert.equal(sweep[0].basisPoints, cold.basisPoints);
});

test("negatives: a shop with too little sharing, one shared once, income, Joyce-less owners and old entries give nothing", () => {
  const rarely = [history({ description: "Bakery", split: null }), history({ description: "Bakery", split: null }), history({ description: "Bakery" })];
  assert.deepEqual(run([candidate("a", { description: "Bakery" })], rarely), []);
  assert.deepEqual(run([candidate("a", { description: "Brand New Place", categoryName: "Other" })], [history()]), []);
  const usual = [history(), history(), history()];
  assert.deepEqual(run([candidate("a", { entryType: "income" })], usual), []);
  assert.deepEqual(run([candidate("a", { ownerPersonId: null })], usual), []);
  assert.deepEqual(run([candidate("a", { ownerPersonId: "person-someone-else" })], usual), []);
  assert.deepEqual(run([candidate("a", { date: "2026-06-01" })], usual, { since: "2026-08-01" }), []);
  assert.equal(run([candidate("a", { date: "2026-09-01" })], usual, { since: "2026-08-01" }).length, 1);
});

test("two payers at one shop, two currencies and two usual shares make separate groups", () => {
  const timHist = [history(), history(), history()];
  const joyceHist = [1, 2, 3].map(() => history({
    ownerPersonId: JOYCE.id,
    split: { groupId: "split-group-home", payerPersonId: JOYCE.id, shares: [{ personId: JOYCE.id, basisPoints: 7000 }, { personId: TIM.id, basisPoints: 3000 }] }
  }));
  const groups = run([candidate("t"), candidate("j", { ownerPersonId: JOYCE.id })], [...timHist, ...joyceHist]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => [group.ownerName, group.basisPoints]).sort(), [["Joyce", 7000], ["Tim", 5000]]);
});

test("a group takes at most 200 entries and its total is of those entries; the biggest group is first", () => {
  const hist = [history(), history(), history()];
  const many = Array.from({ length: 205 }, (_, index) => candidate(`m${String(index).padStart(3, "0")}`, { date: `2026-10-${String(1 + (index % 25)).padStart(2, "0")}` }));
  const [group] = run(many, hist);
  assert.equal(group.entries.length, 200);
  assert.equal(group.totalMinor, 200 * 1000);

  const hist2 = [...hist, history({ description: "Ikea" }), history({ description: "Ikea" }), history({ description: "Ikea" })];
  const ordered = run([candidate("a"), candidate("i1", { description: "Ikea" }), candidate("i2", { description: "Ikea" })], hist2);
  assert.deepEqual(ordered.map((group) => group.shopName), ["Ikea", "Cold Storage"]);
});

test("a shop with no history of its own falls back to the stricter category rule and says so", () => {
  const hist = Array.from({ length: 5 }, (_, index) => history({ description: `Shop ${index}` }));
  const [group] = run([candidate("a", { description: "Shop New" })], hist);
  assert.equal(group.matchedBy, "category");
  assert.equal(group.evidenceCount, 5);
  assert.equal(group.matchedCount, 5);
});
