import assert from "node:assert/strict";
import test from "node:test";

import { buildIntakeQueueItem } from "../src/client/import-intake-model.js";
import {
  buildInboxChecklistProgress,
  groupInboxFilesByAccount,
  groupInboxFilesByOwner,
  isInboxOpenByDefault,
  nextFoldState
} from "../src/client/import-inbox-model.js";

function expectedFile(overrides) {
  return {
    id: overrides.id,
    institution: overrides.institution ?? "UOB",
    accountId: overrides.id,
    accountName: overrides.accountName,
    ownerLabel: "Tim",
    sourceType: overrides.sourceType ?? "pdf_statement",
    priority: overrides.priority ?? "required",
    periodMonth: overrides.periodMonth ?? "2026-05",
    label: `${overrides.accountName} statement`,
    detail: "Download the statement.",
    supportedFileTypes: ["PDF"],
    reviewOrder: 1,
    ...(overrides.coveredAccounts ? { coveredAccounts: overrides.coveredAccounts } : {})
  };
}

// Two banks: UOB needs the two-card May statement and the One savings May
// statement (plus optional activity); OCBC needs one statement.
function inbox() {
  const uobFiles = [
    expectedFile({ id: "uob-cards-may", accountName: "UOB One Card", coveredAccounts: [
      { accountId: "one-card", accountName: "UOB One Card" },
      { accountId: "ladys", accountName: "UOB Lady's Card" }
    ] }),
    expectedFile({ id: "uob-savings-may", accountName: "UOB One Account" }),
    expectedFile({ id: "uob-activity-jun", accountName: "UOB One Card", sourceType: "activity_export", priority: "optional", periodMonth: "2026-06" })
  ];
  const ocbcFiles = [expectedFile({ id: "ocbc-360-may", institution: "OCBC", accountName: "OCBC 360 Account" })];
  return {
    summary: { requiredFileCount: 3, optionalFileCount: 1 },
    sessions: [
      { institution: "UOB", status: "needs_files", requiredFileCount: 2, optionalFileCount: 1, expectedFiles: uobFiles },
      { institution: "OCBC", status: "needs_files", requiredFileCount: 1, optionalFileCount: 0, expectedFiles: ocbcFiles }
    ],
    reviewQueue: [...uobFiles, ...ocbcFiles]
  };
}

function queuedStatement(id, checkpoints, existingFingerprints) {
  return buildIntakeQueueItem({
    id,
    fileName: `${id}.pdf`,
    sourceType: "pdf",
    inbox: inbox(),
    existingFingerprints,
    parsed: {
      parserKey: "uob_credit_card_pdf",
      checkpoints,
      rows: [{ date: "2026-05-02", description: "GRAB", amountMinor: -1230, accountName: checkpoints[0].accountName }]
    }
  });
}

test("with nothing queued every required file is still missing, bank by bank", () => {
  const progress = buildInboxChecklistProgress(inbox(), []);

  assert.equal(progress.requiredCount, 3);
  assert.equal(progress.missingCount, 3);
  assert.deepEqual([...progress.tickedFileIds], []);
  assert.deepEqual(progress.sessions, {
    UOB: { requiredCount: 2, missingCount: 2 },
    OCBC: { requiredCount: 1, missingCount: 1 }
  });
});

test("a queued file the intake model matched ticks its checklist line and lowers the count", () => {
  const statement = queuedStatement("uob-may", [
    { accountName: "UOB One Card", checkpointMonth: "2026-05", statementBalanceMinor: 5796 },
    { accountName: "UOB Lady's Card", checkpointMonth: "2026-05", statementBalanceMinor: 11705 }
  ]);
  assert.equal(statement.matchStatus, "matched");

  const progress = buildInboxChecklistProgress(inbox(), [statement]);

  assert.deepEqual([...progress.tickedFileIds], ["uob-cards-may"]);
  assert.equal(progress.requiredCount, 3);
  assert.equal(progress.missingCount, 2);
  assert.deepEqual(progress.sessions.UOB, { requiredCount: 2, missingCount: 1 });
  assert.deepEqual(progress.sessions.OCBC, { requiredCount: 1, missingCount: 1 });
});

