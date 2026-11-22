// The waiting tap's pure rules (src/domain/waiting-taps.ts): which Shortcut
// versions get a held tap, which later run completes one, and which bank rows
// or certified statements clear one. Concrete facts in, concrete answers out.
import assert from "node:assert/strict";
import test from "node:test";

import {
  canHoldTap,
  findTapForSecondRun,
  merchantsAgree,
  planWaitingTapClears,
  readShortcutClientVersion
} from "../src/domain/waiting-taps.ts";
import { ASK_AFTER_SECONDS, IMPORT_CLEAR_MAX_DAY_DISTANCE, readAskAfterSeconds, SECOND_TAP_WINDOW_SECONDS, WAITING_TAP_EXPIRE_DAYS } from "../src/domain/waiting-taps-config.ts";
import { fallbackStatementStart } from "../src/domain/waiting-tap-statements.ts";

const tap = (overrides = {}) => ({
  id: "tap-1",
  requestId: "apple-pay-1",
  personId: "person-tim",
  accountId: "acct-uob",
  otherCurrencyAccountId: "",
  merchant: "Periplus Bali",
  walletName: "UOB One",
  tapDate: "2026-10-05",
  receivedAt: "2026-10-05T04:00:00.000Z",
  status: "waiting",
  ...overrides
});
const after = (seconds) => new Date(Date.parse("2026-10-05T04:00:00.000Z") + seconds * 1000).toISOString();

test("the config the owner can change: 10 minutes, never ask in the run, a week before a tap is put away, 7 days of posting room", () => {
  assert.equal(SECOND_TAP_WINDOW_SECONDS, 600);
  assert.equal(ASK_AFTER_SECONDS, null);
  assert.equal(WAITING_TAP_EXPIRE_DAYS, 7);
  assert.equal(IMPORT_CLEAR_MAX_DAY_DISTANCE, 7);
  // The Worker var overrides it: a number of seconds up to 120, or off.
  assert.equal(readAskAfterSeconds(undefined), null);
  assert.equal(readAskAfterSeconds("45"), 45);
  assert.equal(readAskAfterSeconds("0"), 0);
  assert.equal(readAskAfterSeconds("off"), null);
  assert.equal(readAskAfterSeconds(""), null);
  assert.equal(readAskAfterSeconds("600"), null);
  assert.equal(readAskAfterSeconds("soon"), null);
});

test("only Shortcut v8 and later get a held tap", () => {
  assert.equal(readShortcutClientVersion("apple-pay-api-2026-11-17-v8"), 8);
  assert.equal(readShortcutClientVersion("apple-pay-api-2026-11-10-v7"), 7);
  assert.equal(readShortcutClientVersion("apple-pay-api-2027-01-01-v12"), 12);
  for (const version of ["apple-pay-api-2026-11-10-v7", "apple-pay-api-2026-08-22", "playwright-contract-v2", "", undefined, null, "v8x"]) {
    assert.equal(canHoldTap(version), false, String(version));
  }
  assert.equal(canHoldTap("apple-pay-api-2026-11-17-v8"), true);
  assert.equal(canHoldTap("app"), false);
});

test("merchants agree when the same, one runs into the other, a shop word is shared, or either is blank", () => {
  assert.equal(merchantsAgree("Periplus Bali", "PERIPLUS BALI"), true);
  assert.equal(merchantsAgree("Periplus", "Periplus Bali Ngurah Rai"), true);
  assert.equal(merchantsAgree("Bintang Supermarket", "Bintang Seminyak"), true);
  assert.equal(merchantsAgree("", "Periplus"), true);
  assert.equal(merchantsAgree("Periplus", undefined), true);
  assert.equal(merchantsAgree("Periplus Bali", "Starbucks Seminyak"), false);
});

// Wallet in Japan writes the shop, then its town and prefecture, as the
// owner's Takayama taps of 22 Nov 2026 show (a space before a comma, the
// shop in Japanese script). The town is not the shop: two shops in one town
// never agree, the same shop does, and a bank's or receipt's name without
// the town still agrees with it.
test("merchants with Wallet's town and prefecture agree only on the shop", () => {
  const suruga = "駿河屋 エブリフレスポ店, Takayama, Gifu";
  const pen = "Pen Shop IMAI , Takayama, Gifu";
  assert.equal(merchantsAgree(suruga, pen), false);
  assert.equal(merchantsAgree(pen, "Kissa Yayoi, Takayama, Gifu"), false);
  assert.equal(merchantsAgree("Lawson, Takayama, Gifu", "FamilyMart, Takayama, Gifu"), false);
  // A comma inside a shop's own name (figures after it) is kept whole.
  assert.equal(merchantsAgree("Toys, Games 24, Takayama", "Toys, Games 24, Takayama"), true);
  assert.equal(merchantsAgree(pen, "Pen Shop IMAI , Takayama, Gifu"), true);
  assert.equal(merchantsAgree(suruga, "駿河屋 エブリフレスポ店"), true);
  assert.equal(merchantsAgree(pen, "PEN SHOP IMAI TAKAYAMA JP"), true);
  assert.equal(merchantsAgree(pen, "Pen Shop Imai"), true);
  assert.equal(merchantsAgree(suruga, ""), true);
  // A second run at another shop in the same town never takes the held tap.
  const held = tap({ merchant: suruga, receivedAt: "2026-11-22T08:19:00.000Z" });
  const run = (overrides) => ({ personId: "person-tim", accountIds: ["acct-uob"], ...overrides });
  assert.equal(findTapForSecondRun([held], run({ merchant: pen, now: "2026-11-22T08:21:00.000Z" })), null);
  assert.equal(findTapForSecondRun([held], run({ merchant: suruga, now: "2026-11-22T08:21:00.000Z" }))?.id, "tap-1");
});

