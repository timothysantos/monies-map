// Foreign currency estimates against a real Citi Rewards statement with
// Amaze rows (Sep 2026, a trip to Seoul): 45 "AMAZE*" rows as Citi prints
// them, merchant glued to the prefix and cut to about 13 characters, many
// naming only the Korean payment gateway ("AMAZE*EXIMBAYCO.,"), one date per
// row and no foreign amount. Row wording and dates are real; amounts are
// scaled by an undisclosed factor, as for the real-statement fixtures. Each
// purchase gets the estimate Apple Pay would have saved: the shop's full name
// (the gateway rows get a shop name the row does not show), 1-3% under the
// card's amount, bought up to two days before the card's date.
//
// The bar: an estimate is never paired with another purchase's row.
// Purchases the rows cannot tell apart stay for review.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";
import { isCardMerchantPrefixMatch } from "../src/domain/statement-row-matching.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const CITI = "Citi Rewards";
const KRW_PER_SGD = 1000;

// [card date, row as printed, card amount]
const AMAZE_ROWS = [
  ["2026-08-31", "AMAZE*BIZIEPLITEIL", "10.61"],
  ["2026-08-31", "AMAZE*I-PARKMALL", "44.85"],
  ["2026-08-31", "AMAZE*I-PARKMALL", "54.51"],
  ["2026-08-31", "AMAZE*MOOINYANGPOO", "31.80"],
  ["2026-08-31", "AMAZE*PALIKRASANG", "10.90"],
  ["2026-08-31", "AMAZE*SSIYU(CU)IN", "6.36"],
  ["2026-09-01", "AMAZE*(JOO)ENCUM37", "22.81"],
  ["2026-09-01", "AMAZE*(JU)INDIREOG", "10.70"],
  ["2026-09-01", "AMAZE*(JU)PYUEODA", "74.49"],
  ["2026-09-01", "AMAZE*BIZIEPLITEIL", "25.26"],
  ["2026-09-01", "AMAZE*CO.,LTD.MU", "73.16"],
  ["2026-09-01", "AMAZE*CO.,LTD.YO", "24.72"],
  ["2026-09-01", "AMAZE*E-MARTYONGS", "37.80"],
  ["2026-09-01", "AMAZE*ELZI25-YONGS", "16.76"],
  ["2026-09-01", "AMAZE*EXIMBAYCO.,", "18.89"],
  ["2026-09-01", "AMAZE*GENERALIDEA", "29.03"],
  ["2026-09-01", "AMAZE*JAYEONDOSA", "9.96"],
  ["2026-09-01", "AMAZE*JAYEONDOSA", "9.96"],
  ["2026-09-01", "AMAZE*POINTOBBYUJ", "24.63"],
  ["2026-09-01", "AMAZE*POINTOBBYUJ", "95.80"],
  ["2026-09-01", "AMAZE*PUIAZIT", "12.85"],
  ["2026-09-01", "AMAZE*SUKAMSAENGSO", "74.65"],
  ["2026-09-02", "AMAZE*BIZIEPLITEIL", "5.81"],
  ["2026-09-02", "AMAZE*BIZIEPLITEIL", "4.07"],
  ["2026-09-02", "AMAZE*CLO", "39.81"],
  ["2026-09-02", "AMAZE*COMPANYS.S", "34.76"],
  ["2026-09-02", "AMAZE*COMPANYS.S", "92.07"],
  ["2026-09-02", "AMAZE*EXIMBAYCO.,", "11.22"],
  ["2026-09-02", "AMAZE*EXIMBAYCO.,", "12.32"],
  ["2026-09-02", "AMAZE*JOOSIKHWESA", "18.58"],
  ["2026-09-02", "AMAZE*JUSIGHOISAR", "5.81"],
  ["2026-09-02", "AMAZE*KICC_HAEOI", "5.72"],
  ["2026-09-02", "AMAZE*LIKODEOSEUTO", "9.96"],
  ["2026-09-02", "AMAZE*POTOMONG", "4.98"],
  ["2026-09-03", "AMAZE*BANDAINAMCOC", "5.84"],
  ["2026-09-03", "AMAZE*EXIMBAYCO.,", "11.38"],
  ["2026-09-03", "AMAZE*EXIMBAYCO.,", "13.67"],
  ["2026-09-03", "AMAZE*POTOIZMPARKS", "5.00"],
  ["2026-09-04", "AMAZE*EXIMBAYCO.,", "34.67"],
  ["2026-09-05", "AMAZE*CHABAIKDOJA", "4.95"],
  ["2026-09-06", "AMAZE*EXIMBAYCO.,", "21.69"],
  ["2026-09-08", "AMAZE*EXIMBAYCO.,", "27.85"],
  ["2026-09-09", "AMAZE*EXIMBAYCO.,", "13.52"],
  ["2026-09-09", "AMAZE*EXIMBAYCO.,", "13.06"],
  ["2026-09-10", "AMAZE*EXIMBAYCO.,", "14.45"]
];

