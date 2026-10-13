import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_MESSAGE_MAX,
  ENTRY_DESCRIPTION_MAX,
  ENTRY_NOTE_MAX,
  RECEIPT_IMAGE_MAX_BYTES,
  STATEMENT_TEXT_MAX_BYTES,
  askMessageLength,
  entryTextOverLimit,
  fitStatementText,
  jsonBodyBytes,
  limitState,
  receiptSizePlan
} from "../src/client/input-limits.js";
import { createEntryFromDraft } from "../src/client/entry-create-request.js";
import { ASK_TURN_MAX_TEXT } from "../src/domain/ask-turn.ts";
import { ASK_ANSWER_MAX_TEXT } from "../src/server/ask-answer-route.ts";
import { PLAN_REQUEST_MAX_TEXT } from "../src/domain/plan-draft-reader.ts";
import { RECEIPT_IMAGE_MAX_BYTES as SERVER_RECEIPT_MAX } from "../src/server/receipt-read-route.ts";
import { SHORTCUT_DESCRIPTION_MAX_LENGTH, SHORTCUT_NOTE_MAX_LENGTH } from "../src/domain/shortcut-entry-contract.ts";

test("the page's caps are the ones the Worker enforces", () => {
  assert.equal(ASK_MESSAGE_MAX, 300);
  assert.equal(ASK_MESSAGE_MAX, ASK_TURN_MAX_TEXT);
  assert.equal(ASK_MESSAGE_MAX, ASK_ANSWER_MAX_TEXT);
  assert.equal(ASK_MESSAGE_MAX, PLAN_REQUEST_MAX_TEXT);
  assert.equal(RECEIPT_IMAGE_MAX_BYTES, SERVER_RECEIPT_MAX);
  assert.equal(RECEIPT_IMAGE_MAX_BYTES, 1_572_864);
  assert.equal(ENTRY_DESCRIPTION_MAX, SHORTCUT_DESCRIPTION_MAX_LENGTH);
  assert.equal(ENTRY_NOTE_MAX, SHORTCUT_NOTE_MAX_LENGTH);
});

test("a counter shows from 80% of a cap, and over the cap is refused", () => {
  assert.deepEqual(limitState(239, 300), { size: 239, max: 300, near: false, over: false });
  assert.deepEqual(limitState(240, 300), { size: 240, max: 300, near: true, over: false });
  assert.deepEqual(limitState(300, 300), { size: 300, max: 300, near: true, over: false });
  assert.deepEqual(limitState(301, 300), { size: 301, max: 300, near: true, over: true });
  assert.deepEqual(limitState(0, 300), { size: 0, max: 300, near: false, over: false });
});

test("an Ask message is measured as the Worker measures it: spaces collapsed, ends trimmed", () => {
  assert.equal(askMessageLength("  lunch   $12\n\n at   Toast Box  "), "lunch $12 at Toast Box".length);
  assert.equal(askMessageLength(""), 0);
  assert.equal(askMessageLength(undefined), 0);
});

test("entry text over its cap names the field; at the cap it is fine", () => {
  assert.equal(entryTextOverLimit({ description: "a".repeat(500), note: "b".repeat(2000) }), "");
  assert.equal(entryTextOverLimit({ description: "a".repeat(501), note: "" }), "description");
  assert.equal(entryTextOverLimit({ description: "Lunch", note: "b".repeat(2001) }), "note");
  assert.equal(entryTextOverLimit({ description: "Lunch", note: null }), "");
});

const draft = {
  date: "2026-10-12",
  description: "Lunch",
  accountId: "acct-1",
  accountName: "UOB One",
  categoryName: "Food & Drinks",
  amountMinor: 1200,
  entryType: "expense",
  ownershipType: "direct",
  ownerName: "Tim",
  note: ""
};

test("an entry with an over-long note is refused before anything is sent", async () => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify({ ok: true, entryId: "e1" }), { status: 200 });
  };
  const refused = await createEntryFromDraft({ ...draft, note: "n".repeat(2001) }, { fetchImpl });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "This note is too long to save. Keep it to 2,000 characters or fewer.");
  assert.equal(calls.length, 0);

  const refusedDescription = await createEntryFromDraft({ ...draft, description: "d".repeat(501) }, { fetchImpl });
  assert.equal(refusedDescription.error, "This description is too long to save. Keep it to 500 characters or fewer.");
  assert.equal(calls.length, 0);

  const saved = await createEntryFromDraft({ ...draft, note: "n".repeat(2000) }, { fetchImpl });
  assert.equal(saved.ok, true);
  assert.equal(calls.length, 1);
});

test("request bodies are measured in UTF-8 bytes", () => {
  assert.equal(jsonBodyBytes({ text: "ab" }), '{"text":"ab"}'.length);
  assert.equal(jsonBodyBytes({ text: "é" }), '{"text":""}'.length + 2);
});

test("statement text past the fallback's cap is cut to fit; short text is sent whole", () => {
  const short = fitStatementText("s.pdf", "01 Oct GRAB 12.30\n");
  assert.deepEqual(short, { text: "01 Oct GRAB 12.30\n", trimmed: false });

  const long = "02 Oct NTUC FAIRPRICE 45.10 \"quoted\"\n".repeat(4000);
  const fitted = fitStatementText("s.pdf", long);
  assert.equal(fitted.trimmed, true);
  assert.ok(long.startsWith(fitted.text));
  assert.ok(jsonBodyBytes({ fileName: "s.pdf", text: fitted.text }) <= STATEMENT_TEXT_MAX_BYTES);
  // Far more than the 12,000 characters the reader looks at.
  assert.ok(fitted.text.length > 12_000);
});

test("a receipt photo: large ones are noted, and one still too big once made smaller is not sent", () => {
  const max = RECEIPT_IMAGE_MAX_BYTES;
  assert.deepEqual(receiptSizePlan(200_000, 150_000), { large: false, tooBig: false });
  // From 80% of the cap the person is told it is made smaller.
  assert.deepEqual(receiptSizePlan(Math.ceil(max * 0.8), 400_000), { large: true, tooBig: false });
  assert.deepEqual(receiptSizePlan(8_000_000, 600_000), { large: true, tooBig: false });
  // Made smaller and still past the cap: read on the device instead.
  assert.deepEqual(receiptSizePlan(9_000_000, max + 1), { large: true, tooBig: true });
  assert.deepEqual(receiptSizePlan(9_000_000, max), { large: true, tooBig: false });
});
