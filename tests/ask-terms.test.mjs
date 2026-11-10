// Words used (src/domain/ask-terms.ts) and Ask's "what's an annual fee?"
// (the `term` answer): fixed plain explanations, found by their name or the
// words that mean them, and this year's figure from the entries. No AI.
import assert from "node:assert/strict";
import test from "node:test";

import { ASK_TERMS, findAskTerm, readTermQuestion } from "../src/domain/ask-terms.ts";
import { readAnswerIntent } from "../src/domain/ask-answer-intent.ts";
import { findAppJargon, findToneProblems } from "../src/domain/money-signals/tone.ts";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

test("each term is found by its name and the words that mean it; a shop name is not a term", () => {
  const cases = [
    ["what's an FX fee", "fx_fee"],
    ["what is a currency conversion fee?", "fx_fee"],
    ["what does DCC mean", "fx_fee"],
    ["what's an annual fee?", "annual_fee"],
    ["what is a membership fee", "annual_fee"],
    ["what's a finance charge", "interest"],
    ["what is interest", "interest"],
    ["what's a late charge?", "late_fee"],
    ["what is a fall-below fee", "fall_below_fee"],
    ["what's S&CC?", "scc"]
  ];
  for (const [text, key] of cases) {
    assert.equal(readTermQuestion(text)?.key, key, text);
  }
  assert.equal(readTermQuestion("is grab more than usual?"), null, "not a what-is question");
  assert.equal(readTermQuestion("what's usual?"), null, "usual is explained beside its answer");
  assert.equal(readTermQuestion("what's Amaze*Fees"), null);
  assert.equal(findAskTerm("pay the annual fee")?.key, "annual_fee");
  for (const term of ASK_TERMS) {
    assert.deepEqual(findToneProblems(term.text), [], term.key);
    assert.deepEqual(findAppJargon(term.text), [], term.key);
  }
});

test("the rules reader reads a term question before any fee or interest word", () => {
  const context = { today: "2026-11-10", month: "2026-11", people: [], vocabulary: ["Fees"] };
  assert.deepEqual(readAnswerIntent("what's an FX fee?", context), { kind: "term", term: "fx_fee", month: "2026-11" });
  assert.deepEqual(readAnswerIntent("What is FX fee?", context), { kind: "term", term: "fx_fee", month: "2026-11" });
  assert.equal(readAnswerIntent("what's the weather?", context), null);
});

test("the answer route explains the term and says this year's figure; reading changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const year = new Date().getFullYear();
  await createEntry(api, { date: `${year}-03-02`, description: "ANNUAL MEMBERSHIP FEE", accountName: "Citi Rewards", categoryName: "Fees", amountMinor: 19_620, ownerName: "Joyce" });
  await createEntry(api, { date: `${year}-03-09`, description: "ANNUALMEMBERFEEREV", accountName: "Citi Rewards", categoryName: "Fees", entryType: "income", amountMinor: 19_620, ownerName: "Joyce" });
  const before = await dumpDatabase(db);
  const { status, payload } = await api("/api/ai-assist/answer", { text: "what's an annual fee?", viewId: "household" });
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.intent, "term");
  assert.equal(payload.answer.title, "Annual fee");
  assert.equal(payload.answer.lead.amountMinor, 0);
  assert.deepEqual(payload.answer.support, [{ label: "Refunded", amountMinor: 19_620, currency: "SGD" }]);
  assert.equal(payload.wording.text, "An annual fee is what some cards charge once a year, just for having the card. Banks often refund it when asked, usually soon after it's charged. This year: none so far. Another $196.20 was charged and then refunded.");
  assert.equal(payload.ai.requested, false, "fixed words: nothing for AI to phrase");
  const scc = await api("/api/ai-assist/answer", { text: "what is S&CC", viewId: "household" });
  assert.match(scc.payload.wording.text, /^Service and conservancy charges: the monthly payment to the town council/);
  assertSameDatabase(await dumpDatabase(db), before);
});
