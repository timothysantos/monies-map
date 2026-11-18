// Settle group's payment goes from the one who owes to the one owed
// (src/client/splits-drafts.js). A payment settles a group only at zero
// (Ask audit B9), so the wrong way round would double what is owed and
// leave the group open.
import assert from "node:assert/strict";
import test from "node:test";

import { buildNewSettlementDraft } from "../src/client/splits-drafts.js";

const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];
const group = { id: "split-group-home", currency: "SGD" };
const direction = (draft) => [draft.fromPersonName, draft.toPersonName, draft.amountMinor];

test("Settle group: the one who owes pays the one owed, from either person's view and the household's", () => {
  // Tim's view: positive is owed to Tim.
  assert.deepEqual(direction(buildNewSettlementDraft({ activeGroup: group, groupBalanceMinor: 4_800, people, viewId: "person-tim" })), ["Joyce", "Tim", 4_800]);
  assert.deepEqual(direction(buildNewSettlementDraft({ activeGroup: group, groupBalanceMinor: -11_703, people, viewId: "person-tim" })), ["Tim", "Joyce", 11_703]);
  // Joyce's view: positive is owed to Joyce.
  assert.deepEqual(direction(buildNewSettlementDraft({ activeGroup: group, groupBalanceMinor: 11_703, people, viewId: "person-joyce" })), ["Tim", "Joyce", 11_703]);
  assert.deepEqual(direction(buildNewSettlementDraft({ activeGroup: group, groupBalanceMinor: -4_800, people, viewId: "person-joyce" })), ["Joyce", "Tim", 4_800]);
  // The household reads the first person's side.
  assert.deepEqual(direction(buildNewSettlementDraft({ activeGroup: group, groupBalanceMinor: -200, people, viewId: "household" })), ["Tim", "Joyce", 200]);
});
