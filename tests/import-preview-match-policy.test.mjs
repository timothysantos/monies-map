import assert from "node:assert/strict";
import test from "node:test";

import {
  canSuppressCertifiedStatementDuplicate,
  getDuplicateCandidateMaxDayDistance,
  isRowBeforeLateUnpostedEntry
} from "../src/domain/import-preview-match-policy.js";

// A $1.99 ride recorded on the statement's closing day, not yet posted: it
// may post on the next statement, so it never answers an earlier ride's row.
const lateRide = { amountMinor: 199, entryDate: "2026-05-12", entryPostDate: null, statementEndDate: "2026-05-12" };

test("a low-value unposted entry from the last two days of a statement never answers an earlier row", () => {
  assert.equal(isRowBeforeLateUnpostedEntry({ ...lateRide, rowPurchaseDate: "2026-05-11" }), true);
  assert.equal(isRowBeforeLateUnpostedEntry({ ...lateRide, entryDate: "2026-05-11", rowPurchaseDate: "2026-05-10" }), true);
});

test("the late-entry guard leaves every other pairing to the usual rules", () => {
  // Its own day, or a later one.
  assert.equal(isRowBeforeLateUnpostedEntry({ ...lateRide, rowPurchaseDate: "2026-05-12" }), false);
  // Earlier in the period: a ride typed a day late still meets its row.
  assert.equal(isRowBeforeLateUnpostedEntry({ ...lateRide, entryDate: "2026-05-10", rowPurchaseDate: "2026-05-09" }), false);
  // Already posted by a bank file: it is on this statement.
  assert.equal(isRowBeforeLateUnpostedEntry({ ...lateRide, entryPostDate: "2026-05-12", rowPurchaseDate: "2026-05-11" }), false);
  // $5 and over keeps the wider window for delayed posting.
  assert.equal(isRowBeforeLateUnpostedEntry({ ...lateRide, amountMinor: 500, rowPurchaseDate: "2026-05-11" }), false);
  // No statement period known.
  assert.equal(isRowBeforeLateUnpostedEntry({ ...lateRide, statementEndDate: undefined, rowPurchaseDate: "2026-05-11" }), false);
});

test("certified statement duplicate suppression allows Citi activity posted two days earlier", () => {
  assert.equal(
    canSuppressCertifiedStatementDuplicate({
      candidateSourceType: "pdf",
      candidateBankCertificationStatus: "statement_certified",
      incomingSourceType: "csv",
      dayDistance: 2,
      amountMinor: 17350
    }),
    true
  );
});

test("certified statement duplicate suppression keeps the low-value velocity window tight", () => {
  assert.equal(getDuplicateCandidateMaxDayDistance(499), 2);
  assert.equal(getDuplicateCandidateMaxDayDistance(500), 7);
  assert.equal(
    canSuppressCertifiedStatementDuplicate({
      candidateSourceType: "pdf",
      candidateBankCertificationStatus: "statement_certified",
      incomingSourceType: "csv",
      dayDistance: 3,
      amountMinor: 499
    }),
    false
  );
});

test("certified statement duplicate suppression does not apply to PDF reimports", () => {
  assert.equal(
    canSuppressCertifiedStatementDuplicate({
      candidateSourceType: "pdf",
      candidateBankCertificationStatus: "statement_certified",
      incomingSourceType: "pdf",
      dayDistance: 2,
      amountMinor: 17350
    }),
    false
  );
});
