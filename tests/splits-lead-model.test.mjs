import assert from "node:assert/strict";
import test from "node:test";

import { buildSplitsLead } from "../src/client/splits-lead-model.js";

const people = [
  { id: "person-ethan", name: "Ethan" },
  { id: "person-serene", name: "Serene" }
];
const japan = { id: "g-japan", name: "Japan trip", currency: "JPY", entryCount: 10, balanceMinor: 2673000 };
const base = { group: japan, viewId: "person-ethan", people, areTotalsVisible: true, spendMinor: 36054000 };

test("owed to you: the other person owes you, in mint, on the group's own currency", () => {
  const lead = buildSplitsLead(base);
  assert.equal(lead.title, "Japan trip");
  assert.equal(lead.subtitle, "JPY · 10 entries");
  assert.equal(lead.amountMinor, 2673000);
  assert.equal(lead.tone, "in");
  assert.equal(lead.caption, "Serene owes you");
  assert.equal(lead.counterpartName, "Serene");
  assert.equal(lead.spendMinor, 36054000);
});

test("you owe: the amount is positive, the tone is rose and the words name who you owe", () => {
  const lead = buildSplitsLead({ ...base, group: { ...japan, balanceMinor: -10858, currency: "SGD" } });
  assert.equal(lead.amountMinor, 10858);
  assert.equal(lead.tone, "short");
  assert.equal(lead.caption, "You owe Serene");
  assert.equal(lead.subtitle, "SGD · 10 entries");
});

test("the second person sees the same group from their side", () => {
  const lead = buildSplitsLead({ ...base, viewId: "person-serene" });
  assert.equal(lead.caption, "Ethan owes you");
  assert.equal(lead.counterpartName, "Ethan");
  assert.equal(lead.tone, "in");
});

test("a settled group says Settled up with a neutral figure", () => {
  const lead = buildSplitsLead({ ...base, group: { ...japan, balanceMinor: 0, entryCount: 1 } });
  assert.equal(lead.amountMinor, 0);
  assert.equal(lead.tone, "neutral");
  assert.equal(lead.caption, "Settled up");
  assert.equal(lead.subtitle, "JPY · 1 entry");
});

test("hidden money names the person and nothing about which side of zero it is", () => {
  const owed = buildSplitsLead({ ...base, areTotalsVisible: false });
  const owe = buildSplitsLead({ ...base, areTotalsVisible: false, group: { ...japan, balanceMinor: -5 } });
  const settled = buildSplitsLead({ ...base, areTotalsVisible: false, group: { ...japan, balanceMinor: 0 } });
  for (const lead of [owed, owe, settled]) {
    assert.equal(lead.caption, "Balance with Serene");
    assert.equal(lead.tone, "neutral");
  }
  assert.doesNotMatch(JSON.stringify(owed), /owes|Settled/);
});

test("the household view has no balance to show: the spend leads", () => {
  const lead = buildSplitsLead({ ...base, viewId: "household" });
  assert.equal(lead.counterpartName, null);
  assert.equal(lead.amountMinor, null);
  assert.equal(lead.caption, "");
  assert.equal(lead.spendMinor, 36054000);
});

test("with no second person the words fall back to You are owed and You owe", () => {
  const owed = buildSplitsLead({ ...base, people: [people[0]] });
  assert.equal(owed.counterpartName, null);
  assert.equal(owed.caption, "You are owed");
  assert.equal(owed.amountMinor, 2673000);
  const owe = buildSplitsLead({ ...base, people: [people[0]], group: { ...japan, balanceMinor: -100 } });
  assert.equal(owe.caption, "You owe");
});
