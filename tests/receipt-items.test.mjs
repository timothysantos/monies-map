// Items on a receipt and whose each one is (DOMAIN.md "Receipt Items";
// docs/flows/ask-flow.md "Items and whose they are"). Near-real receipts
// with invented shops and amounts: a Japanese convenience store whose prices
// include tax, a stationery shop with a member discount, a restaurant bill
// for two with service charge and GST on top, and a card slip with no items.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { finalizeReceiptRead } from "../src/domain/receipt-read.ts";
import { readReceiptOcrText } from "../src/domain/receipt-ocr-text.ts";
import { classifyReceiptLine, readReceiptItems, receiptItemNoteLines, receiptItemShares } from "../src/domain/receipt-items.ts";
import { applyReceiptRead, buildCardCreateDraft, cardShares, createAskCard, setCardField, setShare } from "../src/client/ask-card-model.js";
import { setReceiptItemOwner } from "../src/client/ask-receipt-items-card.js";

const TODAY = "2026-11-22";
const TIM = "person-tim";
const JOYCE = "person-joyce";

async function fixture(name) {
  return readFile(new URL(`./fixtures/receipts/${name}`, import.meta.url), "utf8");
}

async function aiRead(name) {
  const { raw } = JSON.parse(await fixture(name));
  return finalizeReceiptRead(raw, { today: TODAY, source: "ai" });
}

const context = {
  today: TODAY,
  viewId: TIM,
  accounts: [
    { id: "acct-uob", name: "UOB One", currency: "SGD", isActive: true },
    { id: "acct-travel", name: "Travel card", currency: "SGD", isActive: true, last4: "5150" }
  ],
  categories: [{ name: "Other" }, { name: "Food & Drinks" }],
  people: [{ id: TIM, name: "Tim" }, { id: JOYCE, name: "Joyce" }],
  defaultAccountPriorityIds: ["acct-uob"]
};

test("a Japanese convenience-store receipt: the tax lines are already in the prices, so they show but are not added", async () => {
  const read = await aiRead("jp-konbini-read.json");
  const items = readReceiptItems(read);
  assert.equal(items.status, "ok");
  assert.equal(items.totalMinor, 103_000);
  assert.equal(items.currency, "JPY");
  assert.deepEqual(items.items.map((item) => [item.description, item.amountMinor, item.kind, item.counted]), [
    ["おにぎり 鮭", 16_000, "item", true],
    ["おにぎり 梅", 15_000, "item", true],
    ["緑茶 500ml", 14_000, "item", true],
    ["たまごサンド", 34_000, "item", true],
    ["缶ビール 350ml", 24_000, "item", true],
    ["(8%対象 内消費税)", 5_800, "tax", false],
    ["(10%対象 内消費税)", 2_100, "tax", false]
  ]);
  assert.deepEqual(receiptItemNoteLines(items), [
    "Receipt items:",
    "- おにぎり 鮭 JPY 160",
    "- おにぎり 梅 JPY 150",
    "- 緑茶 500ml JPY 140",
    "- たまごサンド JPY 340",
    "- 缶ビール 350ml JPY 240",
    "- (8%対象 内消費税) JPY 58 (included)",
    "- (10%対象 内消費税) JPY 21 (included)"
  ]);
});

test("a stationery receipt read on the device: the member discount is its own line and the lines add up", async () => {
  const read = readReceiptOcrText(await fixture("sg-stationery-discount.txt"), { today: TODAY, defaultCurrency: "SGD", withAdjustments: true });
  assert.equal(read.merchant.value, "PAPER & QUILL STATIONERS");
  assert.deepEqual(read.total, { amountMinor: 2_970, currency: "SGD", confidence: "medium" });
  const items = readReceiptItems(read);
  assert.equal(items.status, "ok");
  assert.deepEqual(items.items.map((item) => [item.description, item.quantity, item.amountMinor, item.kind]), [
    ["A5 DOT GRID NOTEBOOK", null, 1_290, "item"],
    ["GEL PEN 0.5 BLACK", 3, 750, "item"],
    ["WASHI TAPE SET", null, 680, "item"],
    ["ERASER", null, 120, "item"],
    ["STICKY NOTES 3x3", null, 460, "item"],
    ["MEMBER DISC 10%", null, -330, "discount"]
  ]);
});

