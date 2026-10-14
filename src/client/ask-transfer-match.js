// The other side of a transfer an Ask draft card is about to save
// (docs/flows/ask-flow.md "Transfers: the other side"). Pure: which cards
// ask the server (GET /api/transfers/draft-candidates, the Entries transfer
// dialog's own search started from the draft), which candidates the card
// offers, which one is selected, and the pair command's body once the entry
// exists. Saving still creates the entry through the composer's create path;
// the link is then the existing /api/transfers/link command.

import { chooseTransferOptions } from "../domain/transfer-candidates";

export const NO_OTHER_SIDE = "none";

/**
 * The query to ask the server with, or null when there is nothing to ask:
 * only a draft transfer with an amount, a date and a wallet.
 * @returns {null | { date: string, accountId: string, amountMinor: number, transferDirection: "in" | "out" }}
 */
export function transferMatchRequestFor(card) {
  if (!card || card.variant !== "transfer" || card.status !== "draft") {
    return null;
  }
  const { amountMinor, date, accountId, transferDirection } = card.fields;
  if (!(amountMinor > 0) || !date || !accountId) {
    return null;
  }
  return { date, accountId, amountMinor, transferDirection: transferDirection === "in" ? "in" : "out" };
}

/** The server's answer, checked; anything else is no candidates. */
export function readTransferMatchResponse(body) {
  if (body?.ok !== true || !Array.isArray(body.candidates)) {
    return null;
  }
  const texts = ["entryId", "date", "description", "accountId", "accountName", "categoryName"];
  return body.candidates
    .filter((candidate) => candidate && typeof candidate === "object" && texts.every((key) => typeof candidate[key] === "string") && Number.isInteger(candidate.amountMinor) && candidate.amountMinor > 0)
    .slice(0, 4)
    .map((candidate) => ({
      entryId: candidate.entryId,
      date: candidate.date,
      description: candidate.description,
      accountId: candidate.accountId,
      accountName: candidate.accountName,
      categoryName: candidate.categoryName,
      amountMinor: candidate.amountMinor
    }));
}

/**
 * What the card offers: the best match first (selected unless the person
 * chose otherwise), up to 3 more, and always "no other side yet". When the
 * card names the other wallet, only its rows are offered; none there keeps
 * the others and reports the wallet.
 * @returns {{ options: any[], walletMissed: string, selectedId: string }}
 */
export function resolveTransferMatch(card, candidates) {
  const { options, walletMissed } = chooseTransferOptions(/** @type {any[]} */ (candidates ?? []), { walletId: card.fields.transferAccountId || null });
  const wanted = card.transferMatchId ?? "";
  const selectedId = wanted === NO_OTHER_SIDE
    ? NO_OTHER_SIDE
    : options.find((option) => option.entryId === wanted)?.entryId ?? options[0]?.entryId ?? NO_OTHER_SIDE;
  return { options, walletMissed: walletMissed ? card.fields.transferAccountName || "" : "", selectedId };
}

/**
 * The pair command's body for the saved entry and the chosen other side:
 * money leaves the From side, as the card's direction says.
 */
export function transferLinkBody(card, savedEntryId, otherEntryId) {
  return card.fields.transferDirection === "in"
    ? { fromEntryId: otherEntryId, toEntryId: savedEntryId }
    : { fromEntryId: savedEntryId, toEntryId: otherEntryId };
}
