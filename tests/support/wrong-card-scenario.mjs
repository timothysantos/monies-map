// The wrong-card Apple Pay scenario for API tests, from the sanitized
// fixture tests/fixtures/uob-card-activity/wrong-card-oct-2026-sanitized.json:
// Tim owns UOB One Card and UOB Lady's Card. Three Apple Pay entries dated
// 2026-10-11 were saved on Lady's Card (Cold Storage-Star Vist 1.80, CS Fresh
// 9.70, FairPrice finest 7.84), but the purchases were paid with One Card,
// whose 14 Oct activity file holds the same three rows. The Lady's Card
// mid-cycle file (13 Jul to 13 Oct) covers 11 Oct and does not list them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { enableShortcut, postWalletPurchase } from "./foreign-wallet.mjs";

export const ONE_CARD = "UOB One Card";
export const LADYS_CARD = "UOB Lady's Card";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/uob-card-activity/wrong-card-oct-2026-sanitized.json", import.meta.url), "utf8"));
export const ONE_CARD_FILE = fixture.oneCardActivity14Oct;
export const LADYS_FILE = fixture.ladysMidCycle13Oct;

export const APPLE_PAY_ENTRIES = [
  { description: "Cold Storage-Star Vist", amount: "1.80", date: "2026-10-11" },
  { description: "CS Fresh", amount: "9.70", date: "2026-10-11" },
  { description: "FairPrice finest", amount: "7.84", date: "2026-10-11" }
];

export async function createCards(api) {
  const ids = {};
  for (const name of [ONE_CARD, LADYS_CARD]) {
    const { status, payload } = await api("/api/accounts/create", {
      name,
      institution: "UOB",
      kind: "credit_card",
      currency: "SGD",
      openingBalanceMinor: 0,
      ownerPersonId: "person-tim",
      isJoint: false
    });
    assert.equal(status, 200, JSON.stringify(payload));
    ids[name] = payload.accountId;
  }
  return ids;
}

// Saves the purchases the way the Apple Pay Shortcut does, on the card
// named (the Shortcut picked Lady's Card).
export async function saveApplePayEntries(workspace, entries = APPLE_PAY_ENTRIES, accountName = LADYS_CARD) {
  await enableShortcut(workspace.db);
  const entryIds = [];
  for (const entry of entries) {
    // The shipped Shortcut sends a request id, which is what marks the entry
    // as saved by Apple Pay.
    const { status, payload } = await postWalletPurchase(workspace.fetch, { ...entry, accountName, categoryName: "Groceries", requestId: crypto.randomUUID() });
    assert.equal(status, 200, JSON.stringify(payload));
    entryIds.push(payload.entryId);
  }
  return entryIds;
}

export async function previewFile(api, rows, sourceLabel) {
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel,
    sourceType: "csv",
    parserKey: "uob_credit_card_current_transactions_xls",
    rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.preview;
}

// What the Imports page sends: the rows still included, plus the removals
// the user confirmed and every previewed row so the checks run again.
export function commitBody(preview, sourceLabel, { remove = [] } = {}) {
  return {
    sourceLabel,
    sourceType: "csv",
    parserKey: "uob_credit_card_current_transactions_xls",
    rows: preview.previewRows.filter((row) => row.commitStatus === "included"),
    ...(remove.length ? {
      wrongCardDuplicates: remove.map((item) => ({ transactionId: item.transactionId, twinKind: item.twin.kind, twinId: item.twin.id })),
      reviewedRows: preview.previewRows
    } : {})
  };
}

export async function commitFile(api, preview, sourceLabel, options = {}) {
  const result = await api("/api/imports/commit", commitBody(preview, sourceLabel, options));
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  return result.payload.importId;
}
