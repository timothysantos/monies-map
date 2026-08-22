import assert from "node:assert/strict";
import test from "node:test";

import { selectShortcutAccount } from "../src/domain/app-repository-shortcuts.ts";

const accounts = [
  account("lady", "UOB Lady's Card", "UOB", true),
  account("miles", "Citi Miles", "Citibank", true),
  account("old", "Old card", "UOB", false)
];

test("Wallet card name selects the matching active account before priority fallback", () => {
  assert.deepEqual(
    selectShortcutAccount(accounts, ["lady", "miles"], { walletName: "UOB LADYS CARD" }),
    {
      account: {
        id: "lady",
        name: "UOB Lady's Card",
        currency: "SGD",
        resolution: "wallet_name"
      }
    }
  );
});

test("unmatched Wallet names use the first configured active priority account", () => {
  assert.equal(
    selectShortcutAccount(accounts, ["miles", "lady"], { walletName: "Merchant transaction" }).account?.id,
    "miles"
  );
  assert.equal(
    selectShortcutAccount(accounts, ["miles", "lady"], { walletName: "Merchant transaction" }).account?.resolution,
    "priority"
  );
});

test("an explicit unknown or inactive account is rejected instead of silently falling back", () => {
  assert.deepEqual(selectShortcutAccount(accounts, ["lady"], { accountName: "Missing card" }), {
    account: null,
    error: "Unknown or inactive account: Missing card"
  });
  assert.deepEqual(selectShortcutAccount(accounts, ["lady"], { accountId: "old" }), {
    account: null,
    error: "Unknown or inactive account: old"
  });
});

function account(id, name, institution, isActive) {
  return {
    id,
    institutionId: institution.toLowerCase(),
    name,
    institution,
    kind: "credit_card",
    ownerLabel: "Tim",
    currency: "SGD",
    isJoint: false,
    isActive
  };
}
