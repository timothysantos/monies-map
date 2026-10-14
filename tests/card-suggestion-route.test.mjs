// POST /api/entries/card-suggestion (DOMAIN.md "Card Suggestion"), through the
// real Worker and a real local D1 (demo household, no AI binding: the
// suggestion never needed one). It is read-only and its reads are fixed: the
// saved entry (by id), the accounts, and one bounded history read on the
// household-and-date index.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { buildCardSuggestion, CARD_HISTORY_ROW_LIMIT } from "../src/domain/pages/card-suggestion.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function seedGrab(api, count, accountName = "Citi Rewards") {
  for (let index = 0; index < count; index += 1) {
    await createEntry(api, { accountName, description: "Grab Ride", amountMinor: 1200 + index, date: `2026-09-${String(10 + index).padStart(2, "0")}` });
  }
}

const draft = (overrides = {}) => ({ description: "GRAB RIDE", accountId: "", date: "2026-10-12", ...overrides });

async function uobOneId(db) {
  return (await rows(db, "SELECT id FROM accounts WHERE account_name = 'UOB One'"))[0].id;
}

test("a shop the household mostly pays on another card suggests that card, for a draft and for a saved entry", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await seedGrab(api, 4);
  const uob = await uobOneId(db);
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'Citi Rewards'");

  const asDraft = await api("/api/entries/card-suggestion", draft({ accountId: uob }));
  assert.deepEqual([asDraft.status, asDraft.payload], [200, {
    ok: true,
    suggestion: {
      accountId: citi.id,
      accountName: "Citi Rewards",
      currentAccountId: uob,
      currentAccountName: "UOB One",
      merchant: "GRAB RIDE",
      entryCount: 4,
      matchedCount: 4
    }
  }]);

  // The Apple Pay card: a saved provisional entry asks by its id.
  const savedId = await createEntry(api, { accountName: "UOB One", description: "Grab Ride", amountMinor: 900, date: "2026-10-12" });
  const asSaved = await api("/api/entries/card-suggestion", { entryId: savedId });
  assert.equal(asSaved.payload.suggestion.accountId, citi.id);
  assert.equal(asSaved.payload.suggestion.currentAccountId, uob);
  assert.equal(asSaved.payload.suggestion.matchedCount, 4, "the entry is not its own history");
});

test("it writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await seedGrab(api, 3);
  const before = await dumpDatabase(db);

  await api("/api/entries/card-suggestion", draft({ accountId: await uobOneId(db) }));
  await api("/api/entries/card-suggestion", { entryId: "txn-missing" });

  assertSameDatabase(await dumpDatabase(db), before);
});

test("too little history, history on the chosen card, a certified entry and an estimate suggest nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const uob = await uobOneId(db);
  await seedGrab(api, 2);
  assert.equal((await api("/api/entries/card-suggestion", draft({ accountId: uob }))).payload.suggestion, null, "2 entries");

  await seedGrab(api, 3, "UOB One");
  assert.equal((await api("/api/entries/card-suggestion", draft({ accountId: uob }))).payload.suggestion, null, "3 of 5 on the chosen card");

  // A statement-certified entry keeps its bank facts: no question.
  const [certifiedId] = (await rows(db, "SELECT id FROM transactions WHERE description = 'Grab Ride' AND account_id = ? LIMIT 1", uob)).map((row) => row.id);
  await db.prepare("UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id = ?").bind(certifiedId).run();
  assert.equal((await api("/api/entries/card-suggestion", { entryId: certifiedId })).payload.suggestion, null);

  // An estimate in another currency is not a purchase to move.
  await db.prepare("UPDATE transactions SET original_currency = 'IDR', original_amount_minor = 1000000 WHERE id = ?").bind(certifiedId).run();
  assert.equal((await api("/api/entries/card-suggestion", { entryId: certifiedId })).payload.suggestion, null);
});

test("bad requests are refused and an unknown entry is a 404", async (t) => {
  const { api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  for (const body of [{}, { entryId: "" }, { description: "", accountId: "a", date: "2026-10-12" }, { description: "x", accountId: "a", date: "tomorrow" }, { description: "x", date: "2026-10-12" }]) {
    assert.equal((await api("/api/entries/card-suggestion", body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await api("/api/entries/card-suggestion", { entryId: "txn-missing" })).status, 404);
  const get = await fetchWorker("/api/entries/card-suggestion");
  assert.deepEqual([get.status, get.headers.get("allow")], [405, "POST"]);
});

test("a request reads three times at most: the entry, the accounts and one indexed, bounded history read", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await seedGrab(api, 3);
  const savedId = await createEntry(api, { description: "Grab Ride", amountMinor: 900, date: "2026-10-12" });
  const seen = [];
  const counting = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => {
          seen.push(sql);
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  assert.ok(await buildCardSuggestion(counting, { entryId: savedId }));
  assert.equal(seen.length, 3, seen.join("\n---\n"));
  const history = seen.find((sql) => sql.includes("instr(lower(description)"));
  assert.match(history, /LIMIT \?/);
  assert.match(history, /transaction_date BETWEEN/);

  seen.length = 0;
  await buildCardSuggestion(counting, { description: "Grab Ride", accountId: "acct-x", date: "2026-10-12" });
  assert.equal(seen.length, 2, "a draft has no entry to read");

  // The history read walks the household-and-date index, not the whole table.
  const plan = await rows(db, `EXPLAIN QUERY PLAN ${history} `.replace(/\?/g, "'x'"));
  assert.match(plan.map((row) => row.detail).join(" | "), /idx_transactions_household_date/);
  assert.ok(CARD_HISTORY_ROW_LIMIT <= 500);
});
