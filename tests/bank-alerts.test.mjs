// Bank alerts (DOMAIN.md "Bank Alert"): the deterministic reader of a bank's
// payment alert and the waiting tap it finishes. The alert texts here are
// INVENTED and UNVERIFIED: structure-faithful guesses at each bank's wording
// (src/domain/bank-alerts-config.ts), with made-up shops, amounts and card
// digits. Replace them with sanitized real alerts when the owner has them.
import assert from "node:assert/strict";
import test from "node:test";

import {
  alertMerchantAgrees,
  findTapForBankAlert,
  looksLikeOneTimeCode,
  readBankAlert,
  readMoney,
  scrubAlertNumbers
} from "../src/domain/bank-alerts.ts";
import { BANK_ALERT_WORDINGS } from "../src/domain/bank-alerts-config.ts";

const payment = (currency, amountText, amountMinor, merchant, wordingId) => ({ kind: "payment", currency, amountText, amountMinor, merchant, wordingId });
const nothing = (reason) => ({ kind: "nothing", reason });

test("each bank's (unverified) alert reads as its payment: amount, currency and shop", () => {
  const byId = Object.fromEntries(BANK_ALERT_WORDINGS.map((wording) => [wording.id, wording.sample]));
  assert.deepEqual(readBankAlert(byId["dbs-card-labels"]), payment("SGD", "12.34", 1234, "KOPITIAM SQUARE", "dbs-card-labels"));
  assert.deepEqual(readBankAlert(byId["uob-transaction-of"]), payment("SGD", "25.80", 2580, "FAIRPRICE FINEST", "uob-transaction-of"));
  assert.deepEqual(readBankAlert(byId["citi-a-transaction"]), payment("SGD", "45.00", 4500, "GRAB* RIDES", "citi-a-transaction"));
  assert.deepEqual(readBankAlert(byId["ocbc-was-charged"]), payment("SGD", "8.50", 850, "STARBUCKS @ VIVOCITY", "ocbc-was-charged"));
  assert.deepEqual(readBankAlert(byId["amaze-spent"]), payment("IDR", "150000", 15000000, "AMAZE*WARUNG MADE", "amaze-spent"));
  assert.deepEqual(readBankAlert(byId["generic-payment-at"]), payment("SGD", "19.90", 1990, "UNIQLO ION ORCHARD", "generic-payment-at"));
});

test("every wording is marked unverified and comes with a sample its own pattern reads", () => {
  assert.ok(BANK_ALERT_WORDINGS.length >= 6);
  for (const wording of BANK_ALERT_WORDINGS) {
    assert.equal(wording.verified, false, wording.id);
    const reading = readBankAlert(wording.sample);
    assert.equal(reading.kind, "payment", wording.id);
    assert.equal(reading.wordingId, wording.id);
  }
});

test("amounts: either order, signs, thousands separators and currencies written without decimals", () => {
  assert.deepEqual(readBankAlert("A transaction of SGD 1,234.50 was made with your UOB Card ending 5521 on 17/11/26 at APPLE STORE ORCHARD."),
    payment("SGD", "1234.50", 123450, "APPLE STORE ORCHARD", "uob-transaction-of"));
  assert.deepEqual(readBankAlert("Your OCBC card ending 2093 was charged 12.34 USD at AMAZON WEB SERVICES on 17 Nov 2026."),
    payment("USD", "12.34", 1234, "AMAZON WEB SERVICES", "ocbc-was-charged"));
  assert.deepEqual(readBankAlert("Your OCBC card ending 2093 was charged S$7.20 at YA KUN on 17 Nov."),
    payment("SGD", "7.20", 720, "YA KUN", "ocbc-was-charged"));
  assert.deepEqual(readBankAlert("Amaze: You spent JPY 1,200 at AMAZE*LAWSON SHIBUYA with your Amaze card."),
    payment("JPY", "1200", 120000, "AMAZE*LAWSON SHIBUYA", "amaze-spent"));
  assert.deepEqual(readBankAlert("Amaze: You paid Rp150.000 to AMAZE*WARUNG MADE."),
    payment("IDR", "150000", 15000000, "AMAZE*WARUNG MADE", "amaze-spent"));
  assert.deepEqual(readBankAlert("Amaze: You spent KRW 15,000 at AMAZE*E-MARTYONGS."),
    payment("KRW", "15000", 1500000, "AMAZE*E-MARTYONGS", "amaze-spent"));
  // A balance or limit after the payment is not a second amount.
  assert.deepEqual(readBankAlert("A transaction of SGD 25.80 was made with your UOB Card ending 5521 at FAIRPRICE FINEST. Available limit: SGD 5,000.00."),
    payment("SGD", "25.80", 2580, "FAIRPRICE FINEST", "uob-transaction-of"));
  assert.deepEqual(readMoney("SGD 12.345"), null);
  assert.deepEqual(readMoney("NOV 17"), null);
  assert.deepEqual(readMoney("IDR 150.000"), { currency: "IDR", amountText: "150000", amountMinor: 15000000 });
  assert.deepEqual(readMoney("SGD 150.000"), null);
});

