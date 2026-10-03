import assert from "node:assert/strict";
import test from "node:test";

import {
  canSuppressCertifiedStatementDuplicate,
  getDuplicateCandidateMaxDayDistance,
  isRowBeforeLateUnpostedEntry
} from "../src/domain/import-preview-match-policy.js";

// A $1.99 commute ride recorded on the statement's closing day, not yet
// posted: it may post on the next statement, so it never answers an earlier
// ride's row.
const lateRide = { repeats: true, entryDate: "2026-05-12", entryPostDate: null, statementEndDate: "2026-05-12" };

test("a repeating unposted entry from the last two days of a statement never answers an earlier row", () => {
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
  // A one-off charge: the day before is most likely the same purchase.
  assert.equal(isRowBeforeLateUnpostedEntry({ ...lateRide, repeats: false, rowPurchaseDate: "2026-05-11" }), false);
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
      repeats: false
    }),
    true
  );
});

test("the velocity rule gives repeated charges two days and one-off charges seven, whatever the amount", () => {
  assert.equal(getDuplicateCandidateMaxDayDistance({ repeats: true }), 2);
  assert.equal(getDuplicateCandidateMaxDayDistance({ repeats: false }), 7);
  const suppress = (repeats) => canSuppressCertifiedStatementDuplicate({
    candidateSourceType: "pdf",
    candidateBankCertificationStatus: "statement_certified",
    incomingSourceType: "csv",
    dayDistance: 3,
    repeats
  });
  assert.equal(suppress(true), false);
  assert.equal(suppress(false), true);
});

test("certified statement duplicate suppression does not apply to PDF reimports", () => {
  assert.equal(
    canSuppressCertifiedStatementDuplicate({
      candidateSourceType: "pdf",
      candidateBankCertificationStatus: "statement_certified",
      incomingSourceType: "pdf",
      dayDistance: 2,
      repeats: false
    }),
    false
  );
});
