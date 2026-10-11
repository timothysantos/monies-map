// A Money insights link on Entries filters the list to the records it
// names. Once the list already shows exactly those, the link would change
// nothing, so the page hides it (the reported case: a list filtered to
// Other still offered "Show these purchases").
import assert from "node:assert/strict";
import test from "node:test";

import { applyCheckInAction, isCheckInActionApplied } from "../src/client/check-in-action.js";

const showFive = { id: "show-entries", label: "Show those five", entryIds: ["e1", "e2", "e3", "e4", "e5"] };
const openOther = { id: "open-category", label: "Show these purchases", categoryName: "Other" };

test("applying an action replaces the entry filters and keeps the rest of the URL", () => {
  const next = applyCheckInAction(new URLSearchParams("view=household&month=2026-08&entry_search=grab&entry_type=expense&entry_id=old"), openOther);
  assert.equal(next.toString(), "view=household&month=2026-08&entry_category=Other");
  const ids = applyCheckInAction(new URLSearchParams("view=household&entry_category=Dining"), showFive);
  assert.deepEqual(ids.getAll("entry_id"), ["e1", "e2", "e3", "e4", "e5"]);
  assert.equal(ids.get("entry_category"), null);
});

test("an action is applied when the list already shows exactly what it would show", () => {
  assert.equal(isCheckInActionApplied(new URLSearchParams("view=household&month=2026-08&entry_category=Other"), openOther), true);
  // Entry ids in any order still name the same records.
  assert.equal(isCheckInActionApplied(new URLSearchParams("entry_id=e5&entry_id=e1&entry_id=e4&entry_id=e3&entry_id=e2"), showFive), true);
  // Filters the action does not touch (a wallet, the month) do not matter.
  assert.equal(isCheckInActionApplied(new URLSearchParams("month=2026-08&wallet=acct-1&entry_category=Other"), openOther), true);
});

test("an action is not applied while pressing it would still change the list", () => {
  assert.equal(isCheckInActionApplied(new URLSearchParams("view=household&month=2026-08"), openOther), false);
  assert.equal(isCheckInActionApplied(new URLSearchParams("entry_category=Dining"), openOther), false);
  // A search on top of Other narrows the list, so the link would widen it.
  assert.equal(isCheckInActionApplied(new URLSearchParams("entry_category=Other&entry_search=grab"), openOther), false);
  assert.equal(isCheckInActionApplied(new URLSearchParams("entry_id=e1&entry_id=e2"), showFive), false);
  assert.equal(isCheckInActionApplied(new URLSearchParams("entry_id=e1&entry_id=e2&entry_id=e3&entry_id=e4&entry_id=e5&entry_type=expense"), showFive), false);
});