test("an email footer past the alert's first part changes nothing", () => {
  const dbs = BANK_ALERT_WORDINGS.find((wording) => wording.id === "dbs-card-labels").sample;
  const footer = `\n${"This is an automatically generated email. ".repeat(14)}\nEnjoy 5% cashback when you spend SGD 50 at selected merchants. T&Cs apply.`;
  assert.deepEqual(readBankAlert(dbs + footer), payment("SGD", "12.34", 1234, "KOPITIAM SQUARE", "dbs-card-labels"));
});

test("a one-time code is dropped before anything is read, even when it names a payment", () => {
  for (const text of [
    "Your OTP for the transaction of SGD 12.34 at SHOPEE is 482913. Do not share it with anyone.",
    "DBS: 73920418 is your One-Time Password (OTP) for a SGD 45.00 transaction at GRAB* RIDES.",
    "Use verification code 551204 to approve your payment of SGD 8.50 to STARBUCKS.",
    "123456 is your OCBC OneTime Password. Never share it."
  ]) {
    assert.equal(looksLikeOneTimeCode(text), true, text);
    assert.deepEqual(readBankAlert(text), nothing("one_time_code"), text);
  }
  // A payment alert that only warns about codes, with no code in it, is read.
  assert.deepEqual(
    readBankAlert("A transaction of SGD 25.80 was made with your UOB Card ending 5521 at FAIRPRICE FINEST. Never share your OTP with anyone."),
    payment("SGD", "25.80", 2580, "FAIRPRICE FINEST", "uob-transaction-of")
  );
});

test("alerts that are not a card payment going out read as nothing", () => {
  const cases = [
    ["login", "You have logged in to DBS digibank on a new device on 17 Nov 14:32. Not you? Call us."],
    ["incoming transfer", "You have received SGD 50.00 from TAN AH KOW via PayNow on 17 Nov."],
    ["money in", "SGD 3,200.00 has been credited to your account ending 1234 on 17 Nov."],
    ["refund", "A refund of SGD 12.34 at UNIQLO ION ORCHARD has been credited to your card ending 4417."],
    ["declined", "A transaction of SGD 99.00 at ZALORA was declined on your UOB Card ending 5521."],
    ["promotion", "Enjoy 10% off when you spend SGD 50 at SHOPEE with your Citi card. T&Cs apply."],
    ["transfer out", "You have transferred SGD 200.00 to JOHN TAN on 17 Nov 14:32."]
  ];
  for (const [what, text] of cases) {
    assert.deepEqual(readBankAlert(text), nothing("not_a_payment"), what);
  }
});

test("two amounts, no currency, no shop or an unknown wording read as nothing", () => {
  assert.deepEqual(readBankAlert("A transaction of SGD 12.00 and another of SGD 8.00 was made at SHOP X."), nothing("several_amounts"));
  assert.deepEqual(readBankAlert("A transaction of 12.34 was made with your UOB Card ending 5521 at FAIRPRICE FINEST."), nothing("no_amount"));
  assert.deepEqual(readBankAlert("Your statement of SGD 1,204.55 is ready to view."), nothing("unknown_wording"));
  assert.deepEqual(readBankAlert(""), nothing("empty"));
  assert.deepEqual(readBankAlert("   \n "), nothing("empty"));
});

