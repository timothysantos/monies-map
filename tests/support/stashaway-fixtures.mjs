// StashAway statement text for the import, e2e and atomicity tests: the
// sanitized real fixtures, and September with one inferred deposit row added
// (no real statement has a deposit yet, see tests/stashaway-statement-parser.test.mjs).
import { readFileSync } from "node:fs";

import { parseStatementText } from "../../src/lib/statement-import.ts";

const MARKER = "__PDF_LAYOUT_TEXT__";

export function readStashawayFixture(month) {
  return readFileSync(new URL(`../fixtures/pdf-statement-text/stashaway-${month}-2026-real-sanitized.pdf-text.txt`, import.meta.url), "utf8");
}

export function parseStashaway(month) {
  return parseStatementText(readStashawayFixture(month), `stashaway-${month}-2026-real.pdf`);
}

// September with a $500.00 deposit on 2 September: the cashflow, the closing
// balance and the transactions page all move together.
export function septemberWithDepositText() {
  const text = readStashawayFixture("sep");
  const raw = text.split(MARKER)[0]
    .replace(/(\$15,706\.59\n \n)(\$0\.00|-)(\n \n-\$337\.62\n \n-\$11\.26\n \n)\$15,357\.71/g, (match, before, cashflow, after) => `${before}$500.00${after}$15,857.71`)
    .replace("04\n \nSep 2026\n \nCurrency Conversion to SGD", "02\n \nSep 2026\n \nDeposit\n \n-\n \n$500.00\n\n04\n \nSep 2026\n \nCurrency Conversion to SGD");
  return `${raw}${MARKER}${text.split(MARKER).slice(1).join(MARKER)}`;
}

export function parseSeptemberWithDeposit() {
  return parseStatementText(septemberWithDepositText(), "stashaway-sep-2026-with-deposit.pdf");
}
