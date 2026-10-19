// The Ask entry card's chips while it saves (cb1cbc85 / 459ddc25 left the
// wallet chip tappable in every state, so a tap mid-save opened the draft
// wallet picker and could change the card being saved). A draft's chips
// edit it and a saved card's wallet chip opens the saved wallet picker; a
// saving card's chips are plain text.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;

const { MoneyPrivacyProvider } = await import("../src/client/money-privacy.jsx");
const { AskEntryCard } = await import("../src/client/ask-entry-card.jsx");

const h = React.createElement;

const context = {
  people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
  accounts: [{ id: "acc-uob", name: "UOB One", currency: "SGD" }],
  categories: [{ name: "Groceries", colorHex: "#88aa77", iconKey: "shopping-cart" }]
};

function card(status) {
  return {
    status,
    variant: "expense",
    origin: "message",
    clientId: "card-1",
    fields: {
      description: "Kopi and kaya toast",
      amountMinor: 2550,
      amountInput: "25.50",
      date: "2026-05-24",
      accountId: "acc-uob",
      accountName: "UOB One",
      ownerName: "Tim",
      categoryName: "Groceries"
    },
    share: { on: false },
    saved: status === "saved" ? { entryId: "txn-1", bankCertificationStatus: "manual_provisional" } : undefined
  };
}

function render(status) {
  globalThis.window = { localStorage: { getItem: () => "true", setItem() {} }, matchMedia: () => ({ matches: false }) };
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    return renderToStaticMarkup(h(MoneyPrivacyProvider, null, h(AskEntryCard, {
      card: card(status),
      context,
      today: "2026-05-24",
      onChange() {},
      onOpenField() {}
    })));
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

const walletButton = /<button[^>]*aria-label="Change wallet, UOB One"/;
const ownerButton = /<button[^>]*aria-label="Change owner, Tim"/;

test("a draft card's wallet and owner chips open their pickers", () => {
  const html = render("draft");
  assert.match(html, walletButton);
  assert.match(html, ownerButton);
});

test("a saved card's wallet chip opens the saved wallet picker; its owner is fixed", () => {
  const html = render("saved");
  assert.match(html, walletButton);
  assert.doesNotMatch(html, ownerButton);
});

test("negative: while the card saves, no chip can be tapped and no picker can open", () => {
  const html = render("saving");
  assert.doesNotMatch(html, walletButton);
  assert.doesNotMatch(html, ownerButton);
  assert.doesNotMatch(html, /class="lsd-chip-hit/);
  assert.doesNotMatch(html, /is-tappable/);
  // The chips still say what the card holds.
  assert.match(html, /UOB One/);
  assert.match(html, />Tim</);
});