test("a restaurant bill for two, read by AI or on the device, gives the same items with service and GST on top", async () => {
  const fromAi = readReceiptItems(await aiRead("sg-restaurant-for-two-read.json"));
  const fromDevice = readReceiptItems(readReceiptOcrText(await fixture("sg-restaurant-for-two.txt"), { today: TODAY, defaultCurrency: "SGD", withAdjustments: true }));
  for (const items of [fromAi, fromDevice]) {
    assert.equal(items.status, "ok");
    assert.equal(items.totalMinor, 4_580);
    assert.deepEqual(items.items.map((item) => [item.amountMinor, item.kind]), [[890, "item"], [750, "item"], [560, "item"], [1_200, "item"], [420, "item"], [382, "service"], [378, "tax"]]);
  }
  // Without the lines after the subtotal (the old on-device reading) they do
  // not add up, so only the total would show.
  const plain = readReceiptOcrText(await fixture("sg-restaurant-for-two.txt"), { today: TODAY, defaultCurrency: "SGD" });
  assert.equal(readReceiptItems(plain).status, "unreliable");
});

test("shares to the cent: own items, half of each shared one, service and GST in proportion; the second person has the rest", async () => {
  const items = readReceiptItems(await aiRead("sg-restaurant-for-two-read.json"));
  // Tim: nasi lemak; Joyce: mee goreng and chendol; teh tarik and satay shared.
  const owners = [TIM, JOYCE, "shared", "shared", JOYCE, "shared", "shared"];
  // Tim's items 8.90 + 2.80 + 6.00 = 17.70 of 38.20; 17.70 x 45.80 / 38.20 = 21.2214... -> 21.22.
  assert.deepEqual(receiptItemShares(items.items, owners, [TIM, JOYCE], 4_580), { firstMinor: 2_122, secondMinor: 2_458 });
  // All shared is half each.
  assert.deepEqual(receiptItemShares(items.items, items.items.map(() => "shared"), [TIM, JOYCE], 4_580), { firstMinor: 2_290, secondMinor: 2_290 });
  // An odd cent: rounded down for the first person, the rest to the second.
  const odd = [{ description: "Kopi", quantity: 1, amountMinor: 101, kind: "item", counted: true }];
  assert.deepEqual(receiptItemShares(odd, ["shared"], [TIM, JOYCE], 101), { firstMinor: 50, secondMinor: 51 });
  // In another currency: the same proportions of the wallet's amount.
  assert.deepEqual(receiptItemShares(items.items, owners, [TIM, JOYCE], 3_000), { firstMinor: 1_390, secondMinor: 1_610 });
  // Nothing to share by: no counted item.
  assert.equal(receiptItemShares([{ description: "GST", quantity: null, amountMinor: 378, kind: "tax", counted: true }], ["shared"], [TIM, JOYCE], 378), null);
});

test("a card slip with no items, and lines that do not add up, show the total only", async () => {
  const slip = readReceiptOcrText(await fixture("sg-card-slip.txt"), { today: TODAY, defaultCurrency: "SGD", withAdjustments: true });
  assert.equal(slip.total.amountMinor, 640);
  assert.equal(readReceiptItems(slip).status, "none");
  const read = await aiRead("sg-restaurant-for-two-read.json");
  // One line misread: 7.50 read as 1.50.
  const misread = { ...read, lineItems: read.lineItems.map((item) => (item.amountMinor === 750 ? { ...item, amountMinor: 150 } : item)) };
  assert.equal(readReceiptItems(misread).status, "unreliable");
  // A line whose amount could not be read.
  const blank = { ...read, lineItems: [...read.lineItems, { description: "Extra rice", amountMinor: null, quantity: 1 }] };
  assert.equal(readReceiptItems(blank).status, "unreliable");
  assert.equal(readReceiptItems({ ...read, lineItems: [] }).status, "none");
});

