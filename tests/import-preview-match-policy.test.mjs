import assert from "node:assert/strict";
import test from "node:test";

import {
  canSuppressCertifiedStatementDuplicate,
  getDuplicateCandidateMaxDayDistance
} from "../src/domain/import-preview-match-policy.js";

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
