import assert from "node:assert/strict";
import test from "node:test";

import { buildPlanSheetLead } from "../src/client/month-plan-sheet-model.js";

test("a budget bucket under plan says what is left, in mint", () => {
  assert.deepEqual(buildPlanSheetLead({ kind: "plan", mode: "edit", actualMinor: 29_754, plannedMinor: 32_000 }), {
    showProgress: true,
    progress: { valueMinor: 29_754, planMinor: 32_000, overIsShort: true },
    actualWord: "spent",
    end: { amountMinor: 2_246, word: "left", tone: "in" }
  });
  // Exactly on plan is a met plan.
  assert.deepEqual(buildPlanSheetLead({ kind: "plan", mode: "edit", actualMinor: 500, plannedMinor: 500 }).end, { amountMinor: 0, word: "left", tone: "in" });
});

test("a planned item over plan says how much over, in rose", () => {
  assert.deepEqual(buildPlanSheetLead({ kind: "plan", mode: "edit", actualMinor: 1_850_00, plannedMinor: 1_800_00 }).end, { amountMinor: 50_00, word: "over", tone: "short" });
});

test("income says what is still to come, and nothing once it is in; more than planned is not rose", () => {
  const short = buildPlanSheetLead({ kind: "income", mode: "edit", actualMinor: 300_000, plannedMinor: 830_000 });
  assert.equal(short.actualWord, "received");
  assert.deepEqual(short.end, { amountMinor: 530_000, word: "toCome", tone: "short" });
  assert.equal(short.progress.overIsShort, false);
  assert.equal(buildPlanSheetLead({ kind: "income", mode: "edit", actualMinor: 830_000, plannedMinor: 830_000 }).end, null);
  assert.equal(buildPlanSheetLead({ kind: "income", mode: "edit", actualMinor: 900_000, plannedMinor: 830_000 }).end, null);
});

test("a new row has no actual yet, so no bar", () => {
  assert.equal(buildPlanSheetLead({ kind: "plan", mode: "create", plannedMinor: 4_200 }).showProgress, false);
  assert.equal(buildPlanSheetLead({ kind: "income", mode: "create" }).showProgress, false);
});
