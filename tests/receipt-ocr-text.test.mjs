import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readReceiptOcrText } from "../src/domain/receipt-ocr-text.ts";

// The no-AI receipt reader: in-browser OCR text (the existing Tesseract
// helpers) becomes the same ReceiptReadDto the AI route returns. Fixtures
// under tests/fixtures/receipts are near-real receipt layouts with made-up
// shops, addresses and card endings: preambles, GST/tax lines, subtotal
// versus total, tendered and change lines, IDR thousands dots, an OCR "0"
// for "O", and a smudged date.

const TODAY = "2026-10-11";

async function readFixture(name) {
  return readFile(new URL(`./fixtures/receipts/${name}`, import.meta.url), "utf8");
}

test("a Singapore supermarket receipt reads the total, not the subtotal or savings", async () => {
  const read = readReceiptOcrText(await readFixture("sg-supermarket.txt"), { today: TODAY, defaultCurrency: "SGD" });
  assert.deepEqual(read, {
    source: "ocr",
    merchant: { value: "LUMEN GROCER PTE LTD", confidence: "medium" },
    date: { value: "2026-10-09", confidence: "medium" },
    total: { amountMinor: 2195, currency: "SGD", confidence: "medium" },
    cardLast4: "2718",
    lineItems: [
      { description: "OAT MILK 1L", amountMinor: 450, quantity: null },
      { description: "FREE RANGE EGGS 10S", amountMinor: 780, quantity: 2 },
      { description: "BABY SPINACH 200G", amountMinor: 325, quantity: null },
      { description: "SOURDOUGH LOAF", amountMinor: 690, quantity: null },
      { description: "MEMBER DISC", amountMinor: -50, quantity: null }
    ],
    questions: []
  });
});

test("a cafe receipt with an OCR zero in TOTAL and a masked card still reads", async () => {
  const read = readReceiptOcrText(await readFixture("sg-cafe.txt"), { today: TODAY, defaultCurrency: "SGD" });
  assert.equal(read.merchant.value, "Kopi & Crumb Cafe");
  assert.deepEqual(read.date, { value: "2026-10-11", confidence: "medium" });
  assert.deepEqual(read.total, { amountMinor: 2338, currency: "SGD", confidence: "medium" });
  assert.equal(read.cardLast4, "3141");
  assert.deepEqual(read.lineItems.map((item) => [item.description, item.amountMinor, item.quantity]), [
    ["Flat White", 650, 1],
    ["Iced Long Black", 600, 1],
    ["Kaya Toast Set", 580, 1],
    ["Add egg", 120, null]
  ]);
  assert.deepEqual(read.questions, []);
});

test("an IDR receipt reads thousands dots as whole rupiah and ignores cash tendered", async () => {
  const read = readReceiptOcrText(await readFixture("bali-warung.txt"), { today: TODAY, defaultCurrency: "SGD" });
  assert.equal(read.merchant.value, "WARUNG CONTOH SARI");
  assert.deepEqual(read.date, { value: "2026-10-05", confidence: "medium" });
  assert.deepEqual(read.total, { amountMinor: 14_300_000, currency: "IDR", confidence: "medium" });
  assert.equal(read.cardLast4, null);
  assert.deepEqual(read.lineItems.map((item) => [item.description, item.amountMinor, item.quantity]), [
    ["Nasi Campur", 4_500_000, null],
    ["Es Kelapa Muda", 2_500_000, null],
    ["Sate Lilit", 6_000_000, 2]
  ]);
  assert.deepEqual(read.questions, []);
});

test("a day/month date with no printed currency becomes a question with both readings", async () => {
  const read = readReceiptOcrText(await readFixture("us-diner-ambiguous-date.txt"), { today: TODAY, defaultCurrency: "SGD" });
  assert.equal(read.merchant.value, "MAPLE & PINE DINER");
  assert.deepEqual(read.date, { value: "2026-04-03", confidence: "low" });
  assert.deepEqual(read.total, { amountMinor: 2138, currency: "SGD", confidence: "medium" });
  assert.deepEqual(read.questions, [
    { field: "date", reason: "ambiguous", candidates: ["2026-04-03", "2026-03-04"] }
  ]);
});

test("a smudged date and no TOTAL label ask the user instead of guessing silently", async () => {
  const read = readReceiptOcrText(await readFixture("smudged-no-total.txt"), { today: TODAY, defaultCurrency: "SGD" });
  assert.equal(read.merchant.value, "HAWKER STALL 00");
  assert.deepEqual(read.date, { value: null, confidence: "low" });
  // Without a label the largest amount is offered, flagged as unclear.
  assert.deepEqual(read.total, { amountMinor: 750, currency: "SGD", confidence: "low" });
  assert.deepEqual(read.questions, [
    { field: "date", reason: "missing" },
    { field: "total", reason: "unclear" }
  ]);
});

test("a full card number in OCR text is cut to its last four digits", () => {
  const read = readReceiptOcrText("SAMPLE MART\n01/10/2026\nTOTAL 5.00\nVISA 4000 0000 0000 0002\n", { today: TODAY, defaultCurrency: "SGD" });
  assert.equal(read.cardLast4, "0002");
  assert.equal(JSON.stringify(read).includes("4000 0000"), false);
});

test("a future-dated receipt has its date dropped and asked about", () => {
  const read = readReceiptOcrText("SAMPLE MART\n25/12/2026\nTOTAL S$5.00\n", { today: TODAY, defaultCurrency: "SGD" });
  assert.equal(read.date.value, null);
  assert.deepEqual(read.questions, [{ field: "date", reason: "future_date" }]);
});

test("text with no shop, date or amount is not a receipt", () => {
  assert.equal(readReceiptOcrText("", { today: TODAY }), null);
  assert.equal(readReceiptOcrText("~~~ ~~ ~~~\n", { today: TODAY }), null);
});