test("an unmatched, ambiguous or duplicate file ticks nothing", () => {
  const unmatched = queuedStatement("hsbc-apr", [
    { accountName: "HSBC Visa Revolution", checkpointMonth: "2026-04", statementBalanceMinor: 100 }
  ]);
  const ambiguous = { ...unmatched, id: "ambiguous", matchStatus: "ambiguous", expectedFileIds: ["uob-cards-may", "uob-savings-may"] };
  const duplicate = { ...unmatched, id: "copy", duplicate: true, matchStatus: "matched", expectedFileIds: ["ocbc-360-may"] };
  assert.equal(unmatched.matchStatus, "unexpected");

  const progress = buildInboxChecklistProgress(inbox(), [unmatched, ambiguous, duplicate]);

  assert.deepEqual([...progress.tickedFileIds], []);
  assert.equal(progress.missingCount, 3);
});

test("an optional activity line can be ticked without changing the required count", () => {
  const activity = { id: "activity", duplicate: false, matchStatus: "matched", expectedFileIds: ["uob-activity-jun"] };

  const progress = buildInboxChecklistProgress(inbox(), [activity]);

  assert.deepEqual([...progress.tickedFileIds], ["uob-activity-jun"]);
  assert.equal(progress.missingCount, 3);
  assert.equal(progress.requiredCount, 3);
});

test("a missing inbox has nothing to count", () => {
  assert.deepEqual(buildInboxChecklistProgress(null, []), {
    requiredCount: 0,
    missingCount: 0,
    tickedFileIds: new Set(),
    sessions: {}
  });
});

test("the inbox is open only while nothing is queued and no file is in review", () => {
  assert.equal(isInboxOpenByDefault({ queuedCount: 0, isFileInReview: false }), true);
  assert.equal(isInboxOpenByDefault({ queuedCount: 3, isFileInReview: false }), false);
  assert.equal(isInboxOpenByDefault({ queuedCount: 0, isFileInReview: true }), false);
});

test("a fold follows its default when the default changes, and keeps the user's choice otherwise", () => {
  const start = { defaultOpen: true, open: true };
  // The user folds it; the default has not changed, so the choice stays.
  const folded = { ...start, open: false };
  assert.equal(nextFoldState(folded, true), folded);
  // Files are queued: it folds.
  assert.deepEqual(nextFoldState({ defaultOpen: true, open: true }, false), { defaultOpen: false, open: false });
  // The queue is emptied again: it opens even after the user folded it.
  assert.deepEqual(nextFoldState({ defaultOpen: false, open: false }, true), { defaultOpen: true, open: true });
});

test("a fold that only opens with its default keeps the user's open choice when the need goes away", () => {
  // Paste rows: the user opened it to type; clearing the text must not close it.
  assert.deepEqual(nextFoldState({ defaultOpen: true, open: true }, false, { followClose: false }), { defaultOpen: false, open: true });
  assert.deepEqual(nextFoldState({ defaultOpen: false, open: false }, true, { followClose: false }), { defaultOpen: true, open: true });
  // Closed by the user while not needed stays closed.
  assert.deepEqual(nextFoldState({ defaultOpen: true, open: false }, false, { followClose: false }), { defaultOpen: false, open: false });
});

