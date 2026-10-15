// Investment statement imports: the commit's rows, transfer link and market
// value, and the rollback that undoes them, are all-or-nothing. Each case
// makes one statement fail partway and proves the database is exactly what
// it was before (no half-linked transfer, no value without its rows).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { parseStatementText } from "../src/lib/statement-import.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function seedImport(api) {
  const bank = await api("/api/accounts/create", { name: "OCBC 360", institution: "OCBC", kind: "bank", ownerPersonId: "person-joyce", isJoint: false });
  await api("/api/accounts/create", { name: "Alex iFAST", institution: "iFAST", kind: "investment", ownerPersonId: "person-joyce", isJoint: false });
  const giroId = await createEntry(api, {
    accountName: "OCBC 360",
    date: "2026-07-03",
    description: "IBG GIRO COLL P0000194 IFAST FINANCIAL PL- P0000194",
    amountMinor: 68_500,
    categoryName: "Investments",
    ownerName: "Joyce"
  });
  const text = readFileSync(new URL("./fixtures/pdf-statement-text/ifast-wrap-jul-2026-real-sanitized.pdf-text.txt", import.meta.url), "utf8");
  const parsed = parseStatementText(text, "ifast-wrap-jul-2026-real.pdf");
  const preview = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "pdf",
    rows: parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: parsed.checkpoints
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  return {
    bankId: bank.payload.accountId,
    giroId,
    body: {
      sourceLabel: parsed.sourceLabel,
      sourceType: "pdf",
      parserKey: parsed.parserKey,
      rows: preview.payload.preview.previewRows,
      statementCheckpoints: parsed.checkpoints
    }
  };
}

test("a commit whose market value cannot be saved leaves no import, contribution, link or paired bank entry", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { body } = await seedImport(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO investment_statement_values/);

  const { status, payload } = await api("/api/imports/commit", body, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 400);
  assert.match(payload.error, /injected_failure_missing_table/);
  assertSameDatabase(await dumpDatabase(db), before);

  const retry = await api("/api/imports/commit", body);
  assert.equal(retry.payload.created, true);
});

test("a commit whose transfer link fails leaves the bank entry and the contribution untouched", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { body, giroId } = await seedImport(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO import_transfer_links/);

  const { status } = await api("/api/imports/commit", body, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
  assert.deepEqual(await rows(db, "SELECT entry_type, transfer_group_id FROM transactions WHERE id = ?", giroId), [{ entry_type: "expense", transfer_group_id: null }]);
});

test("a rollback that fails while restoring the bank entry leaves the committed import exactly as it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { body } = await seedImport(api);
  const commit = await api("/api/imports/commit", body);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM investment_statement_values/);

  const { status } = await api("/api/imports/rollback", { importId: commit.payload.importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 500);
  assertSameDatabase(await dumpDatabase(db), before);
});