test("a second run completes the newest waiting tap of the same person on the same card inside the window", () => {
  const run = (overrides = {}) => ({ personId: "person-tim", accountIds: ["acct-uob"], merchant: "Periplus Bali", now: after(30), ...overrides });
  assert.equal(findTapForSecondRun([tap()], run())?.id, "tap-1");
  assert.equal(findTapForSecondRun([tap()], run({ now: after(SECOND_TAP_WINDOW_SECONDS) }))?.id, "tap-1");
  assert.equal(findTapForSecondRun([tap()], run({ now: after(SECOND_TAP_WINDOW_SECONDS + 1) })), null);
  assert.equal(findTapForSecondRun([tap()], run({ now: after(-5) })), null);
  assert.equal(findTapForSecondRun([tap()], run({ personId: "person-joyce" })), null);
  assert.equal(findTapForSecondRun([tap()], run({ accountIds: ["acct-citi"] })), null);
  // The run's card for the currency it named, or the card the Wallet picks.
  assert.equal(findTapForSecondRun([tap()], run({ accountIds: ["acct-citi", "acct-uob"] }))?.id, "tap-1");
  assert.equal(findTapForSecondRun([tap()], run({ merchant: "Starbucks" })), null);
  assert.equal(findTapForSecondRun([tap({ status: "completed" })], run()), null);
  const newer = tap({ id: "tap-2", receivedAt: after(20) });
  assert.equal(findTapForSecondRun([tap(), newer], run())?.id, "tap-2");
});

test("an import's bank row clears a tap on the same card, near its day, at the same shop", () => {
  const row = (overrides = {}) => ({ accountId: "acct-uob", dates: ["2026-10-07"], description: "PERIPLUS BALI DENPASAR", ...overrides });
  assert.deepEqual(planWaitingTapClears([tap()], [row()], []), [{ tapId: "tap-1", status: "bank_row" }]);
  // The posting day can be up to 7 days later; 8 is another purchase.
  assert.deepEqual(planWaitingTapClears([tap()], [row({ dates: ["2026-10-04", "2026-10-12"] })], []), [{ tapId: "tap-1", status: "bank_row" }]);
  assert.deepEqual(planWaitingTapClears([tap()], [row({ dates: ["2026-10-13"] })], []), []);
  assert.deepEqual(planWaitingTapClears([tap()], [row({ accountId: "acct-citi" })], []), []);
  assert.deepEqual(planWaitingTapClears([tap()], [row({ description: "STARBUCKS SEMINYAK" })], []), []);
  // A card for other currencies: its payment-app row ("AMAZE*" and the shop
  // cut short) clears the tap too.
  const abroad = tap({ otherCurrencyAccountId: "acct-citi", merchant: "E-Mart Yongsan" });
  assert.deepEqual(planWaitingTapClears([abroad], [row({ accountId: "acct-citi", description: "AMAZE*E-MARTYONGS", dates: ["2026-10-06"] })], []), [{ tapId: "tap-1", status: "bank_row" }]);
  assert.deepEqual(planWaitingTapClears([tap({ status: "not_a_payment" })], [row()], []), []);
});

test("a certified statement covering the tap's day on every card it could be on, without its row, clears it", () => {
  const statement = (overrides = {}) => ({ accountId: "acct-uob", startDate: "2026-09-13", endDate: "2026-10-12", ...overrides });
  assert.deepEqual(planWaitingTapClears([tap()], [], [statement()]), [{ tapId: "tap-1", status: "statement_no_match" }]);
  assert.deepEqual(planWaitingTapClears([tap()], [], [statement({ endDate: "2026-10-04" })]), []);
  assert.deepEqual(planWaitingTapClears([tap()], [], [statement({ accountId: "acct-citi" })]), []);
  const abroad = tap({ otherCurrencyAccountId: "acct-citi" });
  assert.deepEqual(planWaitingTapClears([abroad], [], [statement()]), []);
  assert.deepEqual(planWaitingTapClears([abroad], [], [statement(), statement({ accountId: "acct-citi", startDate: "2026-09-25", endDate: "2026-10-24" })]), [{ tapId: "tap-1", status: "statement_no_match" }]);
});

test("a statement with no printed start covers the month before its end", () => {
  assert.equal(fallbackStatementStart("2026-10-12"), "2026-09-13");
  assert.equal(fallbackStatementStart("2026-03-31"), "2026-03-01");
  assert.equal(fallbackStatementStart("2026-01-31"), "2026-01-01");
});
