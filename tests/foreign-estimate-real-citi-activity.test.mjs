// Foreign currency estimates against a real Citi Rewards activity export
// from a trip to Bali (26 Sep - 10 Oct 2026). The 19 estimates are the ones
// saved for that trip, with the Wallet or app name, IDR amount and SGD
// estimate as saved. The card printed three kinds of row for them:
//   - "AMAZE* NAUGHTY NURI": an Amaze purchase naming the shop;
//   - "AMAZE* GOPAYID": an Amaze purchase naming only Gojek's wallet;
//   - "Grab* A-9THL7BTGWXEOAV ... IDR 166,600": paid by card in Grab, with
//     the IDR amount printed.
// The card number and a transfer's payee are sanitized; wording, dates and
// amounts are real.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";
import { parseCitibankActivityCsv } from "../src/lib/statement-import.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const CITI = "Citi Rewards";
const CSV = readFileSync(new URL("./fixtures/citibank-activity/ACCT_349_26_09_2026-bali-sanitized.csv", import.meta.url), "utf8");

// [day, Wallet or app name, IDR, SGD estimate, the card's row (start of its
// wording), the card's SGD]
const ESTIMATES = [
  ["2026-10-02", "Roti O Inter Bali Arv", 16000, 114, "AMAZE* ROTI O INTER", 117],
  ["2026-10-02", "Naughty Nuris Sanur", 1233430, 8795, "AMAZE* NAUGHTY NURI", 9030],
  ["2026-10-02", "GrabMart ALFAMART - DANAU TAMBLINGAN Q716", 166600, 1188, "Grab* A-9THL7BTGWXEOAV", 1233],
  ["2026-10-02", "Gojek ride - Liga.Tennis & Padel Sanur", 35500, 253, "AMAZE* GOPAYID", 260],
  ["2026-10-02", "GoMart Alfamart Tukad Yeh Aya", 82000, 585, "AMAZE* GOPAYID", 600],
  ["2026-10-02", "GoFood Slow Slice Pizza, Sanur", 462500, 3298, "AMAZE* GOPAYID", 3386],
  ["2026-10-03", "Olli Baked Goods Ho", 383500, 2734, "AMAZE* OLLI BAKED G", 2812],
  ["2026-10-03", "Market City Icon Bali", 43300, 309, "AMAZE* MARKET CITY", 318],
  ["2026-10-03", "Market city ICON Bali Sanur", 42800, 305, "AMAZE* MARKET CITY", 313],
  ["2026-10-03", "Digimap Icon Sanur M23", 159000, 1134, "AMAZE* DIGIMAP ICON", 1166],
  ["2026-10-03", "Bali Racquet Society", 35805, 255, "AMAZE* BALI RACQUET", 262],
  ["2026-10-03", "Gojek ride - Bali Racquet Society", 50500, 360, "AMAZE* GOPAYID", 371],
  ["2026-10-03", "Gojek ride - Jl. Bumi Ayu No. 4", 59500, 424, "AMAZE* GOPAYID", 436],
  ["2026-10-03", "GrabFood Warung Saro - Sanur", 458500, 3269, "Grab* A-9TKJTI5WXDTVAV", 3398],
  ["2026-10-03", "GrabMart ALFAMART - DANAU TAMBLINGAN Q716", 135100, 963, "Grab* A-9TKKB4CGXDJAAV", 1001],
  ["2026-10-03", "GrabFood Nasi Pindang Bu Ratna - Panjer", 54500, 389, "Grab* JTAZCWCKAYL2-G-1", 403],
  ["2026-10-03", "GrabFood Batter Club Cookies - Canggu", 510300, 3639, "Grab* A-9TLNIHSGX6O3AV", 3783],
  ["2026-10-03", "GrabMart DailyMart by Grab - Bonjol Bali", 81000, 578, "Grab* A-9TLOQARG2CJPAV", 600],
  ["2026-10-04", "Kula Padi", 93280, 665, "AMAZE* KULA PADI", 684]
];

