// Items on a receipt, and whose each one is (DOMAIN.md "Receipt Items";
// docs/flows/ask-flow.md "Items and whose they are"). Pure and shared by the
// page and the tests: no network, storage or model.
//
// The lines come only from the receipt read (the AI reader's or the
// in-browser OCR's, both through finalizeReceiptRead): nothing here makes up
// an amount. They are shown only when they add up to the receipt's total
// within rounding (RECEIPT_ITEMS_TOLERANCE_*): every line, or every line but
// the tax lines when the prices already include the tax (a Japanese
// receipt's 内消費税, "incl. GST"). Otherwise the card shows the total only
// and says the items could not be read reliably.
//
// Shares, to the cent: each person has their own items and half of each
// shared item; tax, service, discounts and rounding (everything the total
// has that is not an item) are spread in proportion to that. Worked out
// exactly, the first person in household order is rounded down to the cent
// and the second has the rest, so the two always add up to the amount.

import {
  RECEIPT_ITEMS_NOTE_HEADER,
  RECEIPT_ITEMS_TOLERANCE_MINOR,
  RECEIPT_ITEMS_TOLERANCE_WHOLE_UNITS
} from "./receipt-batch-config";

export type ReceiptItemKind = "item" | "tax" | "service" | "discount" | "rounding";

export interface ReceiptItem {
  description: string;
  quantity: number | null;
  // Signed minor units as read (a discount is negative).
  amountMinor: number;
  kind: ReceiptItemKind;
  // False for a tax line the prices already include: shown, not added.
  counted: boolean;
}

export type ReceiptItemsResult =
  | { status: "none" }
  | { status: "unreliable" }
  | { status: "ok"; items: ReceiptItem[]; totalMinor: number; currency: string };

// "shared", or the id of the person whose item it is.
export type ReceiptItemOwner = string;

interface ReadLike {
  total?: { amountMinor?: number | null; currency?: string | null } | null;
  lineItems?: Array<{ description?: string | null; amountMinor?: number | null; quantity?: number | null }> | null;
}

const ZERO_DECIMAL = new Set(["IDR", "JPY", "KRW", "VND"]);
const TAX = /\b(gst|vat|tax|pb1|ppn)\b|消費税|内税|外税/i;
const SERVICE = /\b(svc|service|serv\.? ?chg|s\/c)\b|サービス料/i;
const ROUNDING = /\b(round(ing)?|rnd|adj(ustment)?)\b|端数/i;
const DISCOUNT = /\b(disc(ount)?|less|promo|member|savings?|coupon|voucher)\b|値引|割引/i;

export function classifyReceiptLine(description: string, amountMinor: number): ReceiptItemKind {
  if (ROUNDING.test(description)) return "rounding";
  if (amountMinor < 0 || DISCOUNT.test(description)) return "discount";
  if (SERVICE.test(description)) return "service";
  if (TAX.test(description)) return "tax";
  return "item";
}

export function itemsTolerance(currency: string | null | undefined) {
  return ZERO_DECIMAL.has(String(currency ?? "").toUpperCase()) ? RECEIPT_ITEMS_TOLERANCE_WHOLE_UNITS * 100 : RECEIPT_ITEMS_TOLERANCE_MINOR;
}

/** The receipt's lines when they add up to its total; else why not. */
export function readReceiptItems(read: ReadLike | null | undefined, householdCurrency = "SGD"): ReceiptItemsResult {
  const totalMinor = read?.total?.amountMinor;
  const lines = Array.isArray(read?.lineItems) ? read.lineItems : [];
  if (!lines.length || !Number.isInteger(totalMinor) || !(Number(totalMinor) > 0)) return { status: "none" };
  const total = Number(totalMinor);
  const currency = String(read?.total?.currency ?? householdCurrency).toUpperCase();
  // A line with no readable amount means the sum cannot be trusted.
  if (lines.some((line) => !Number.isInteger(line?.amountMinor))) return { status: "unreliable" };
  const items: ReceiptItem[] = lines.map((line) => {
    const amountMinor = Number(line.amountMinor);
    const description = String(line.description ?? "").trim();
    return { description, quantity: line.quantity ?? null, amountMinor, kind: classifyReceiptLine(description, amountMinor), counted: true };
  });
  if (!items.some((item) => item.kind === "item" && item.amountMinor > 0)) return { status: "unreliable" };
  // One line that is the total itself (a card slip's "AMOUNT") is no list.
  if (items.length === 1 && items[0].amountMinor === total) return { status: "none" };
  const tolerance = itemsTolerance(currency);
  const sum = (list: ReceiptItem[]) => list.reduce((total, item) => total + item.amountMinor, 0);
  if (Math.abs(total - sum(items)) <= tolerance) {
    return { status: "ok", items, totalMinor: total, currency };
  }
  // Prices that already include the tax: the tax lines are shown, not added.
  const withoutTax = items.filter((item) => item.kind !== "tax");
  if (withoutTax.length < items.length && Math.abs(total - sum(withoutTax)) <= tolerance) {
    return { status: "ok", items: items.map((item) => (item.kind === "tax" ? { ...item, counted: false } : item)), totalMinor: total, currency };
  }
  return { status: "unreliable" };
}

/**
 * Each person's share of `amountMinor` (the entry's amount: the receipt's
 * total, or what it came to in the wallet's currency) from whose each item
 * is. `people` are the household's two people in household order.
 */
export function receiptItemShares(
  items: ReceiptItem[],
  owners: ReceiptItemOwner[],
  people: [string, string],
  amountMinor: number
): { firstMinor: number; secondMinor: number } | null {
  if (!(amountMinor > 0)) return null;
  // Doubled, so half a shared item stays a whole number.
  let first = 0n;
  let second = 0n;
  items.forEach((item, index) => {
    if (item.kind !== "item" || !item.counted) return;
    const amount = BigInt(item.amountMinor);
    const owner = owners[index] ?? "shared";
    if (owner === people[0]) first += 2n * amount;
    else if (owner === people[1]) second += 2n * amount;
    else {
      first += amount;
      second += amount;
    }
  });
  const whole = first + second;
  if (whole <= 0n) return null;
  const firstMinor = Number((first * BigInt(amountMinor)) / whole);
  return { firstMinor, secondMinor: amountMinor - firstMinor };
}

function moneyText(amountMinor: number, currency: string) {
  const major = amountMinor / 100;
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  return `${currency} ${new Intl.NumberFormat("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(major)}`;
}

/**
 * The items as note lines (the entry's note keeps them; no new table): a
 * header, then one line each with its amount and, for a shared purchase,
 * whose it is. Bounded by the caller's note limit.
 */
export function receiptItemNoteLines(
  result: Extract<ReceiptItemsResult, { status: "ok" }>,
  options: { owners?: ReceiptItemOwner[]; names?: Record<string, string>; sharedWord?: string; includedWord?: string } = {}
) {
  const lines = [RECEIPT_ITEMS_NOTE_HEADER];
  result.items.forEach((item, index) => {
    const quantity = item.quantity && item.quantity > 1 ? `${item.quantity}× ` : "";
    const amount = moneyText(item.amountMinor, result.currency);
    const owner = options.owners?.[index];
    const whose = options.owners && item.kind === "item" && item.counted
      ? ` · ${owner && options.names?.[owner] ? options.names[owner] : options.sharedWord ?? "shared"}`
      : "";
    const included = item.counted ? "" : ` (${options.includedWord ?? "included"})`;
    lines.push(`- ${quantity}${item.description} ${amount}${included}${whose}`);
  });
  return lines;
}