// What Apple Pay shows for the shops behind the gateway rows.
const GATEWAY_SHOPS = ["Olive Young Myeongdong", "Daiso Myeongdong", "Musinsa Standard Seongsu", "ABC Mart Hongdae", "Kakao Friends Gangnam", "Line Friends Store", "Innisfree Insadong", "Gentle Monster Dosan", "Starfield COEX", "Lotte World Mall", "Hyundai Department Store"];

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

// Wallet shows the shop's own name: words apart where the card glues them,
// and the word the card cuts off completed ("E-MARTYONGS" is "E-MART
// YONGSAN").
function appleWalletName(cardMerchant) {
  const middle = Math.ceil(cardMerchant.length / 2);
  const spaced = `${cardMerchant.slice(0, middle)} ${cardMerchant.slice(middle)}AN`;
  return `${spaced.charAt(0)}${spaced.slice(1).toLowerCase()}`;
}

function simulatedPurchases() {
  let gateway = 0;
  return AMAZE_ROWS.map(([date, description, amount], index) => {
    const merchant = description.slice("AMAZE*".length);
    const shop = merchant.startsWith("EXIMBAY") ? GATEWAY_SHOPS[gateway++ % GATEWAY_SHOPS.length] : appleWalletName(merchant);
    const estimateMinor = Math.round(Number(amount) * 100 / (1.01 + (index % 3) * 0.01));
    return { date: shiftDate(date, index % 3), shop, krw: Math.round(estimateMinor * KRW_PER_SGD / 100) };
  });
}

test("on a real Amaze statement, no estimate is ever paired with another purchase's row", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = ?", CITI);
  await enableShortcut(db, { foreignCurrencyAccountId: citi.id });
  await saveRate(db, { quote: "KRW", quotePerBase: KRW_PER_SGD });

  const estimateIds = [];
  for (const purchase of simulatedPurchases()) {
    const { status, payload } = await postWalletPurchase(fetchWorker, { amount: `KRW ${purchase.krw.toLocaleString("en-SG")}`, description: purchase.shop, date: purchase.date });
    assert.equal(status, 200, JSON.stringify(payload));
    estimateIds.push(payload.entryId);
  }

  const { status, payload } = await api("/api/imports/preview", {
    sourceLabel: "Citi Rewards Sep 2026",
    sourceType: "pdf",
    rows: AMAZE_ROWS.map(([date, description, amount]) => ({ date, description, expense: amount, income: "", account: CITI, category: "Other", type: "expense" })),
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: []
  });
  assert.equal(status, 200, JSON.stringify(payload));

  // Two purchases the card prints identically (same shop, amount and day)
  // are interchangeable: either pairing is right.
  const sameCardRow = (left, right) => AMAZE_ROWS[left].join("|") === AMAZE_ROWS[right].join("|");
  const outcome = { right: 0, wrong: [], review: 0 };
  payload.preview.previewRows.forEach((row, index) => {
    const target = row.reconciliationTargetTransactionId;
    if (!target) {
      outcome.review += 1;
    } else if (target === estimateIds[index] || sameCardRow(estimateIds.indexOf(target), index)) {
      outcome.right += 1;
    } else {
      outcome.wrong.push(`${AMAZE_ROWS[index][1]} ${AMAZE_ROWS[index][2]}`);
    }
  });
  assert.deepEqual(outcome.wrong, []);
  // Every row that names its shop matches, and so does a gateway row once
  // the named rows are paired and it is the only fit left for its estimate.
  // Left for review: gateway rows that still fit more than one estimate,
  // and "AMAZE*CLO", too short to trust as a name.
  assert.deepEqual({ right: outcome.right, review: outcome.review }, { right: 41, review: 4 });
});

test("a card row names the shop when the Wallet name starts with what the card printed", () => {
  for (const [card, wallet] of [
    ["AMAZE*E-MARTYONGS", "E-MART Yongsan"],
    ["AMAZE*I-PARKMALL", "I-PARK Mall Yongsan"],
    ["AMAZE*JAYEONDOSA", "Jayeon Dosa"],
    ["AMAZE* DIGIMAP ICON SANUR M23 SINGAPORE SG", "Digimap Icon Sanur M23"]
  ]) {
    assert.equal(isCardMerchantPrefixMatch(card, wallet), true, `${card} / ${wallet}`);
  }
  for (const [card, wallet, why] of [
    ["AMAZE*EXIMBAYCO.,", "Eximbay Olive Young", "a payment gateway is not a shop"],
    ["AMAZE*CLO", "Clo Seoul", "too short to trust"],
    ["E-MART YONGSAN SEOUL KR", "E-MART Yongsan", "no payment app prefix: the usual wording rules apply"],
    ["AMAZE*E-MARTYONGS", "Lotte Mart Yongsan", "a different shop"]
  ]) {
    assert.equal(isCardMerchantPrefixMatch(card, wallet), false, why);
  }
});
