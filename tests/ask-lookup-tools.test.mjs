// Ask's read-only lookup tools on a real local D1 (demo household): compact,
// household-scoped, no amounts, no long numbers, capped, and every bad call
// is an answer the model can read.
import assert from "node:assert/strict";
import test from "node:test";

import { ASK_LOOKUP_LIMITS, lookupBudgetLeft, runLookupTool } from "../src/domain/ask-lookup-tools.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();
const run = (db, tool, args) => runLookupTool(db, { tool, args }, TODAY);

test("find_entries finds last night's dinner by words and date, newest first, without amounts or phone numbers", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createEntry(api, { date: TODAY, description: "Sushi Dinner PAYNOW 91234567", categoryName: "Food & Drinks", amountMinor: 8_800 });
  await createEntry(api, { date: "2026-01-02", description: "Sushi Dinner old", categoryName: "Food & Drinks", amountMinor: 7_700 });
  const result = await run(db, "find_entries", { text: "dinner", from: "2026-03-01" });
  assert.equal(result.ok, true);
  const lines = result.text.split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^id txn-.* \\| ${TODAY} \\| Sushi Dinner PAYNOW \\| expense \\| Food & Drinks \\| owner Tim \\| not on splits$`));
  assert.doesNotMatch(result.text, /91234567|88\.00|8800/);
  const none = await run(db, "find_entries", { text: "no such thing xyz" });
  assert.deepEqual(none, { ok: true, text: "No entries matched." });
});

test("find_entries filters by category and person, caps rows, and treats % and _ as plain text", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  for (let index = 0; index < 12; index += 1) {
    await createEntry(api, { date: TODAY, description: `Cap Cafe ${index}`, categoryName: "Food & Drinks", amountMinor: 500 + index });
  }
  await createEntry(api, { date: TODAY, description: "Joyce Cap Cafe", categoryName: "Groceries", ownerName: "Joyce", amountMinor: 500 });
  const capped = await run(db, "find_entries", { text: "cap cafe", limit: 500 });
  assert.equal(capped.text.split("\n").length, ASK_LOOKUP_LIMITS.maxRows);
  const joyce = await run(db, "find_entries", { text: "cap cafe", person: "joyce", category: "Groceries" });
  assert.equal(joyce.text.split("\n").length, 1);
  assert.match(joyce.text, /owner Joyce/);
  assert.deepEqual(await run(db, "find_entries", { text: "%" }), { ok: true, text: "No entries matched." });
  assert.deepEqual(await run(db, "find_entries", { text: "_" }), { ok: true, text: "No entries matched." });
  assert.ok(capped.text.length <= ASK_LOOKUP_LIMITS.maxResultChars);
});

test("get_entry shows one entry with a short note that carries no long number; unknown ids are refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const id = await createEntry(api, { date: TODAY, description: "Gift", categoryName: "Shopping", amountMinor: 3_000, note: `ref 123456789012 ${"x".repeat(200)}` });
  const result = await run(db, "get_entry", { id });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.text, /123456789012/);
  assert.ok(result.text.split("note: ")[1].length <= ASK_LOOKUP_LIMITS.maxNoteChars);
  assert.deepEqual(await run(db, "get_entry", { id: "txn-from-another-household" }), { ok: false, text: "No such entry." });
  assert.deepEqual(await run(db, "get_entry", {}), { ok: false, text: "Give the entry id." });
});

test("list_recent_entries returns the newest few, capped", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  for (const name of ["First", "Second", "Third"]) await createEntry(api, { date: TODAY, description: name, amountMinor: 100 });
  const result = await run(db, "list_recent_entries", { n: 2 });
  assert.equal(result.text.split("\n").length, 2);
  assert.match(result.text.split("\n")[0], /Third/);
  assert.equal((await run(db, "list_recent_entries", { n: 999 })).text.split("\n").length, ASK_LOOKUP_LIMITS.maxRows);
});

test("get_split_balances says who owes whom and never an amount", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const id = await createEntry(api, { date: TODAY, description: "Shared Dinner", categoryName: "Food & Drinks", amountMinor: 9_900 });
  assert.equal((await api("/api/splits/expenses/from-entry", { entryId: id, splitGroupId: null })).status, 200);
  const all = await run(db, "get_split_balances", {});
  assert.equal(all.ok, true);
  assert.doesNotMatch(all.text, /\d\.\d\d|\$|\d{3,}/);
  assert.match(all.text, /owes|settled/);
  assert.deepEqual(await run(db, "get_split_balances", { group: "no such group" }), { ok: true, text: "No such group." });
});

test("get_category_history counts categories and splits for a shop, no amounts", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  for (const category of ["Food & Drinks", "Food & Drinks", "Groceries"]) {
    await createEntry(api, { date: TODAY, description: "Corner Cafe", categoryName: category, amountMinor: 1_234 });
  }
  const result = await run(db, "get_category_history", { merchant: "corner cafe" });
  assert.match(result.text, /^Food & Drinks x\d, /);
  assert.match(result.text, /on splits \d of 3$/);
  assert.doesNotMatch(result.text, /12\.34|1234/);
  assert.deepEqual(await run(db, "get_category_history", { merchant: "nowhere" }), { ok: true, text: "No entries at that shop." });
  assert.deepEqual(await run(db, "get_category_history", {}), { ok: false, text: "Give the shop name." });
});

test("tools only read, an unknown tool is an answer, and the turn budget stops at 4 calls or the token cap", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createEntry(api, { date: TODAY, description: "Read Only", amountMinor: 100 });
  const before = await dumpDatabase(db);
  for (const tool of ["find_entries", "get_entry", "get_split_balances", "list_recent_entries", "get_category_history"]) {
    await run(db, tool, { text: "read", id: "x", merchant: "read" });
  }
  assert.deepEqual(await run(db, "delete_entry", { id: "x" }), { ok: false, text: "Unknown lookup." });
  assert.deepEqual(await run(db, "find_entries", "not an object"), { ok: true, text: (await run(db, "find_entries", {})).text });
  assertSameDatabase(await dumpDatabase(db), before);

  assert.equal(lookupBudgetLeft({ modelCalls: 3, tokens: 100 }), true);
  assert.equal(lookupBudgetLeft({ modelCalls: 4, tokens: 100 }), false);
  assert.equal(lookupBudgetLeft({ modelCalls: 1, tokens: ASK_LOOKUP_LIMITS.maxTurnTokens }), false);
});
