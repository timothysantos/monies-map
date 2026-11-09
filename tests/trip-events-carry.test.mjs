// An entry's trip or event survives the corrections that replace it
// (docs/known-coupling-targets.md, "Trip or event links through
// corrections"): an Apple Pay estimate paired with its bank row keeps its
// id and so its trip; a wrong-card Apple Pay copy removed in favour of the
// bank's row (in the ledger, or in the same file) hands its trip to that
// row; a statement's second copy removed by Statement compare hands its
// trip to the copy that stays. Real Worker, local D1, demo household.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import {
  APPLE_PAY_ENTRIES,
  LADYS_FILE,
  ONE_CARD_FILE,
  commitFile,
  createCards,
  previewFile,
  saveApplePayEntries
} from "./support/wrong-card-scenario.mjs";
import {
  STATEMENT_MONTH,
  commitBody as statementCommitBody,
  compareLadysCard,
  previewStatement,
  setUpWrongCardScenario
} from "./support/uob-wrong-card-scenario.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const ONE_LABEL = "CC_TXN_History_14Oct2026-onecard";
const LADY_LABEL = "CC_TXN_History_13Oct2026-ladys";

async function putOnTrip(api, entryIds, name = "Bali trip") {
  const saved = await api("/api/trip-events/save", { name });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const set = await api("/api/trip-events/entries/set", { entryIds, tripEventId: saved.payload.tripEvent.id });
  assert.equal(set.status, 200, JSON.stringify(set.payload));
  return saved.payload.tripEvent.id;
}

const tripEntries = (db, tripEventId) => rows(db, `
  SELECT t.description, t.amount_minor, t.import_id IS NOT NULL AS imported
  FROM trip_event_entries l JOIN transactions t ON t.id = l.transaction_id
  WHERE l.trip_event_id = ? ORDER BY t.amount_minor`, tripEventId);

test("an Apple Pay estimate paired with its bank row keeps its trip (the row is updated in place)", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { api, db } = workspace;
  await createCards(api);
  const entryIds = await saveApplePayEntries(workspace, [{ description: "Sabai Sabai - Valley P", amount: "20.49", date: "2026-10-08" }]);
  const tripEventId = await putOnTrip(api, entryIds);
  await commitFile(api, await previewFile(api, LADYS_FILE, LADY_LABEL), LADY_LABEL);
  const [entry] = await rows(db, "SELECT import_id FROM transactions WHERE id = ?", entryIds[0]);
  assert.ok(entry.import_id, "the bank row was paired with the estimate");
  assert.deepEqual(await tripEntries(db, tripEventId), [{ description: (await rows(db, "SELECT description FROM transactions WHERE id = ?", entryIds[0]))[0].description, amount_minor: 2_049, imported: 1 }]);
});

test("a wrong-card Apple Pay copy removed for a bank row already in the ledger hands its trip to that row", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { api, db } = workspace;
  await createCards(api);
  const entryIds = await saveApplePayEntries(workspace);
  const tripEventId = await putOnTrip(api, entryIds.slice(0, 2));
  await commitFile(api, await previewFile(api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  const preview = await previewFile(api, LADYS_FILE, LADY_LABEL);
  assert.equal(preview.wrongCardDuplicates.length, 3);
  assert.ok(preview.wrongCardDuplicates.every((card) => card.twin.kind === "ledger"));
  await commitFile(api, preview, LADY_LABEL, { remove: preview.wrongCardDuplicates });

  assert.deepEqual(await rows(db, `SELECT COUNT(*) AS n FROM transactions WHERE id IN (${entryIds.map(() => "?").join(", ")})`, ...entryIds), [{ n: 0 }]);
  const kept = await tripEntries(db, tripEventId);
  // The two Apple Pay entries on the trip were $1.80 and $9.70; their One
  // Card bank rows now hold the trip.
  assert.deepEqual(kept.map((row) => [row.amount_minor, row.imported]), [[180, 1], [970, 1]]);
  assert.ok(kept.every((row) => /STAR VISTA|CS FRESH/i.test(row.description)), JSON.stringify(kept));
  assert.equal(APPLE_PAY_ENTRIES.length, 3);
});

test("a wrong-card copy removed for a row in the same file hands its trip to the new row", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { api, db } = workspace;
  await createCards(api);
  const entryIds = await saveApplePayEntries(workspace);
  await commitFile(api, await previewFile(api, LADYS_FILE, LADY_LABEL), LADY_LABEL);
  const tripEventId = await putOnTrip(api, [entryIds[2]]);
  const second = await previewFile(api, ONE_CARD_FILE, ONE_LABEL);
  assert.ok(second.wrongCardDuplicates.every((card) => card.twin.kind === "this_file"));
  const importId = await commitFile(api, second, ONE_LABEL, { remove: second.wrongCardDuplicates });

  const kept = await rows(db, `
    SELECT t.amount_minor, t.import_id FROM trip_event_entries l JOIN transactions t ON t.id = l.transaction_id
    WHERE l.trip_event_id = ?`, tripEventId);
  assert.deepEqual(kept, [{ amount_minor: 784, import_id: importId }]);
});

test("a statement's second copy removed by Statement compare hands its trip to the copy that stays", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const scenario = await setUpWrongCardScenario(api);
  const commit = await api("/api/imports/commit", statementCommitBody(scenario.statement, await previewStatement(api, scenario.statement)));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const corrections = (await compareLadysCard(api, scenario.statement, scenario.ladysCardId)).statementDiagnosis.findings.map((finding) => finding.fix);
  assert.deepEqual(corrections.map((fix) => fix.kind), ["remove_duplicate_entry", "remove_duplicate_entry"]);
  const [first, second] = corrections;
  const tripEventId = await putOnTrip(api, [first.entryId]);
  // The second's covering copy is already on another trip: it keeps that one.
  const otherTripId = await putOnTrip(api, [second.coveredByEntryId], "Mum's 70th");
  await putOnTrip(api, [second.entryId], "Seoul trip");

  const applied = await api("/api/accounts/checkpoints/statement-corrections/apply", { accountId: scenario.ladysCardId, checkpointMonth: STATEMENT_MONTH, corrections });
  assert.equal(applied.status, 200, JSON.stringify(applied.payload));
  const links = await rows(db, "SELECT transaction_id, trip_event_id FROM trip_event_entries ORDER BY trip_event_id, transaction_id");
  assert.deepEqual(
    links.map((row) => [row.transaction_id, row.trip_event_id]).sort(),
    [[first.coveredByEntryId, tripEventId], [second.coveredByEntryId, otherTripId]].sort()
  );
});
