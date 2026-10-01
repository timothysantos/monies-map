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

test("a two-card statement matches each card's needed file instead of reading as ambiguous", async () => {
  const { buildIntakeMatch: match } = await import("../src/client/import-intake-model.js");
  const result = match({
    sourceType: "pdf",
    inbox: inbox([
      expectedFile({ id: "uob-one-card-may", accountName: "UOB One Card", periodMonth: "2026-05", sourceType: "pdf_statement" }),
      expectedFile({ id: "uob-ladys-may", accountName: "UOB Lady's Card", periodMonth: "2026-05", sourceType: "pdf_statement" }),
      expectedFile({ id: "uob-one-savings-may", accountName: "UOB One", periodMonth: "2026-05", sourceType: "pdf_statement" })
    ]),
    parsed: {
      parserKey: "uob_credit_card_pdf",
      checkpoints: [
        { accountName: "UOB One Card", checkpointMonth: "2026-05", statementBalanceMinor: 5796 },
        { accountName: "UOB Lady's Card", checkpointMonth: "2026-05", statementBalanceMinor: 11705 }
      ],
      rows: []
    }
  });

  assert.deepEqual(result, { status: "matched", expectedFileIds: ["uob-one-card-may", "uob-ladys-may"] });
});

test("the queue reviews statements before activity, older months first, and counts activity rows a queued statement covers", async () => {
  const { orderIntakeQueue, describeIntakeCoverage } = await import("../src/client/import-intake-model.js");
  const statement = {
    id: "may-statement",
    fileName: "eStatement_UOB_Cards_12May2026.pdf",
    sourceLabel: "eStatement_UOB_Cards_12May2026",
    sourceType: "pdf",
    duplicate: false,
    parsed: { checkpoints: [{ accountName: "UOB One Card", checkpointMonth: "2026-05", statementStartDate: "2026-04-13", statementEndDate: "2026-05-12" }], rows: [] }
  };
  const aprilStatement = { ...statement, id: "apr-statement", parsed: { checkpoints: [{ accountName: "UOB One Card", checkpointMonth: "2026-04", statementStartDate: "2026-03-13", statementEndDate: "2026-04-12" }], rows: [] } };
  const activity = {
    id: "activity",
    fileName: "CC_TXN_History.xls",
    sourceLabel: "CC_TXN_History",
    sourceType: "csv",
    duplicate: false,
    parsed: {
      checkpoints: [],
      rows: [
        { date: "2026-04-22", account: "UOB One Card" },
        { date: "2026-05-06", account: "UOB One Card" },
        { date: "2026-05-15", account: "UOB One Card" },
        { date: "2026-05-01", account: "UOB Lady's Card" }
      ]
    }
  };

  assert.deepEqual(orderIntakeQueue([activity, statement, aprilStatement]).map((item) => item.id), ["apr-statement", "may-statement", "activity"]);
  // Two One Card rows fall inside the May statement; the 15 May row is after
  // it and the Lady's Card row is another card.
  assert.deepEqual(describeIntakeCoverage(activity, [activity, statement]), {
    coveredCount: 2,
    rowCount: 4,
    statementLabel: "eStatement_UOB_Cards_12May2026"
  });
  assert.equal(describeIntakeCoverage(statement, [activity, statement]), undefined);
  assert.equal(describeIntakeCoverage(activity, [activity]), undefined);
});
