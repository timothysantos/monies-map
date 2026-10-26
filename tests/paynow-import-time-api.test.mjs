// An imported UOB PayNow-FAST row takes its time of day from the line's PIB
// reference (DOMAIN.md "PayNow Reference"), through the real Worker and a
// real local D1. The date stays the file's; a time already on a matched entry
// is never replaced; a line with no valid reference stays untimed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseCsv } from "../src/lib/csv.ts";
import { orderEntriesWithinDay } from "../src/lib/entry-time.ts";
import { createEntry, createSeededTemplate, failingStatement, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const fixtureRows = () =>
  parseCsv(readFileSync(new URL("./fixtures/uob-paynow/uob-one-paynow-oct-2026-sanitized.csv", import.meta.url), "utf8")).map((row) => ({
    date: row.date,
    description: row.description,
    expense: row.expense,
    income: row.income,
    account: row.account,
    category: row.category,
    note: row.note,
    type: row.type
  }));

async function previewAndCommit(api, csvRows, options = {}) {
  const base = { sourceLabel: "UOB One Oct 2026", sourceType: "csv", rows: csvRows, ownershipType: "direct", ownerName: "Tim" };
  const preview = await api("/api/imports/preview", base);
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const included = preview.payload.preview.previewRows.filter((row) => row.commitStatus === "included");
  const commit = await api("/api/imports/commit", { sourceLabel: base.sourceLabel, sourceType: "csv", parserKey: "generic_csv", rows: included }, options);
  return { preview: preview.payload.preview, included, commit };
}

test("imported PayNow-FAST rows get the time from their PIB reference, and only a valid one", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { commit, included } = await previewAndCommit(api, fixtureRows());
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.equal(included.length, 6);

  const stored = await rows(db, "SELECT description, transaction_date, transaction_time FROM transactions WHERE description LIKE 'PAYNOW%' ORDER BY transaction_date");
  assert.deepEqual(
    stored.map((row) => [row.transaction_date, row.transaction_time, row.description]),
    [
      ["2026-10-01", "20:52", "PAYNOW-FAST OTHR SBA-202627699C PIB26100120520761 86 SLEEK TECH PTE LTD"],
      ["2026-10-02", "08:11", "PAYNOW-FAST OTHR SBA-202627699C PIB26100208114209 41 SLEEK TECH ORCHARD"],
      ["2026-10-03", "12:30", "PAYNOW-FAST OTHR SBA-202699999E PIB26100312300533 12 SAMPLE BAKERY"],
      ["2026-10-05", null, "PAYNOW-FAST OTHR SBA PIB26100525619900 01 NO CODE PTE LTD"], // minute 61: not a time
      ["2026-10-06", null, "PAYNOW OTHR Lunch with friends"], // no reference at all
      ["2026-10-09", null, "PAYNOW-FAST OTHR SBA-202627699C PIB26100112000000 07 SLEEK TECH PTE LTD"] // reference 8 days before the row: not trusted
    ]
  );
  // The dates and descriptions are the file's, untouched.
});

test("a row imported before this change stays untimed when the file is brought in again", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const csv = fixtureRows().slice(0, 1);
  assert.equal((await previewAndCommit(api, csv)).commit.status, 200);
  // The state of a row imported before this change: in the ledger, untimed.
  await db.prepare("UPDATE transactions SET transaction_time = NULL WHERE description = ?").bind(csv[0].description).run();

  const { included } = await previewAndCommit(api, csv);

  assert.equal(included.length, 0, "the identical row is already in the ledger and is not added again");
  assert.equal((await rows(db, "SELECT transaction_time FROM transactions WHERE description = ?", csv[0].description))[0].transaction_time, null);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM transactions WHERE description = ?", csv[0].description))[0].count, 1);
});

test("a non-PayNow bank row and an OCBC-style PayNow row get no time", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const csv = [
    { date: "2026-10-01", description: "FAST PAYMENT OTHR-Monthly to REDACTED PAYEE via PayNow-Mobile", expense: "200.00", income: "", account: "UOB One", category: "Other", note: "", type: "expense" },
    { date: "2026-10-01", description: "Toast Box PIB26100120520761", expense: "5.00", income: "", account: "UOB One", category: "Other", note: "", type: "expense" }
  ];
  const { commit } = await previewAndCommit(api, csv);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const times = await rows(db, "SELECT transaction_time FROM transactions WHERE description IN (?, ?)", csv[0].description, csv[1].description);
  assert.deepEqual(times, [{ transaction_time: null }, { transaction_time: null }]);
});

test("a PayNow row matched to an Apple Pay entry keeps the Apple Pay entry's time", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: "2026-10-01", description: "Sleek Tech", amountMinor: 1840, categoryName: "Food & Drinks", time: "20:49", note: "applepay" });
  const csv = fixtureRows().slice(0, 1);
  const { preview, commit } = await previewAndCommit(api, csv);
  assert.equal(preview.previewRows[0].reconciliationTargetTransactionId, entryId, "the bank row pairs with the entry already there");
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const [entry] = await rows(db, "SELECT description, transaction_time FROM transactions WHERE id = ?", entryId);
  assert.equal(entry.transaction_time, "20:49", "the time of the purchase the person's phone saw stays");
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM transactions WHERE description LIKE 'PAYNOW%'"))[0].count, entry.description.startsWith("PAYNOW") ? 1 : 0);
});

test("a failed import commit leaves no timed row behind", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const failing = failingStatement(db, /INSERT INTO transactions/);
  const { commit } = await previewAndCommit(api, fixtureRows(), { database: failing.db });
  assert.notEqual(commit.status, 200);
  assert.deepEqual(await rows(db, "SELECT transaction_time FROM transactions WHERE transaction_time IS NOT NULL AND description LIKE 'PAYNOW%'"), []);
});

test("the day's order puts the imported timed rows latest first, before the untimed ones", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const csv = [
    { date: "2026-10-01", description: "PAYNOW-FAST OTHR SBA-202627699C PIB26100108000000 01 EARLY SHOP", expense: "3.00", income: "", account: "UOB One", category: "Other", note: "", type: "expense" },
    { date: "2026-10-01", description: "PAYNOW-FAST OTHR SBA-202627699C PIB26100120520761 02 LATE SHOP", expense: "4.00", income: "", account: "UOB One", category: "Other", note: "", type: "expense" },
    { date: "2026-10-01", description: "PAYNOW OTHR Untimed friend", expense: "5.00", income: "", account: "UOB One", category: "Other", note: "", type: "expense" }
  ];
  const { commit } = await previewAndCommit(api, csv);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const page = (await api("/api/entries-page?view=household&month=2026-10")).payload;
  const day = orderEntriesWithinDay(page.monthPage.entries.filter((entry) => entry.date === "2026-10-01" && entry.description.startsWith("PAYNOW")));
  assert.deepEqual(day.map((entry) => entry.description.split(" ").at(-2) + " " + entry.description.split(" ").at(-1)), ["LATE SHOP", "EARLY SHOP", "Untimed friend"]);
  assert.deepEqual(day.map((entry) => entry.time ?? null), ["20:52", "08:00", null]);
});