test("a bank's lines group by account, keeping the download order of accounts and months", () => {
  const cdaJun = expectedFile({ id: "cda:2026-06", institution: "OCBC", accountName: "CDA", periodMonth: "2026-06" });
  const cdaJul = expectedFile({ id: "cda:2026-07", institution: "OCBC", accountName: "CDA", periodMonth: "2026-07" });
  const joyce360 = { ...expectedFile({ id: "360:2026-08", institution: "OCBC", accountName: "OCBC 360", periodMonth: "2026-08" }), ownerLabel: "Joyce" };
  const cdaAug = expectedFile({ id: "cda:2026-08", institution: "OCBC", accountName: "CDA", periodMonth: "2026-08" });
  const shared = expectedFile({
    id: "one:2026-09+lady:2026-09",
    institution: "OCBC",
    accountName: "One and Lady's",
    periodMonth: "2026-09",
    coveredAccounts: [{ accountId: "one", accountName: "One" }, { accountId: "lady", accountName: "Lady's" }]
  });

  const groups = groupInboxFilesByAccount([cdaJun, cdaJul, joyce360, cdaAug, shared]);

  assert.deepEqual(groups.map((group) => ({
    accountName: group.accountName,
    ownerLabel: group.ownerLabel,
    coveredAccountNames: group.coveredAccountNames,
    months: group.files.map((file) => file.periodMonth)
  })), [
    { accountName: "CDA", ownerLabel: "Tim", coveredAccountNames: [], months: ["2026-06", "2026-07", "2026-08"] },
    { accountName: "OCBC 360", ownerLabel: "Joyce", coveredAccountNames: [], months: ["2026-08"] },
    { accountName: "One and Lady's", ownerLabel: "Tim", coveredAccountNames: ["One", "Lady's"], months: ["2026-09"] }
  ]);
  assert.equal(groups[0].institution, "OCBC");
  assert.deepEqual(groups[0].supportedFileTypes, ["PDF"]);
});

test("the same account name with another owner or file kind is its own group", () => {
  const timStatement = expectedFile({ id: "a", accountName: "Savings", periodMonth: "2026-05" });
  const joyceStatement = { ...expectedFile({ id: "b", accountName: "Savings", periodMonth: "2026-05" }), ownerLabel: "Joyce" };
  const timActivity = expectedFile({ id: "c", accountName: "Savings", sourceType: "activity_export", priority: "optional" });

  const groups = groupInboxFilesByAccount([timStatement, joyceStatement, timActivity]);

  assert.deepEqual(groups.map((group) => group.files.map((file) => file.id)), [["a"], ["b"], ["c"]]);
  assert.deepEqual(groupInboxFilesByAccount(), []);
});

test("a bank's lines group by owner first, each owner's accounts in download order", () => {
  const owned = (id, accountName, ownerLabel, periodMonth) => ({
    ...expectedFile({ id, institution: "OCBC", accountName, periodMonth }),
    ownerLabel
  });
  const files = [
    owned("cda:06", "CDA", "Tim", "2026-06"),
    owned("360:08", "OCBC 360", "Joyce", "2026-08"),
    owned("cda:07", "CDA", "Tim", "2026-07"),
    owned("365:09", "OCBC 365", "Joyce", "2026-09"),
    owned("float:09", "Household Float", "Shared", "2026-09"),
    owned("infinity:08", "Infinity", "Tim", "2026-08")
  ];

  const owners = groupInboxFilesByOwner(files);

  assert.deepEqual(owners.map((owner) => ({
    ownerLabel: owner.ownerLabel,
    accounts: owner.accounts.map((account) => [account.accountName, account.files.map((file) => file.periodMonth)])
  })), [
    { ownerLabel: "Tim", accounts: [["CDA", ["2026-06", "2026-07"]], ["Infinity", ["2026-08"]]] },
    { ownerLabel: "Joyce", accounts: [["OCBC 360", ["2026-08"]], ["OCBC 365", ["2026-09"]]] },
    { ownerLabel: "Shared", accounts: [["Household Float", ["2026-09"]]] }
  ]);
  assert.deepEqual(groupInboxFilesByOwner(), []);
});

test("an owner group takes the person's colour from Entries, the same in every bank", async () => {
  const { getPersonColour, getPersonColourVars } = await import("../src/client/person-colour.js");
  assert.equal(getPersonColour("Tim"), "#46788E");
  assert.equal(getPersonColour("Joyce"), "#B97680");
  assert.equal(getPersonColour("Shared"), getPersonColour("shared"));
  assert.deepEqual(getPersonColourVars("Joyce"), {
    "--person-colour": "#B97680",
    "--person-chip-bg": "color-mix(in srgb, #B97680 16%, white)",
    "--person-chip-border": "color-mix(in srgb, #B97680 45%, white)",
    "--person-ink": "color-mix(in srgb, #B97680 55%, var(--text))",
    "--person-band": "color-mix(in srgb, #B97680 10%, white)",
    "--person-wash": "color-mix(in srgb, #B97680 6%, white)"
  });
  assert.notEqual(getPersonColour("Tim"), getPersonColour("Joyce"));
});
