// A receipt's items on the Ask entry card (docs/flows/ask-flow.md "Items
// and whose they are"). Pure: the card model (ask-card-model.js) calls these
// when a receipt fills a card, when an item's owner is tapped, when the
// amount or Splits changes, and when the card is saved.
//
// card.receiptItems: { items, totalMinor, currency, owners, touched } when
// the receipt's lines add up to its total (readReceiptItems), else null;
// card.receiptItemsUnreliable: the receipt listed items that did not add up.
// Owners start "shared"; until the person taps one, the card keeps the split
// it had (half each, or the shop's habit). After a tap the first person's
// exact share comes from the items (receiptItemShares).

import { readReceiptItems, receiptItemNoteLines, receiptItemShares } from "../domain/receipt-items";
import { RECEIPT_NOTE_MAX_CHARS } from "../domain/receipt-batch-config";

export const SHARED_ITEM = "shared";

export function receiptItemsFromRead(receipt) {
  const result = readReceiptItems(receipt);
  if (result.status === "ok") {
    return { receiptItems: { ...result, owners: result.items.map(() => SHARED_ITEM), touched: false }, receiptItemsUnreliable: false };
  }
  return { receiptItems: null, receiptItemsUnreliable: result.status === "unreliable" };
}

function twoPeople(context) {
  const people = (context.people ?? []).slice(0, 2);
  return people.length === 2 ? people : null;
}

/** The card with its first person's share worked out from the items, once the person has said whose any item is. */
export function withItemShares(card, context) {
  const items = card.receiptItems;
  const people = twoPeople(context);
  if (!items?.touched || !card.share?.on || !people || card.variant !== "expense") return card;
  const amount = Number(card.fields.amountMinor) || 0;
  const shares = receiptItemShares(items.items, items.owners, [people[0].id, people[1].id], amount);
  if (!shares) return card;
  return {
    ...card,
    fields: {
      ...card.fields,
      splitAmountMinor: shares.firstMinor,
      splitBasisPoints: Math.round((shares.firstMinor / amount) * 10000)
    }
  };
}

export function setReceiptItemOwner(card, index, owner, context) {
  const items = card.receiptItems;
  if (card.status !== "draft" || !items || !items.items[index] || items.items[index].kind !== "item") return card;
  const owners = items.owners.slice();
  owners[index] = owner || SHARED_ITEM;
  return withItemShares({ ...card, touched: true, saveError: "", receiptItems: { ...items, owners, touched: true } }, context);
}

/**
 * The note Save writes: the person's own note, then the receipt's items
 * (with whose each is when the entry goes on Splits by items), bounded.
 */
export function noteWithReceiptItems(card, context, { maxChars }) {
  const own = String(card.fields.note ?? "");
  const items = card.receiptItems;
  if (!items || card.variant !== "expense") return own;
  const byItems = items.touched && card.share?.on;
  const names = Object.fromEntries((context.people ?? []).map((person) => [person.id, person.name]));
  let lines = receiptItemNoteLines(items, byItems ? { owners: items.owners, names } : {});
  let block = lines.join("\n");
  const room = Math.min(RECEIPT_NOTE_MAX_CHARS, maxChars - own.length - (own ? 1 : 0));
  while (block.length > room && lines.length > 1) {
    lines = lines.slice(0, -1);
    block = `${lines.join("\n")}\n…`;
  }
  if (block.length > room) return own;
  return own.trim() ? `${own.trimEnd()}\n${block}` : block;
}

/** The note lines a receipt's match sends with it (no owners: the entry is already there). */
export function matchNoteLines(read) {
  const result = readReceiptItems(read);
  return result.status === "ok" ? receiptItemNoteLines(result) : [];
}
