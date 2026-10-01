// The wrong-card statement scenario, from the sanitized two-card UOB
// statement (tests/fixtures/pdf-statement-text/uob-card-two-card-may-2026-
// sanitized.pdf-text.txt), parsed by the real parser.
//
// Tim owns UOB One Card and UOB Lady's Card. Before the statement arrived he
// recorded some purchases by hand (as a Shortcut would): two of them,
// OpenAI and Buyandship, on Lady's Card although the statement prints them
// in the One Card section. Sabai Sabai was bought after the statement closed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseStatementText } from "../../src/lib/statement-import.ts";
import { createEntry } from "./d1-workspace.mjs";

export const ONE_CARD = "UOB One Card";
export const LADYS_CARD = "UOB Lady's Card";

export function parseUobTwoCardStatement() {
  const text = readFileSync(new URL("../fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized.pdf-text.txt", import.meta.url), "utf8");
  return parseStatementText(text, "eStatement_UOB_Cards_12May2026.pdf");
}

export async function setUpWrongCardScenario(api) {
  const createAccount = async (name, openingBalanceMinor) => {
    const { status, payload } = await api("/api/accounts/create", {
      name,
      institution: "UOB",
      kind: "credit_card",
      currency: "SGD",
      // Bank-facing: the balance printed as PREVIOUS BALANCE on the
      // statement, positive when owed.
      openingBalanceMinor,
      ownerPersonId: "person-tim",
      isJoint: false
    });
    assert.equal(status, 200, JSON.stringify(payload));
    return payload.accountId;
  };
  const oneCardId = await createAccount(ONE_CARD, 15000);
  const ladysCardId = await createAccount(LADYS_CARD, -1250);

  const entry = (accountName, date, description, amountMinor, categoryName) => createEntry(api, {
    accountName,
    date,
    description,
    amountMinor,
    categoryName,
    note: "Recorded by hand"
  });
  const entryIds = {
    dimSum: await entry(ONE_CARD, "2026-04-11", "HONG KONG ZHAI DIM SUM", 1140, "Food & Drinks"),
    donki: await entry(LADYS_CARD, "2026-04-30", "Don Don Donki", 1890, "Groceries"),
    // On the wrong card: the statement prints these under UOB One Card.
    openai: await entry(LADYS_CARD, "2026-04-20", "OpenAI", 2949, "Subscriptions MO"),
    buyandship: await entry(LADYS_CARD, "2026-05-05", "Buyandship", 1313, "Shopping"),
    // After the 12 May statement: stays provisional for the June statement.
    sabai: await entry(LADYS_CARD, "2026-05-14", "Sabai Sabai - Valley P", 2049, "Food & Drinks")
  };
  return { oneCardId, ladysCardId, entryIds, statement: parseUobTwoCardStatement() };
}

export function previewBody(statement, statementFixes = []) {
  return {
    sourceLabel: "eStatement_UOB_Cards_12May2026",
    sourceType: "pdf",
    rows: statement.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: statement.checkpoints,
    statementFixes
  };
}

export async function previewStatement(api, statement, statementFixes = []) {
  const { status, payload } = await api("/api/imports/preview", previewBody(statement, statementFixes));
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.preview;
}

// What the Imports page sends to commit a statement preview.
export function commitBody(statement, preview, statementFixes = []) {
  return {
    sourceLabel: "eStatement_UOB_Cards_12May2026",
    sourceType: "pdf",
    parserKey: statement.parserKey,
    statementCheckpoints: statement.checkpoints,
    statementControlRows: preview.previewRows,
    statementReconciliations: preview.statementReconciliations,
    rows: preview.previewRows.filter((row) => row.commitStatus === "included"),
    statementFixes
  };
}

export function suggestedFixes(preview) {
  return preview.statementDiagnosis.findings
    .filter((finding) => finding.fix && !finding.applied && finding.confidence === "high")
    .map((finding) => finding.fix);
}
