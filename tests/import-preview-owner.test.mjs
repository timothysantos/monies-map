// Import preview ownership (DOMAIN.md "ownership defaults"): rows previewed
// onto a direct account take that account's owner, whoever the form's default
// owner is; a joint account and an unknown account keep the form's owner. The
// activity export is Joyce's own OCBC 360 (near-real sanitized fixture).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseOcbcActivityCsv } from "../src/lib/statement-import/ocbc-activity-csv.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

const FIXTURE = "TransactionHistory_20261015085450-ocbc-360-partner-sanitized.csv";
const activityCsv = readFileSync(new URL(`./fixtures/ocbc-activity/${FIXTURE}`, import.meta.url), "utf8");

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function createAccount(api, input) {
  const { status, payload } = await api("/api/accounts/create", {
    kind: "bank",
    institution: "OCBC",
    currency: "SGD",
    openingBalanceMinor: 0,
    ...input
  });
  assert.equal(status, 200, JSON.stringify(payload));
}

// The rows the browser sends for the file: parsed by the real parser, with the
// form's default account and owner as the Imports page holds them.
async function previewActivity(api, { accountName, defaultAccountName = "UOB One", ownerName = "Tim" }) {
  const parsed = parseOcbcActivityCsv(activityCsv, FIXTURE.replace("-ocbc-360-partner-sanitized", ""));
  const rows = parsed.rows.map((row) => ({ ...row, account: accountName ?? row.account }));
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    rows,
    defaultAccountName,
    ownershipType: "direct",
    ownerName
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.preview;
}

test("the fixture is the four-row OCBC 360 export with quoted comma amounts and multiline descriptions", () => {
  const parsed = parseOcbcActivityCsv(activityCsv, "TransactionHistory_20261015085450.csv");
  assert.equal(parsed.parserKey, "ocbc_360_activity_csv");
  assert.deepEqual(parsed.rows.map((row) => [row.date, row.expense, row.income, row.account, row.type]), [
    ["2026-09-30", "2.00", "", "OCBC 360", "expense"],
    ["2026-10-01", "", "2000.00", "OCBC 360", "transfer"],
    ["2026-10-05", "500.00", "", "OCBC 360", "expense"],
    ["2026-10-05", "1000.00", "", "OCBC 360", "expense"]
  ]);
});

test("a direct account's rows take the account owner, not the form's default owner", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createAccount(api, { name: "OCBC 360", ownerPersonId: "person-joyce" });

  const preview = await previewActivity(api, { ownerName: "Tim" });

  assert.equal(preview.previewRows.length, 4);
  assert.deepEqual(preview.previewRows.map((row) => [row.accountName, row.ownershipType, row.ownerName]), [
    ["OCBC 360", "direct", "Joyce"],
    ["OCBC 360", "direct", "Joyce"],
    ["OCBC 360", "direct", "Joyce"],
    ["OCBC 360", "direct", "Joyce"]
  ]);
});

test("a joint account keeps the form's owner choice", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await createAccount(api, { name: "OCBC 360", ownerPersonId: "person-joyce", isJoint: true });

  const preview = await previewActivity(api, { ownerName: "Tim" });

  assert.deepEqual([...new Set(preview.previewRows.map((row) => row.ownerName))], ["Tim"]);
});

test("an account the file names that is not in the app falls back to the form's owner", async (t) => {
  const { api } = await openSeededDatabase(t, template);

  const preview = await previewActivity(api, { ownerName: "Tim" });

  assert.deepEqual([...new Set(preview.previewRows.map((row) => row.accountName))], ["OCBC 360"]);
  assert.deepEqual([...new Set(preview.previewRows.map((row) => row.ownerName))], ["Tim"]);
});

test("committing Joyce's export saves every entry with Joyce as its owner", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await createAccount(api, { name: "OCBC 360", ownerPersonId: "person-joyce" });
  const preview = await previewActivity(api, { ownerName: "Tim" });

  const { status, payload } = await api("/api/imports/commit", {
    sourceLabel: preview.sourceLabel,
    sourceType: "csv",
    parserKey: "ocbc_360_activity_csv",
    rows: preview.previewRows
  });

  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.importedRows, 4);
  assert.deepEqual(await rows(db, `
    SELECT owner_person_id, COUNT(*) AS entries FROM transactions
    WHERE import_id = ? GROUP BY owner_person_id
  `, payload.importId), [{ owner_person_id: "person-joyce", entries: 4 }]);
});
