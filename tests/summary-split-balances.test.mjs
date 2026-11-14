// Summary's Splits tile reads one balance per split group from the Summary
// page (pages/summary-split-balances.ts). It must be the figure the Splits
// page shows on the same group's tile, in every view, including a group with
// a settled section, a closed batch, and a settle-up on top of the expenses.
import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { SETTLED_HISTORY, seedSettledSplitHistory } from "./support/settled-split-history.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const SUMMARY = "/api/summary-page?month=2026-08&scope=direct_plus_shared&summary_start=2026-03&summary_end=2026-08";

async function readBoth(app, view) {
  const summary = await app.api(`${SUMMARY}&view=${view}`);
  assert.equal(summary.status, 200, JSON.stringify(summary.payload).slice(0, 200));
  const splits = await app.api(`/api/splits-page?view=${view}&month=2026-08`);
  assert.equal(splits.status, 200);
  return { balances: summary.payload.summaryPage.splitBalances ?? [], groups: splits.payload.splitsPage.groups };
}

test("each group's balance equals the Splits page's, in the household and both person views", async (t) => {
  const app = await openSeededDatabase(t, template);
  const { db } = app;
  await seedSettledSplitHistory(db);
  // A closed batch (its expense is not open) and an extra open settle-up.
  await db.batch([
    db.prepare("INSERT INTO split_batches (id, household_id, split_group_id, batch_name, opened_on, closed_on) VALUES ('batch-closed', 'household-1', ?, 'Closed trip', '2025-03-01', '2025-04-01')").bind(SETTLED_HISTORY.smallGroupId),
    db.prepare("UPDATE split_expenses SET split_batch_id = 'batch-closed' WHERE id = 'prod-shape-exp-0350'"),
    db.prepare("INSERT INTO split_settlements (id, household_id, split_group_id, from_person_id, to_person_id, settlement_date, amount_minor, currency, payment_method) VALUES ('extra-settle', 'household-1', ?, 'person-tim', 'person-joyce', '2025-09-20', 4321, 'SGD', 'cash')").bind(SETTLED_HISTORY.bigGroupId)
  ]);

  let compared = 0;
  for (const view of ["household", "person-tim", "person-joyce"]) {
    const { balances, groups } = await readBoth(app, view);
    assert.ok(balances.length > 0, `${view} has split balances`);
    for (const balance of balances) {
      const group = groups.find((candidate) => candidate.id === balance.id);
      assert.ok(group, `${view}: the Splits page has the group ${balance.id}`);
      assert.equal(balance.balanceMinor, group.balanceMinor, `${view} ${group.name}`);
      assert.equal(balance.name, group.name);
      const words = balance.balanceMinor === 0 ? "Settled up" : `${balance.owes} ${formatCurrencyMinor(Math.abs(balance.balanceMinor), balance.currency)}`;
      assert.equal(words, group.summaryText, `${view} ${group.name}: the wording is the page's`);
      compared += 1;
    }
  }
  assert.ok(compared >= 6, "both seeded groups were compared in every view");
});

test("a group that was never used is left out, and with no split at all the field is absent", async (t) => {
  const app = await openSeededDatabase(t, template);
  const { db } = app;
  await db.prepare("DELETE FROM split_settlements").run();
  await db.prepare("DELETE FROM split_expense_shares").run();
  await db.prepare("DELETE FROM split_expenses").run();
  await db.prepare("INSERT INTO split_groups (id, household_id, group_name, currency) VALUES ('split-group-unused', 'household-1', 'Never used', 'SGD')").run();
  const { payload } = await app.api(`${SUMMARY}&view=household`);
  assert.equal("splitBalances" in payload.summaryPage, false);
});