test("card, account and phone digits are scrubbed first and never reach the reading", () => {
  const text = "A transaction of SGD 25.80 was made with your UOB Card 4417 1234 5678 9012 (a/c 123-456789-0, ending 9012) on 17/11/26 at FAIRPRICE 4417 FINEST. Call 6222 2121 if unauthorised.";
  const reading = readBankAlert(text);
  assert.equal(reading.kind, "payment");
  assert.equal(reading.amountMinor, 2580);
  const kept = JSON.stringify(reading);
  for (const digits of ["4417", "1234", "5678", "9012", "456789", "6222", "2121"]) {
    assert.equal(kept.includes(digits), false, digits);
  }
  const scrubbed = scrubAlertNumbers("card 4417 1234 5678 9012, ending in 4417, XXXX-XXXX-XXXX-8830, *8830, a/c 123-456789-0, S1234567D");
  assert.doesNotMatch(scrubbed, /\d/);
  // The payment's own amount survives the scrub.
  assert.match(scrubAlertNumbers("Amount: SGD12.34\nFrom: card ending 4417"), /SGD12\.34/);
});

test("shop names agree by the waiting-tap rule, and the AMAZE* prefix is dropped first", () => {
  assert.equal(alertMerchantAgrees("AMAZE*WARUNG MADE", "Warung Made Seminyak"), true);
  assert.equal(alertMerchantAgrees("AMAZE*E-MARTYONGS", "E-MART Yongsan"), true);
  assert.equal(alertMerchantAgrees("STARBUCKS @ VIVOCITY", "Starbucks"), true);
  assert.equal(alertMerchantAgrees("KOPITIAM SQUARE", "Periplus Bali"), false);
  // A blank shop never agrees (unlike two Shortcut runs).
  assert.equal(alertMerchantAgrees("AMAZE*", "Periplus Bali"), false);
});

const NOW = "2026-11-17T06:30:00.000Z";
const at = (seconds) => new Date(Date.parse(NOW) + seconds * 1000).toISOString();
const tap = (overrides = {}) => ({
  id: "tap-1", requestId: "apple-pay-1", personId: "person-tim", accountId: "account-uob", otherCurrencyAccountId: "",
  merchant: "Warung Made Seminyak", walletName: "Amaze", tapDate: "2026-11-17", receivedAt: NOW, status: "waiting", ...overrides
});
const alert = (seconds, overrides = {}) => ({ personId: "person-tim", merchant: "AMAZE*WARUNG MADE", at: at(seconds), ...overrides });

test("exactly one of the person's waiting taps within 10 minutes before to 30 minutes after, at the same shop", () => {
  assert.deepEqual(findTapForBankAlert([tap()], alert(90)), { outcome: "one", tap: tap() });
  assert.equal(findTapForBankAlert([tap()], alert(-600)).outcome, "one");
  assert.equal(findTapForBankAlert([tap()], alert(1800)).outcome, "one");
  assert.equal(findTapForBankAlert([tap()], alert(-601)).outcome, "none");
  assert.equal(findTapForBankAlert([tap()], alert(1801)).outcome, "none");
  assert.equal(findTapForBankAlert([tap({ personId: "person-joyce" })], alert(60)).outcome, "none");
  assert.equal(findTapForBankAlert([tap({ status: "completed" })], alert(60)).outcome, "none");
  assert.equal(findTapForBankAlert([tap()], alert(60, { merchant: "KOPITIAM SQUARE" })).outcome, "none");
  assert.deepEqual(
    findTapForBankAlert([tap(), tap({ id: "tap-2", requestId: "apple-pay-2", receivedAt: at(120) })], alert(150)),
    { outcome: "several", count: 2 }
  );
  // Another shop's tap at the same time does not make it ambiguous.
  assert.equal(findTapForBankAlert([tap(), tap({ id: "tap-2", merchant: "Periplus Bali" })], alert(60)).outcome, "one");
});
