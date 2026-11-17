// An Ask card saved with no connection (docs/flows/ask-flow.md "No
// connection"): a plain expense waits on this phone in the quick pad's
// "Waiting to send" list (cash-queue.js) and sends itself when the
// connection is back. It is one /api/entries/create request whose
// `ask:<card id>` reference makes a repeat return the entry already made,
// so it lands exactly once. A card on Splits, a transfer or income needs
// more than that one request (or links to another entry), so it never
// waits: the card stays for the person to save again.

import { buildCreateEntryBody } from "./entry-create-request";
import { ENTRY_CREATE_ENDPOINT } from "./cash-queue";

/** True when a card's save can wait on this phone. */
export function canCardWait(card, createDraft) {
  return Boolean(
    card
    && card.variant === "expense"
    && !createDraft.addToSplits
    && createDraft.entryType === "expense"
    && typeof createDraft.externalReference === "string"
    && createDraft.externalReference.startsWith("ask:")
  );
}

/**
 * The waiting item for a card's save: its reference is its request id, so
 * keeping it twice (two taps on Save) keeps it once.
 * @returns {import("./cash-queue").WaitingCash}
 */
export function waitingItemForCard(createDraft, { currency = "SGD", now = new Date() } = {}) {
  return {
    requestId: createDraft.externalReference,
    endpoint: ENTRY_CREATE_ENDPOINT,
    body: buildCreateEntryBody(createDraft),
    label: { description: createDraft.description, amountMinor: createDraft.amountMinor, currency },
    queuedAt: now.toISOString()
  };
}
