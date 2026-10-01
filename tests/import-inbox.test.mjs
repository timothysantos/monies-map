import assert from "node:assert/strict";
import test from "node:test";

import { buildImportInbox } from "../src/domain/import-inbox.ts";

const NOW = new Date("2026-08-18T00:00:00.000Z");

test("import inbox isolates only stale Citibank cards when other accounts are current", () => {
  const inbox = buildImportInbox({
    now: NOW,
    pendingSplitMatchCount: 0,
    recentImports: [],
    accounts: [
      account({ id: "citi-rewards", institution: "Citibank", name: "Citi Rewards", latestCheckpointMonth: "2026-06" }),
      account({ id: "citi-miles", institution: "Citibank", name: "Citi Miles", latestCheckpointMonth: "2026-06" }),
      account({ id: "uob-one", institution: "UOB", name: "UOB One Card", latestCheckpointMonth: "2026-07", latestImportAt: "2026-08-12T00:00:00.000Z" }),
      account({ id: "ocbc-360", institution: "OCBC", name: "OCBC 360", latestCheckpointMonth: "2026-07", latestImportAt: "2026-08-10T00:00:00.000Z" })
    ]
  });

  assert.equal(inbox.summary.staleAccountCount, 2);
  assert.equal(inbox.summary.requiredFileCount, 2);
  assert.equal(inbox.sessions[0].institution, "Citibank");
  assert.equal(inbox.sessions[0].status, "needs_files");
  assert.deepEqual(
    inbox.sessions[0].expectedFiles.filter((file) => file.priority === "required").map((file) => file.label),
    ["Citi Miles 2026-07 statement", "Citi Rewards 2026-07 statement"]
  );
  assert.equal(inbox.sessions.filter((session) => session.status === "needs_files").length, 1);
});

test("import inbox batches two-month catch-up by bank session and reviews oldest statements first", () => {
  const inbox = buildImportInbox({
    now: NOW,
    pendingSplitMatchCount: 0,
    recentImports: [],
    accounts: [
      account({ id: "uob-card", institution: "UOB", name: "UOB One Card", latestCheckpointMonth: "2026-05", latestImportAt: "2026-07-01T00:00:00.000Z" }),
      account({ id: "uob-bank", institution: "UOB", name: "UOB One", latestCheckpointMonth: "2026-05", latestImportAt: "2026-07-01T00:00:00.000Z" }),
      account({ id: "citi", institution: "Citibank", name: "Citi Rewards", latestCheckpointMonth: "2026-05", latestImportAt: "2026-07-01T00:00:00.000Z" }),
      account({ id: "hsbc", institution: "HSBC", name: "HSBC Visa", latestCheckpointMonth: "2026-05" })
    ]
  });

  const uobSession = inbox.sessions.find((session) => session.institution === "UOB");
  assert.equal(uobSession.status, "needs_files");
  assert.deepEqual(
    uobSession.expectedFiles.filter((file) => file.priority === "required").map((file) => file.label),
    [
      "UOB One 2026-06 statement",
      "UOB One 2026-07 statement",
      "UOB One Card 2026-06 statement",
      "UOB One Card 2026-07 statement"
    ]
  );

  assert.deepEqual(
    inbox.reviewQueue.filter((file) => file.priority === "required").map((file) => `${file.periodMonth}:${file.institution}:${file.accountName}`),
    [
      "2026-06:Citibank:Citi Rewards",
      "2026-06:HSBC:HSBC Visa",
      "2026-06:UOB:UOB One",
      "2026-06:UOB:UOB One Card",
      "2026-07:Citibank:Citi Rewards",
      "2026-07:HSBC:HSBC Visa",
      "2026-07:UOB:UOB One",
      "2026-07:UOB:UOB One Card"
    ]
  );
});

test("import inbox keeps split cleanup separate from required bank files", () => {
  const inbox = buildImportInbox({
    now: NOW,
    pendingSplitMatchCount: 9,
    recentImports: [],
    accounts: [
      account({ id: "ocbc", institution: "OCBC", name: "OCBC 360", latestCheckpointMonth: "2026-07", latestImportAt: "2026-08-16T00:00:00.000Z" })
    ]
  });

  assert.equal(inbox.summary.requiredFileCount, 0);
  assert.equal(inbox.summary.pendingSplitMatchCount, 9);
  assert.equal(inbox.cleanup.status, "needs_review");
  assert.equal(inbox.sessions[0].status, "current");
});

test("cards whose last statement arrived on one PDF are asked for as one statement", () => {
  const inbox = buildImportInbox({
    now: NOW,
    pendingSplitMatchCount: 0,
    recentImports: [{
      id: "uob-may",
      sourceLabel: "eStatement_UOB_Cards_12May2026",
      sourceType: "pdf",
      importedAt: "2026-06-01T00:00:00.000Z",
      status: "completed",
      transactionCount: 10,
      accountNames: ["UOB One Card - Tim", "UOB Lady's Card - Tim"],
      statementCertificateCount: 2
    }],
    accounts: [
      account({ id: "uob-one-card", institution: "UOB", name: "UOB One Card", latestCheckpointMonth: "2026-05", latestImportAt: "2026-08-12T00:00:00.000Z" }),
      account({ id: "uob-ladys", institution: "UOB", name: "UOB Lady's Card", latestCheckpointMonth: "2026-05", latestImportAt: "2026-08-12T00:00:00.000Z" }),
      account({ id: "uob-savings", institution: "UOB", name: "UOB Savings", kind: "bank", latestCheckpointMonth: "2026-06", latestImportAt: "2026-08-12T00:00:00.000Z" })
    ]
  });

  const uobFiles = inbox.sessions.find((session) => session.institution === "UOB").expectedFiles.filter((file) => file.priority === "required");
  // Two months each for both cards become two statements, plus savings.
  assert.deepEqual(uobFiles.map((file) => [file.accountName, file.periodMonth]), [
    ["UOB Lady's Card and UOB One Card", "2026-06"],
    ["UOB Lady's Card and UOB One Card", "2026-07"],
    ["UOB Savings", "2026-07"]
  ]);
  assert.deepEqual(uobFiles[0].coveredAccounts, [
    { accountId: "uob-ladys", accountName: "UOB Lady's Card" },
    { accountId: "uob-one-card", accountName: "UOB One Card" }
  ]);
  assert.equal(uobFiles[0].detail, "One UOB statement covers UOB Lady's Card and UOB One Card. Download the 2026-06 PDF statement while signed in to UOB.");
  assert.equal(inbox.summary.requiredFileCount, 3);
});

function account(overrides) {
  return {
    id: overrides.id,
    institutionId: `${overrides.institution.toLowerCase()}-id`,
    name: overrides.name,
    institution: overrides.institution,
    kind: overrides.kind ?? "credit_card",
    ownerLabel: overrides.ownerLabel ?? "Tim",
    currency: "SGD",
    openingBalanceMinor: 0,
    isJoint: false,
    isActive: true,
    ...overrides
  };
}
