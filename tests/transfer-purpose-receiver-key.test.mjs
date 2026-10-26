// Transfer purpose learning by receiver (owner decision, 2026-10-26;
// DOMAIN.md "Transfer Purpose", "Learning"). A repeat transfer is the same
// sending account, the same receiving person (and receiving account when
// both sides know it), the same amount to the cent and the same currency
// within 100 days. The bank's wording is ignored: Tim's monthly $450 was
// "Funds Transfer JOYCE" in September and "Funds Transfer HDB mortgage JO"
// in October. Without a known receiver the old description rule decides.
import assert from "node:assert/strict";
import test from "node:test";

import { rememberedTransferPurpose } from "../src/domain/app-repository-transfer-purpose.ts";

const JOYCE = "person-joyce";
const ETHAN = "person-ethan";

const SEP = {
  id: "sep", accountId: "acct-a", amountMinor: 45000, currency: "SGD", date: "2026-09-01",
  description: "Funds Transfer JOYCE", purposeCategoryId: "cat-home", purposePersonId: JOYCE,
  receiverPersonId: JOYCE, receiverAccountId: "acct-joyce", clearedByHand: false
};
const OCT = {
  id: "oct", accountId: "acct-a", amountMinor: 45000, currency: "SGD", date: "2026-10-01",
  description: "Funds Transfer HDB mortgage JO", receiverPersonId: JOYCE, receiverAccountId: "acct-joyce"
};

test("a changed bank description still matches the same account, receiver, amount and currency", () => {
  assert.deepEqual(rememberedTransferPurpose(OCT, [SEP]), { categoryId: "cat-home", personId: JOYCE, fromEntryId: "sep" });
  // Receiving account known on one side only: still the same person.
  assert.equal(rememberedTransferPurpose({ ...OCT, receiverAccountId: null }, [SEP])?.fromEntryId, "sep");
  assert.equal(rememberedTransferPurpose(OCT, [{ ...SEP, receiverAccountId: null }])?.fromEntryId, "sep");
});

test("another amount, receiver, receiving account, sending account, currency or more than 100 days back never carries over", () => {
  assert.equal(rememberedTransferPurpose({ ...OCT, amountMinor: 45001 }, [SEP]), null);
  assert.equal(rememberedTransferPurpose({ ...OCT, receiverPersonId: ETHAN }, [SEP]), null);
  assert.equal(rememberedTransferPurpose({ ...OCT, receiverAccountId: "acct-joyce-2" }, [SEP]), null);
  assert.equal(rememberedTransferPurpose({ ...OCT, accountId: "acct-c" }, [SEP]), null);
  assert.equal(rememberedTransferPurpose({ ...OCT, currency: "USD" }, [SEP]), null);
  assert.equal(rememberedTransferPurpose({ ...OCT, date: "2027-01-15" }, [SEP]), null);
  // A known receiver is never matched through the description alone.
  assert.equal(rememberedTransferPurpose({ ...OCT, description: SEP.description, receiverPersonId: ETHAN }, [SEP]), null);
});

test("foreign currency repeats match on the same currency and amount", () => {
  const usd = { ...SEP, currency: "USD", amountMinor: 30000 };
  assert.equal(rememberedTransferPurpose({ ...OCT, currency: "USD", amountMinor: 30000 }, [usd])?.fromEntryId, "sep");
  assert.equal(rememberedTransferPurpose({ ...OCT, currency: "SGD", amountMinor: 30000 }, [usd]), null);
});

test("when earlier purposes disagree the newest decides", () => {
  const aug = { ...SEP, id: "aug", date: "2026-08-01", purposeCategoryId: "cat-groceries" };
  assert.equal(rememberedTransferPurpose(OCT, [aug, SEP])?.categoryId, "cat-home");
  const newerGroceries = { ...SEP, id: "sep2", date: "2026-09-20", purposeCategoryId: "cat-groceries" };
  assert.deepEqual(rememberedTransferPurpose(OCT, [SEP, newerGroceries]), { categoryId: "cat-groceries", personId: JOYCE, fromEntryId: "sep2" });
});

test("a transfer cleared by hand stops the chain; one that was merely never tagged does not", () => {
  const clearedLater = { ...SEP, id: "sep-cleared", date: "2026-09-20", purposeCategoryId: null, purposePersonId: null, clearedByHand: true };
  assert.equal(rememberedTransferPurpose(OCT, [SEP, clearedLater]), null);
  // Cleared before the tagged one: the tagged one is newer and wins.
  assert.equal(rememberedTransferPurpose(OCT, [SEP, { ...clearedLater, date: "2026-08-20" }])?.fromEntryId, "sep");
  // Never tagged (missed): skipped, the chain continues.
  assert.equal(rememberedTransferPurpose(OCT, [SEP, { ...clearedLater, id: "missed", clearedByHand: false }])?.fromEntryId, "sep");
  // A cleared one for another receiver is not this chain.
  assert.equal(rememberedTransferPurpose(OCT, [SEP, { ...clearedLater, receiverPersonId: ETHAN }])?.fromEntryId, "sep");
});

test("without a known receiver the old description rule still decides", () => {
  const unknown = { ...OCT, receiverPersonId: null, receiverAccountId: null };
  assert.equal(rememberedTransferPurpose(unknown, [SEP]), null);
  assert.deepEqual(rememberedTransferPurpose({ ...unknown, description: "Funds Transfer JOYCE" }, [SEP]), { categoryId: "cat-home", personId: JOYCE, fromEntryId: "sep" });
});
