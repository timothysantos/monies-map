// What the Create account dialog is filled in with for an account a statement
// names that the app does not know: its kind and institution come from the
// parser that read the file, then from the account's name.
import assert from "node:assert/strict";
import test from "node:test";

import { inferStatementAccountKind, inferStatementInstitution } from "../src/client/statement-account-hints.js";

test("a StashAway statement is an investment account at StashAway, whatever its owner's name says", () => {
  assert.equal(inferStatementAccountKind("Alex Sample Holder StashAway", "stashaway_pdf"), "investment");
  assert.equal(inferStatementInstitution("Alex Sample Holder StashAway", "stashaway_pdf"), "StashAway");
  // A name that happens to contain a bank or card word does not turn it into one.
  assert.equal(inferStatementAccountKind("Miles Citizen StashAway", "stashaway_pdf"), "investment");
  assert.equal(inferStatementInstitution("Miles Citizen StashAway", "stashaway_pdf"), "StashAway");
});

test("an iFAST statement is still an investment account at iFAST", () => {
  assert.equal(inferStatementAccountKind("Alex iFAST", "ifast_wrap_pdf"), "investment");
  assert.equal(inferStatementInstitution("Alex iFAST", "ifast_wrap_pdf"), "iFAST");
});

test("bank and card statements keep their kinds and institutions", () => {
  assert.equal(inferStatementAccountKind("OCBC 365", "ocbc_365_card_pdf"), "credit_card");
  assert.equal(inferStatementAccountKind("OCBC 360", "ocbc_360_pdf"), "bank");
  assert.equal(inferStatementInstitution("OCBC 360", "ocbc_360_pdf"), "OCBC");
  assert.equal(inferStatementInstitution("Citi Rewards", "citibank_card_pdf"), "Citibank");
  assert.equal(inferStatementInstitution("UOB One", "uob_savings_pdf"), "UOB");
  assert.equal(inferStatementInstitution("Something else", "unknown_pdf"), "");
});
