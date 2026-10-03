import assert from "node:assert/strict";
import test from "node:test";

import { selectShortcutAccount } from "../src/domain/app-repository-shortcuts.ts";

const accounts = [
  account("lady", "UOB Lady's Card", "UOB", true),
  account("miles", "Citi Miles", "Citibank", true),
  account("old", "Old card", "UOB", false),
  account("rewards", "Citi Rewards", "Citibank", true)
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

// An Amaze card abroad: Wallet shows IDR and no card the app knows, so the
// purchase goes to the card chosen for other currencies (Citi Rewards,
// which Amaze charges), not the first priority card.
test("a purchase in another currency goes to the card chosen for other currencies", () => {
  const amaze = { walletName: "Bali Racquet Society", amountCurrency: "IDR" };
  assert.deepEqual(selectShortcutAccount(accounts, ["lady", "miles"], amaze, { foreignCurrencyAccountId: "rewards" }), {
    account: { id: "rewards", name: "Citi Rewards", currency: "SGD", resolution: "foreign_currency" }
  });
});

test("the card for other currencies never overrides a named card, a Wallet card match or a same-currency purchase", () => {
  const options = { foreignCurrencyAccountId: "rewards" };
  // A card the Shortcut names, or Wallet's own card name, wins.
  assert.equal(selectShortcutAccount(accounts, ["lady"], { accountName: "Citi Miles", amountCurrency: "IDR" }, options).account?.id, "miles");
  assert.equal(selectShortcutAccount(accounts, ["lady"], { walletName: "UOB LADYS CARD", amountCurrency: "IDR" }, options).account?.id, "lady");
  // A purchase in the priority card's own currency, or with no currency.
  assert.equal(selectShortcutAccount(accounts, ["lady"], { walletName: "Kopitiam", amountCurrency: "SGD" }, options).account?.resolution, "priority");
  assert.equal(selectShortcutAccount(accounts, ["lady"], { walletName: "Kopitiam" }, options).account?.resolution, "priority");
  // Not set, or set to a card that is no longer active.
  assert.equal(selectShortcutAccount(accounts, ["lady"], { walletName: "Bali Racquet Society", amountCurrency: "IDR" }).account?.id, "lady");
  assert.equal(selectShortcutAccount(accounts, ["lady"], { walletName: "Bali Racquet Society", amountCurrency: "IDR" }, { foreignCurrencyAccountId: "old" }).account?.id, "lady");
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
