// Waiting files (DOMAIN.md "Waiting File"): every command is all-or-nothing.
// Keeping a file (its row, every byte chunk, the day's count and the audit
// line), removing one, the 30-day sweep, a new Shortcut key, and the import
// commit that takes its file out of the store: a failure at any statement
// leaves the database exactly as it was. Real local D1, demo household.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  listWaitingFiles,
  receiveWaitingFiles,
  removeWaitingFile,
  sweepExpiredWaitingFiles
} from "../src/domain/app-repository-waiting-files.ts";
import { makeNewFileIntakeKey } from "../src/domain/app-repository-file-intake-key.ts";
import { commitImportBatch } from "../src/domain/app-repository-import-commit.ts";
import { sha256Hex } from "../src/domain/waiting-files.ts";
import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const PDF = new Uint8Array(readFileSync(new URL("./fixtures/locked-pdf/uob-one-savings-apr-2026.plain.pdf", import.meta.url)));

// Three chunks, so a failure can land between them.
async function incomingFile(name = "statement.pdf") {
  const bytes = new Uint8Array(1_200_000);
  bytes.set(PDF);
  return { fileName: name, fileKind: "pdf", contentType: "application/pdf", sha256: await sha256Hex(bytes), bytes };
}

async function seedWaitingFile(db) {
  const result = await receiveWaitingFiles(db, [await incomingFile()], { arrivedVia: "shortcut" });
  assert.equal(result.ok, true);
  return (await listWaitingFiles(db))[0];
}

function countingBatches(db) {
  const batches = [];
  const counting = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return (statements) => {
          batches.push(statements.length);
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { counting, batches };
}

const receiveFailures = [
  ["its row", /INSERT INTO waiting_files/, 0],
  ["its first byte chunk", /INSERT INTO waiting_file_chunks/, 0],
  ["its last byte chunk", /INSERT INTO waiting_file_chunks/, 2],
  ["its audit event", /INSERT INTO audit_events/, 0],
  ["the day's count", /INSERT INTO waiting_file_daily_counts/, 0]
];

for (const [what, pattern, skip] of receiveFailures) {
  test(`keeping a file: a failure on ${what} leaves the database as it was`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });
    await assert.rejects(receiveWaitingFiles(faulty.db, [await incomingFile()], { arrivedVia: "shortcut" }), /injected_failure_missing_table/);
    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

test("keeping two files writes both, every chunk, the count and two audit lines in one batch", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const { counting, batches } = countingBatches(db);
  await receiveWaitingFiles(counting, [await incomingFile("a.pdf"), { fileName: "b.csv", fileKind: "csv", contentType: "text/csv", sha256: "b", bytes: new TextEncoder().encode("date,amount\n") }], { arrivedVia: "shortcut" });
  // a.pdf: row + 3 chunks + audit; b.csv: row + 1 chunk + audit; the count.
  assert.deepEqual(batches, [9]);
});

for (const [what, pattern] of [["its bytes", /DELETE FROM waiting_file_chunks/], ["its row", /DELETE FROM waiting_files/], ["its audit event", /INSERT INTO audit_events/]]) {
  test(`Remove: a failure on ${what} leaves the file waiting`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    const file = await seedWaitingFile(db);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    await assert.rejects(removeWaitingFile(faulty.db, file.id), /injected_failure_missing_table/);
    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  });

  test(`the 30-day sweep: a failure on ${what} leaves the file for the next read`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    const file = await seedWaitingFile(db);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    await assert.rejects(sweepExpiredWaitingFiles(faulty.db, [file]), /injected_failure_missing_table/);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

for (const [what, pattern] of [["the key", /INSERT INTO app_settings/], ["its audit event", /INSERT INTO audit_events/]]) {
  test(`a new key: a failure on ${what} keeps the old key`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    await makeNewFileIntakeKey(db);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    await assert.rejects(makeNewFileIntakeKey(faulty.db), /injected_failure_missing_table/);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

const importRows = [{ rowId: "r1", rowIndex: 0, date: "2026-06-20", description: "Kopi", amountMinor: 450, entryType: "expense", accountName: "UOB One", categoryName: "Food & Drinks", ownershipType: "direct", ownerName: "Tim", splitBasisPoints: 10000, rawRow: {} }];

for (const [what, pattern] of [["deleting the waiting file", /DELETE FROM waiting_files/], ["deleting its bytes", /DELETE FROM waiting_file_chunks/]]) {
  test(`import commit with a waiting file: a failure on ${what} saves nothing and the file still waits`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    const file = await seedWaitingFile(db);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    await assert.rejects(commitImportBatch(faulty.db, { sourceLabel: "statement.pdf", sourceType: "csv", parserKey: "generic_csv", rows: importRows, waitingFile: file }), /injected_failure_missing_table/);
    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

test("import commit with a waiting file: the import and the file's deletion are one batch", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const file = await seedWaitingFile(db);
  const withFile = countingBatches(db);
  await commitImportBatch(withFile.counting, { sourceLabel: "statement.pdf", sourceType: "csv", parserKey: "generic_csv", rows: importRows, waitingFile: file });
  assert.deepEqual(await listWaitingFiles(db), []);
  // The same commit without a file: the commit's batch is three statements
  // shorter (the bytes, the row, the audit line); the month refresh after
  // it is the same.
  const { db: other } = await openSeededDatabase(t, template);
  const withoutFile = countingBatches(other);
  await commitImportBatch(withoutFile.counting, { sourceLabel: "statement.pdf", sourceType: "csv", parserKey: "generic_csv", rows: importRows });
  assert.equal(withFile.batches.length, withoutFile.batches.length);
  assert.equal(withFile.batches[0], withoutFile.batches[0] + 3);
  assert.deepEqual(withFile.batches.slice(1), withoutFile.batches.slice(1));
});
