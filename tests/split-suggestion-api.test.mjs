// POST /api/splits/suggestion through the real Worker and a real local D1
// seeded with the demo household (DOMAIN.md "Split Suggestion"). Entries
// Tim usually puts on Splits come back as a suggestion for a new card's
// fields or for a saved entry; the route only reads (the whole database is
// identical before and after), and it refuses what it cannot judge.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  openSeededDatabase
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const SHOP = "Kopi Kaki Holland V";

// Tim bought at the shop four times this year and put three of them on
// Splits in Baby River (the add-to-splits route shares 50/50).
async function seedHabit(api, { shop = SHOP, group = "split-group-baby-river", split = 3, unsplit = 1 } = {}) {
  // Ask's own habits would put the later, unsplit entries on Splits by
  // themselves; this file is about the history-based suggestion, so Ask is
  // told not to handle things (tests/ask-habits-route.test.mjs covers that).
  await api("/api/ask/habits/setting", { enabled: false });
  const ids = [];
  for (let index = 0; index < split + unsplit; index += 1) {
    const entryId = await createEntry(api, {
      date: `2026-0${3 + index}-14`,
      description: index === 0 ? shop.toUpperCase() : shop,
      categoryName: "Groceries",
      amountMinor: 2400 + index
    });
    if (index < split) {
      const added = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: group });
      assert.equal(added.status, 200, JSON.stringify(added.payload));
    }
    ids.push(entryId);
  }
  return ids;
}

const draft = (overrides = {}) => ({
  entryType: "expense",
  description: SHOP,
  categoryName: "Groceries",
  ownerName: "Tim",
  accountName: "UOB One",
  date: "2026-09-02",
  ...overrides
});

test("a new card for a shop Tim usually splits gets that group, share and person, read-only", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await seedHabit(api);

  await api("/api/splits/suggestion", draft());
  const before = await dumpDatabase(db);
  const { status, payload } = await api("/api/splits/suggestion", draft());
  assertSameDatabase(await dumpDatabase(db), before);

  assert.equal(status, 200, JSON.stringify(payload));
  assert.deepEqual(payload, {
    ok: true,
    suggestion: {
      groupId: "split-group-baby-river",
      groupName: "Baby River",
      basisPoints: 5000,
      otherPersonId: "person-joyce",
      otherPersonName: "Joyce",
      evidenceCount: 3,
      matchedCount: 4,
      matchedBy: "description"
    }
  });
});

test("a saved entry (the Apple Pay card) is judged by its own fields and never counts for itself", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seedHabit(api);
  const savedId = await createEntry(api, { date: "2026-09-03", description: SHOP, categoryName: "Groceries", amountMinor: 1800, accountName: "UOB One" });

  const fresh = await api("/api/splits/suggestion", { entryId: savedId });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.payload));
  assert.equal(fresh.payload.suggestion?.groupId, "split-group-baby-river");
  assert.equal(fresh.payload.suggestion?.matchedCount, 4);

  // Once it is on Splits there is nothing to suggest.
  const added = await api("/api/splits/expenses/from-entry", { entryId: savedId, splitGroupId: "split-group-baby-river" });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  const onSplits = await api("/api/splits/suggestion", { entryId: savedId });
  assert.deepEqual(onSplits.payload, { ok: true, suggestion: null });
});

test("no suggestion for Joyce, for income, for too little history, or a shop never split", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seedHabit(api);
  await seedHabit(api, { shop: "Rarely Shared Bakery", split: 1, unsplit: 3 });

  for (const body of [
    draft({ ownerName: "Joyce" }),
    draft({ entryType: "income", categoryName: "Other - Income" }),
    draft({ description: "Rarely Shared Bakery" }),
    draft({ description: "A brand new place", categoryName: "Other" }),
    draft({ ownerName: "Shared" })
  ]) {
    const { status, payload } = await api("/api/splits/suggestion", body);
    assert.equal(status, 200, JSON.stringify(payload));
    assert.deepEqual(payload, { ok: true, suggestion: null }, JSON.stringify(body));
  }
});

test("bad requests are refused and an unknown saved entry is not found", async (t) => {
  const { api, fetch } = await openSeededDatabase(t, template);
  const cases = [
    [{ entryType: "expense", description: SHOP, ownerName: "Tim", accountName: "UOB One", date: "02/09/2026" }, 400],
    [{ entryType: "refund", description: SHOP, ownerName: "Tim", accountName: "UOB One", date: "2026-09-02" }, 400],
    [{ entryType: "expense", description: "x".repeat(241), ownerName: "Tim", accountName: "UOB One", date: "2026-09-02" }, 400],
    [{ entryId: "txn-missing" }, 404]
  ];
  for (const [body, expected] of cases) {
    const { status, payload } = await api("/api/splits/suggestion", body);
    assert.equal(status, expected, JSON.stringify(body));
    assert.equal(payload.ok, false);
  }
  const get = await fetch("/api/splits/suggestion");
  assert.equal(get.status, 405);
});
