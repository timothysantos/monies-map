import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIntakeMatch,
  buildIntakeQueueItem,
  summarizeIntakeQueue
} from "../src/client/import-intake-model.js";

test("intake matching uses parsed statement evidence instead of filename", () => {
  const match = buildIntakeMatch({
    sourceType: "pdf",
    inbox: inbox([
      expectedFile({ id: "citi-jul", accountName: "Citi Rewards", periodMonth: "2026-07", sourceType: "pdf_statement" })
    ]),
    parsed: {
      parserKey: "citibank_credit_card_pdf",
      checkpoints: [{ accountName: "Citi Rewards", checkpointMonth: "2026-07", statementBalanceMinor: 12345 }],
      rows: []
    }
  });

  assert.deepEqual(match, { status: "matched", expectedFileIds: ["citi-jul"] });
});

test("intake matching reports ambiguity when content cannot prove which expected account owns the file", () => {
  const match = buildIntakeMatch({
    sourceType: "pdf",
    inbox: inbox([
      expectedFile({ id: "uob-card-jul", accountName: "UOB One Card", periodMonth: "2026-07", sourceType: "pdf_statement" }),
      expectedFile({ id: "uob-savings-jul", accountName: "UOB One", periodMonth: "2026-07", sourceType: "pdf_statement" })
    ]),
    parsed: {
      parserKey: "uob_credit_card_pdf",
      checkpoints: [{ accountName: "UOB One", checkpointMonth: "2026-07", statementBalanceMinor: 12345 }],
      rows: []
    }
  });

  assert.equal(match.status, "ambiguous");
  assert.deepEqual(match.expectedFileIds, ["uob-card-jul", "uob-savings-jul"]);
});

test("intake queue flags repeated content as duplicate without storing the original file", () => {
  const first = buildIntakeQueueItem({
    id: "file-1",
    fileName: "download.pdf",
    sourceType: "pdf",
    inbox: inbox([]),
    parsed: parsedStatement()
  });
  const second = buildIntakeQueueItem({
    id: "file-2",
    fileName: "download (1).pdf",
    sourceType: "pdf",
    inbox: inbox([]),
    parsed: parsedStatement(),
    existingFingerprints: new Set([first.fingerprint])
  });

  assert.equal(second.duplicate, true);
  assert.equal(second.parsed.rows.length, 1);
  assert.equal("file" in second, false);
  assert.deepEqual(summarizeIntakeQueue([first, second]), {
    total: 2,
    ready: 0,
    ambiguous: 0,
    unexpected: 2,
    duplicate: 1
  });
});

function inbox(reviewQueue) {
  return { reviewQueue };
}

function expectedFile(overrides) {
  return {
    id: overrides.id,
    institution: "Bank",
    accountId: overrides.id,
    accountName: overrides.accountName,
    ownerLabel: "Tim",
    sourceType: overrides.sourceType,
    priority: "required",
    periodMonth: overrides.periodMonth,
    label: overrides.id,
    detail: "",
    supportedFileTypes: ["PDF statement"],
    reviewOrder: 1
  };
}

function parsedStatement() {
  return {
    sourceLabel: "Citi Rewards Jul",
    parserKey: "citibank_credit_card_pdf",
    checkpoints: [{ accountName: "Citi Rewards", checkpointMonth: "2026-07", statementBalanceMinor: 12345 }],
    rows: [{ date: "2026-07-02", description: "Coffee", amountMinor: -450, accountName: "Citi Rewards" }]
  };
}
