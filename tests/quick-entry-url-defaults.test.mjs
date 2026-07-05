import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEffectiveQuickExpenseParams,
  buildQuickExpenseDraftPatch
} from "../src/client/quick-entry-url.js";

const accountOptions = [
  {
    id: "acct-card",
    value: "acct-card",
    label: "UOB One - Tim",
    accountName: "UOB One",
    ownerLabel: "Tim"
  },
  {
    id: "acct-bank",
    value: "acct-bank",
    label: "OCBC 360 - Tim",
    accountName: "OCBC 360",
    ownerLabel: "Tim"
  }
];

test("quick-entry URL merges saved default params before explicit URL params", () => {
  const params = buildEffectiveQuickExpenseParams(
    new URLSearchParams("action=add-expense&amount=12.30&merchant=Toast&category=Food%20%26%20Drinks"),
    { defaultParams: "category=Transport&owner=Tim&shared=false" }
  );

  assert.equal(params.get("category"), "Food & Drinks");
  assert.equal(params.get("owner"), "Tim");
  assert.equal(params.get("shared"), "false");
});

test("quick-entry URL uses account priority when no account is supplied", () => {
  const params = buildEffectiveQuickExpenseParams(
    new URLSearchParams("action=add-expense&amount=12.30&merchant=Toast"),
    { defaultParams: "category=Food%20%26%20Drinks&owner=Tim" }
  );

  const result = buildQuickExpenseDraftPatch({
    searchParams: params,
    accountOptions,
    categoryOptions: ["Food & Drinks", "Transport", "Other"],
    ownerOptions: ["Tim", "Bea", "Shared"],
    defaultAccountPriorityIds: ["acct-card", "acct-bank"],
    fallbackOwnerName: "Bea"
  });

  assert.equal(result.draft.accountId, "acct-card");
  assert.equal(result.draft.accountName, "UOB One");
  assert.equal(result.draft.categoryName, "Food & Drinks");
  assert.equal(result.draft.ownerName, "Tim");
  assert.equal(result.draft.amountMinor, 1230);
});

test("quick-entry URL explicit account overrides account priority", () => {
  const result = buildQuickExpenseDraftPatch({
    searchParams: new URLSearchParams("action=add-expense&amount=9.99&merchant=Train&account=OCBC%20360"),
    accountOptions,
    categoryOptions: ["Other"],
    ownerOptions: ["Tim", "Shared"],
    defaultAccountPriorityIds: ["acct-card"],
    fallbackOwnerName: "Tim"
  });

  assert.equal(result.draft.accountId, "acct-bank");
  assert.equal(result.draft.accountName, "OCBC 360");
});