test("lines are told apart by their words and sign, never by a model's label", () => {
  assert.equal(classifyReceiptLine("Svc Chg 10%", 382), "service");
  assert.equal(classifyReceiptLine("GST 9%", 378), "tax");
  assert.equal(classifyReceiptLine("PB1 10%", 1_300_000), "tax");
  assert.equal(classifyReceiptLine("Rounding", -2), "rounding");
  assert.equal(classifyReceiptLine("Member disc", -50), "discount");
  assert.equal(classifyReceiptLine("値引", -10_000), "discount");
  assert.equal(classifyReceiptLine("Teh Tarik", 280), "item");
});

test("on the card: untouched items keep the card's split; a tap makes the shares from the items; Save writes them and the items into the note", async () => {
  const read = await aiRead("sg-restaurant-for-two-read.json");
  let card = applyReceiptRead(createAskCard(context), read, context);
  assert.equal(card.receiptItems.items.length, 7);
  assert.equal(card.fields.amountMinor, 4_580);
  card = setShare(card, { on: true, splitGroupId: "" }, context);
  assert.deepEqual(cardShares(card, context).map((share) => share.amountMinor), [2_290, 2_290]);
  for (const [index, owner] of [[0, TIM], [1, JOYCE], [4, JOYCE]]) card = setReceiptItemOwner(card, index, owner, context);
  assert.deepEqual(cardShares(card, context).map((share) => share.amountMinor), [2_122, 2_458]);
  const draft = buildCardCreateDraft(card, context, { splitGroups: [] });
  assert.equal(draft.splitAmountMinor, 2_122);
  assert.deepEqual(draft.splits.map((split) => split.amountMinor), [2_122, 2_458]);
  assert.equal(draft.note, [
    "Receipt items:",
    "- Nasi Lemak Set SGD 8.90 · Tim",
    "- Mee Goreng SGD 7.50 · Joyce",
    "- 2× Teh Tarik SGD 5.60 · shared",
    "- Satay 10 sticks SGD 12.00 · shared",
    "- Chendol SGD 4.20 · Joyce",
    "- Svc Chg 10% SGD 3.82",
    "- GST 9% SGD 3.78"
  ].join("\n"));
  // A share the person sets by hand wins over the items.
  const manual = setCardField(card, { splitBasisPoints: 7000 }, context);
  assert.equal(manual.receiptItems.touched, false);
  assert.deepEqual(cardShares(manual, context).map((share) => share.amountMinor), [3_206, 1_374]);
  // A tax line or a bad index takes no owner.
  assert.equal(setReceiptItemOwner(card, 6, TIM, context), card);
  assert.equal(setReceiptItemOwner(card, 40, TIM, context), card);
});

test("on the card: a receipt whose items do not add up says so and keeps the total; one person's purchase keeps the items in its note without whose", async () => {
  const read = await aiRead("sg-restaurant-for-two-read.json");
  const misread = { ...read, lineItems: read.lineItems.slice(1) };
  const unreliable = applyReceiptRead(createAskCard(context), misread, context);
  assert.equal(unreliable.receiptItems, null);
  assert.equal(unreliable.receiptItemsUnreliable, true);
  assert.equal(unreliable.fields.amountMinor, 4_580);
  assert.equal(buildCardCreateDraft(unreliable, context).note, "");

  const mine = applyReceiptRead(createAskCard(context), read, context);
  const note = buildCardCreateDraft(setCardField(mine, { note: "Dinner" }, context), context).note;
  assert.ok(note.startsWith("Dinner\nReceipt items:\n- Nasi Lemak Set SGD 8.90\n"));
  assert.ok(!note.includes("·"));
});