function parseCsv() {
  return parseCitibankActivityCsv(CSV, "ACCT_349_26_09_2026.csv", { accountName: CITI, accountKind: "credit_card", institution: "Citibank" });
}

async function saveEstimates(t, estimates) {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = ?", CITI);
  await enableShortcut(db, { foreignCurrencyAccountId: citi.id });
  await saveRate(db, { quote: "IDR", quotePerBase: 14000 });
  const ids = [];
  for (const [date, name, idr, sgdMinor] of estimates) {
    const { status, payload } = await postWalletPurchase(fetchWorker, { amount: `IDR ${idr.toLocaleString("en-SG")}`, description: name, date });
    assert.equal(status, 200, JSON.stringify(payload));
    // The SGD each estimate was saved at, on that day's rate.
    await db.prepare("UPDATE transactions SET amount_minor = ? WHERE id = ?").bind(sgdMinor, payload.entryId).run();
    ids.push(payload.entryId);
  }
  return { db, api, ids };
}

async function previewActivity(api, parsed = parseCsv()) {
  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "csv",
    parserKey: parsed.parserKey,
    rows: parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  });
  assert.equal(status, 200, JSON.stringify(payload));
  return payload.preview.previewRows;
}

test("every Bali estimate pairs with its own row of the card's activity export", async (t) => {
  const { api, ids } = await saveEstimates(t, ESTIMATES);
  const previewRows = await previewActivity(api);

  const paired = ESTIMATES.map((_, index) => {
    const row = previewRows.find((candidate) => candidate.reconciliationTargetTransactionId === ids[index]);
    return row ? [row.description.slice(0, ESTIMATES[index][4].length), row.amountMinor, row.commitStatus] : null;
  });
  assert.deepEqual(paired, ESTIMATES.map(([, , , , cardRow, cardMinor]) => [cardRow, cardMinor, "included"]));

  // The card's rows with no estimate behind them (before the trip, the
  // last day's rides, back home) are new entries.
  const unpaired = previewRows.filter((row) => !row.reconciliationTargetTransactionId);
  assert.equal(unpaired.length, previewRows.length - ESTIMATES.length);
  assert.ok(unpaired.every((row) => row.commitStatus === "included" && !row.reconciliationMatch && !row.reconciliationMatches?.length));
});

test("the preview says the card's amount replaces the estimate", async (t) => {
  const { api, ids } = await saveEstimates(t, ESTIMATES);
  const previewRows = await previewActivity(api);

  const naughtyNuri = previewRows.find((row) => row.reconciliationTargetTransactionId === ids[1]);
  assert.equal(naughtyNuri.commitStatusReason, "Updates your estimate for IDR 1,233,430 from SGD 87.95 to the card's SGD 90.30.");
});

test("a card row printing another IDR amount is never that estimate, however close its SGD", async (t) => {
  // The same purchase saved at IDR 166,000 instead of the IDR 166,600 the
  // card printed: still within the amount band, but not this purchase.
  const { api, ids } = await saveEstimates(t, [["2026-10-02", "GrabMart ALFAMART - DANAU TAMBLINGAN Q716", 166000, 1186, "", 0]]);
  const previewRows = await previewActivity(api);

  const grab = previewRows.find((row) => row.description.startsWith("Grab* A-9THL7BTGWXEOAV"));
  assert.equal(grab.reconciliationTargetTransactionId, undefined);
  assert.ok(previewRows.every((row) => row.reconciliationTargetTransactionId !== ids[0]));
});

test("an Amaze row naming another shop, a little under the estimate, does not take a Gojek estimate", async (t) => {
  // "AMAZE* WHSMITH" SGD 5.71 sits 2.4% under the GoMart estimate of SGD
  // 5.85; the card adds its fees, so the GOPAYID row at SGD 6.00 is the one.
  const gomart = ESTIMATES[4];
  const { api, ids } = await saveEstimates(t, [gomart]);
  const previewRows = await previewActivity(api);

  const target = previewRows.find((row) => row.reconciliationTargetTransactionId === ids[0]);
  assert.deepEqual([target?.description.slice(0, 14), target?.amountMinor], ["AMAZE* GOPAYID", 600]);
});
