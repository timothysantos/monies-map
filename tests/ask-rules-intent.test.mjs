// Messages that are never a new entry (src/domain/ask-rules-intent.ts):
// a payment back, settle up, a balance, a delete, an import, a page. The
// rules' entry reader must never draft them as spending, and ordinary
// entries that merely contain those words still draft.
import assert from "node:assert/strict";
import test from "node:test";

import { readCommandIntent } from "../src/domain/ask-rules-intent.ts";

test("a payment back between the two people is never an entry", () => {
  for (const text of [
    "Serene paid me back $50",
    "serene paid me back 50",
    "I paid Joyce back $20.",
    "paid back joyce 15",
    "Joyce repaid me $30",
    "joyce reimbursed me 12",
    "Joyce gave me $40 back",
    "please, Serene paid me back"
  ]) {
    assert.deepEqual(readCommandIntent(text), { kind: "paid_back", text: text.replace(/[.!]+$/, "") }, text);
  }
});

test("settle up, with or without a group", () => {
  assert.deepEqual(readCommandIntent("settle up with Serene"), { kind: "settle_up", rest: "serene" });
  assert.deepEqual(readCommandIntent("Settle up Japan trip"), { kind: "settle_up", rest: "japan trip" });
  assert.deepEqual(readCommandIntent("let's settle up"), { kind: "settle_up", rest: "" });
  assert.deepEqual(readCommandIntent("I owe Serene $20"), { kind: "owes" });
  assert.deepEqual(readCommandIntent("serene owes me 15"), { kind: "owes" });
  assert.equal(readCommandIntent("dinner at nobu 120, I paid, Joyce owes 70%, home group"), null);
});

test("delete, import, undo, reconcile, accounts and people are the blocked note", () => {
  const cases = {
    "delete the Koufu lunch": "delete_entry",
    "remove my last entry": "delete_entry",
    "delete it": "delete_entry",
    "please delete yesterday's grab": "delete_entry",
    "delete the October import": "delete_import",
    "delete this month": "delete_month",
    "import my statement": "import_statement",
    "upload the dbs csv": "import_statement",
    "undo the last import": "undo_import",
    "reconcile citi": "reconcile",
    "add a new account": "accounts",
    "close my credit card": "accounts",
    "add a person": "people"
  };
  for (const [text, blocked] of Object.entries(cases)) {
    assert.deepEqual(readCommandIntent(text), { kind: "blocked", blocked }, text);
  }
});

test("open a page", () => {
  assert.deepEqual(readCommandIntent("open plan"), { kind: "open_page", page: "month" });
  assert.deepEqual(readCommandIntent("Open Splits"), { kind: "open_page", page: "splits" });
  assert.deepEqual(readCommandIntent("go to the entries page"), { kind: "open_page", page: "entries" });
  assert.deepEqual(readCommandIntent("show me settings"), { kind: "open_page", page: "settings" });
});

test("negative: ordinary entries, questions and searches are not commands", () => {
  for (const text of [
    "paid $50 for dinner",
    "Serene paid $30 for dinner",
    "open-faced sandwich $8",
    "Delete Bistro $12",
    "Import Store Lunch 14.50",
    "lunch at Undelete cafe $9",
    "koufu lunch 12.50 on citi",
    "refund from zara $20",
    "who owes who?",
    "what do I owe Serene",
    "how much did I pay back last month?",
    "show me grab rides in september",
    "open house snacks $6",
    "dinner $80 split with Serene",
    "Joyce owes me 1.60 on splits",
    ""
  ]) {
    assert.equal(readCommandIntent(text), null, text);
  }
});
