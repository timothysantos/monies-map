// The words of "If this keeps up" (src/client/copy/pace-copy.js): plain,
// never a reassurance or a promise (the pace lint), and no app jargon.
import assert from "node:assert/strict";
import test from "node:test";

import { paceCopy } from "../src/client/copy/pace-copy.js";
import { findAppJargon, findPaceProblems, findToneProblems } from "../src/domain/money-signals/tone.ts";

const lines = [
  paceCopy.label,
  paceCopy.line("$4,700", "$5,100", "2026-11-30"),
  `${paceCopy.line("$4,700", "$5,100", "2026-11-30")}, ${paceCopy.plan("$5,200", false)}.`,
  `${paceCopy.line("$5,400", "$5,800", "2026-11-30")}, ${paceCopy.plan("$5,200", true)}.`,
  paceCopy.left("$7,350", "$7,750"),
  paceCopy.workedOut,
  paceCopy.spentSoFar("$2,140.00"),
  paceCopy.everyday(20, "$2,368.00", "$2,701.60"),
  paceCopy.bills("$198.46", "$222.71"),
  paceCopy.onceOnly("$480.00"),
  paceCopy.roundedTo("$50"),
  paceCopy.comingUpTotal("$500", "$540", "2026-12-10")
];

test("every pace line passes the pace lint, the tone lint and the jargon lint", () => {
  assert.equal(paceCopy.line("$4,700", "$5,100", "2026-11-30"), "If this keeps up: about $4,700 to $5,100 by 30 Nov");
  assert.equal(paceCopy.comingUpTotal("$500", "$540", "2026-12-10"), "About $500 to $540 by 10 Dec, if they come as usual");
  for (const line of lines) {
    assert.deepEqual(findPaceProblems(line), [], line);
    assert.deepEqual(findToneProblems(line), [], line);
    assert.deepEqual(findAppJargon(line), [], line);
  }
});

test("the pace lint rejects a reassurance or a promise", () => {
  for (const bad of ["You can safely spend $300 more.", "You'll be fine this month.", "You will have $2,000 left.", "A guaranteed $500.", "The forecast is $4,700.", "A projection of $5,000.", "Safe to spend: $200."]) {
    assert.ok(findPaceProblems(bad).length > 0, bad);
  }
});

test("a range whose ends read the same is one figure, never '$20 to $20'", async () => {
  const { rangeWords } = await import("../src/domain/money-signals/format.ts");
  assert.equal(rangeWords("$20", "$20"), "$20");
  assert.equal(rangeWords("$20.00", "$20.01"), "$20.00 to $20.01");
  assert.equal(rangeWords("$20", "$35"), "$20 to $35");
  assert.equal(paceCopy.comingUpTotal("$20", "$20", "2026-12-10"), "About $20 by 10 Dec, if they come as usual");
  assert.equal(paceCopy.line("$4,700", "$4,700", "2026-11-30"), "If this keeps up: about $4,700 by 30 Nov");
  assert.equal(paceCopy.left("$7,350", "$7,350"), "About $7,350 left of what comes in.");
  assert.equal(paceCopy.everyday(1, "$12.00", "$12.00"), "Everyday spending, 1 day to go: $12.00");
  assert.equal(paceCopy.bills("$198.46", "$198.46"), "Bills still to come: $198.46");
  assert.equal(paceCopy.year("$9,000", "$9,000", 2026), "If this keeps up, about $9,000 kept in 2026 by 31 Dec.");
  assert.equal(paceCopy.comingUpTotal("$20", "$20.01", "2026-12-10"), "About $20 to $20.01 by 10 Dec, if they come as usual");
});
