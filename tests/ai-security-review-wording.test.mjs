// Security review 2026-10 (docs/audits/ai-security-review-2026-10.md),
// findings F2 and F3: what the optional AI is shown, and what of its answer
// is allowed back on screen.
import assert from "node:assert/strict";
import test from "node:test";

import { buildPromptFacts, validateAiWording } from "../src/domain/ask-answer-wording.ts";

const promptFacts = [
  "Spent in March: $10,391.23",
  "Expense Courts Megastore Tampines on 11 Mar: $3,280.00 (Home)",
  "Category Home: $5,650.00, 54% of spending",
  "Spent in February: $4,706.62"
];
const knownNames = ["Home", "Loans"];
const check = (text) => validateAiWording(text, { promptFacts, knownNames });

// F3: the numbers check compared bare numbers, so a made-up amount that
// equals a day of the month or a percentage in the facts ("11 Mar", "54%")
// passed as if it were one of the facts' amounts.
test("F3: a dollar amount must be an amount in the facts, not a day or a percentage that shares its digits", () => {
  assert.equal(check("March came to $11.00 in total."), null);
  assert.equal(check("Home took $54 of it."), null);
  assert.equal(check("March came to 11 dollars in total."), null);
  assert.equal(check("March came to 54 bucks."), null);
  // The facts' own amounts, and its day and share numbers as plain numbers, still pass.
  assert.equal(check("March came to $10,391.23 and Home took 54% of it."), "March came to $10,391.23 and Home took 54% of it.");
  assert.equal(check("On 11 Mar the biggest cost was $3,280.00."), "On 11 Mar the biggest cost was $3,280.00.");
  assert.equal(check("You spent $3,280 on 11 Mar."), "You spent $3,280 on 11 Mar.");
});

// F3: an amount written in words has no digits to compare.
test("F3: an amount written in words is rejected", () => {
  for (const text of [
    "March came to about ten thousand dollars.",
    "Home took around five thousand six hundred.",
    "That is roughly a million in total.",
    "Spending was thirty percent higher than February.",
    "About a hundred more than February."
  ]) {
    assert.equal(check(text), null, text);
  }
  // Small counting words stay allowed.
  const small = "Your two biggest costs were Courts Megastore Tampines and Home.";
  assert.equal(check(small), small);
});

// F2: a PayNow or transfer description with no tidy shop name used to go
// to the prompt as typed, including a phone number, an account number or an
// NRIC / FIN fragment (AGENTS.md: no full account or card numbers to AI).
test("F2: the facts sent to AI carry no phone, account or ID number from an entry description", () => {
  const month = {
    month: "2026-05", viewId: "household", scope: "direct_plus_shared",
    spentMinor: 100000, plannedMinor: 0, incomeMinor: 0, plannedIncomeMinor: 0, entryCount: 3, expenseCount: 3,
    categories: [], allCategories: [], planRows: [], incomeSources: [],
    biggest: [
      { id: "a", description: "PAYNOW TRANSFER 91234567 JOHN TAN", date: "2026-05-02", categoryName: "Other", amountMinor: 50000 },
      { id: "b", description: "FAST PAYMENT to 0123456789012 S1234567A", date: "2026-05-03", categoryName: "Other", amountMinor: 30000 },
      { id: "c", description: "Transfer to 123-456-789-0 savings", date: "2026-05-04", categoryName: "Other", amountMinor: 20000 }
    ]
  };
  const lines = buildPromptFacts({ kind: "biggest", current: month }, { today: "2026-05-20" });
  const text = lines.join("\n");
  assert.doesNotMatch(text, /\d{6,}/);
  assert.doesNotMatch(text, /\d{3}-\d{3}-\d{3}/);
  assert.doesNotMatch(text, /S1234567A/i);
  // The readable words of the description and the amounts are kept.
  assert.match(text, /Expense .*John Tan.* on 2 May: \$500\.00 \(Other\)/);
  assert.match(text, /\$300\.00/);
  assert.match(text, /\$200\.00/);
});
