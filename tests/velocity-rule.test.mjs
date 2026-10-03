// The velocity rule's repetition test (createRepetitionIndex in
// src/domain/statement-row-matching.ts): a charge repeats when the same
// account has another charge of the same signed amount with lookalike
// wording within a week. Repeated charges get the tight 2-day match window,
// one-off charges 7 days (docs/audits/velocity-rule.md). Proven on the real
// UOB One Card export of 6 May 2026.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeImportRow, extractTransactionDateHint } from "../src/domain/app-repository-helpers.ts";
import { createRepetitionIndex } from "../src/domain/statement-row-matching.ts";
import { parseCurrentTransactionSpreadsheet } from "../src/lib/statement-import/xls.ts";

function readOneCardExport() {
  const name = "CC_TXN_History_06052026211223-onecard-tim-06-may.xls";
  const buffer = readFileSync(new URL(`./fixtures/uob-current-transactions/${name}`, import.meta.url));
  return parseCurrentTransactionSpreadsheet(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), name).rows
    .map((raw) => normalizeImportRow(raw))
    .filter((row) => !row.errors.length)
    .map((row) => toCharge("UOB One Card", row.date, extractTransactionDateHint(row.note), row.description, row.entryType === "income" ? row.amountMinor : -row.amountMinor));
}

function toCharge(accountId, postedDate, eventDate, description, signedAmountMinor) {
  return { accountId, postedDate, eventDate: eventDate ?? postedDate, hasEventDateHint: Boolean(eventDate && eventDate !== postedDate), description, signedAmountMinor };
}

const repeatsIn = (charges) => createRepetitionIndex(charges, (charge) => charge);

test("on the real One Card export, OpenAI top-ups and same-fare rides repeat; one-off purchases and varying fares do not", () => {
  const charges = readOneCardExport();
  const repeats = repeatsIn(charges);
  const by = (description, amountMinor) => charges.filter((charge) => charge.description.startsWith(description) && charge.signedAmountMinor === -amountMinor);

  // 25 OpenAI charges of $7.22, up to ten a day.
  assert.equal(by("OPENAI OPENAI.COM", 722).length, 25);
  assert.ok(by("OPENAI OPENAI.COM", 722).every(repeats));
  // Six $1.28 rides between 8 and 30 Apr, each printed with its own trip
  // number; each has another within a week.
  assert.equal(by("BUS/MRT", 128).length, 6);
  assert.ok(by("BUS/MRT", 128).every(repeats));
  // Fares that differ ride to ride, and a one-off shop, do not.
  assert.equal(by("BUS/MRT", 384).some(repeats), false);
  assert.equal(by("IKEA SINGAPORE", 1290).some(repeats), false);
  assert.equal(by("KKH RETAIL PHARMACY", 3360).some(repeats), false);
});

test("a lookalike only counts on the same account, in the same direction, within a week", () => {
  const coffee = toCharge("card-a", "2026-05-06", "2026-05-06", "STARBUCKS SINGAPORE", -450);
  const cases = [
    ["another card", toCharge("card-b", "2026-05-07", "2026-05-07", "STARBUCKS SINGAPORE", -450)],
    ["a refund of the same amount", toCharge("card-a", "2026-05-07", "2026-05-07", "STARBUCKS SINGAPORE", 450)],
    ["eight days later", toCharge("card-a", "2026-05-14", "2026-05-14", "STARBUCKS SINGAPORE", -450)],
    ["a different shop", toCharge("card-a", "2026-05-07", "2026-05-07", "GRAB RIDES", -450)],
    ["a different amount", toCharge("card-a", "2026-05-07", "2026-05-07", "STARBUCKS SINGAPORE", -460)]
  ];
  for (const [label, other] of cases) {
    assert.equal(repeatsIn([coffee, other])(coffee), false, label);
  }
  // Seven days later at the same shop and price is a repeat.
  assert.equal(repeatsIn([coffee, toCharge("card-a", "2026-05-13", "2026-05-13", "STARBUCKS SINGAPORE", -450)])(coffee), true);
  // A charge alone never repeats.
  assert.equal(repeatsIn([coffee])(coffee), false);
});
