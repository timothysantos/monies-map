import { messages } from "./copy/en-SG";

// Added by (DOMAIN.md): the server sends `addedBy` ("apple_pay_shortcut" or
// "ask") for an entry an in-app tool saved, never the reference behind it.
// These turn it into the words and glyph each surface shows.
const copy = messages.entries.source;

const PROVISIONAL_LABELS = {
  apple_pay_shortcut: copy.applePayProvisional,
  ask: copy.askProvisional
};

const ADDED_BY_LABELS = {
  apple_pay_shortcut: copy.applePayShortcut,
  ask: copy.ask
};

const GLYPHS = {
  apple_pay_shortcut: { kind: "apple-pay", label: copy.addedWithApplePay },
  ask: { kind: "ask", label: copy.addedInAsk }
};

/**
 * The bank state chip's words: a provisional entry a tool saved names the
 * tool ("Apple Pay · provisional"); a certified one and any other entry keep
 * their bank state label ("Statement certified", "Manual provisional").
 * @param {{ addedBy?: string, bankCertificationStatus?: string }} entry
 * @param {string} bankStateLabel
 */
export function bankStateChipLabel(entry, bankStateLabel) {
  if (entry?.bankCertificationStatus === "statement_certified") {
    return bankStateLabel;
  }
  return PROVISIONAL_LABELS[entry?.addedBy] ?? bankStateLabel;
}

/** "Apple Pay shortcut" or "Ask", or null when the source is not known. */
export function addedByLabel(addedBy) {
  return ADDED_BY_LABELS[addedBy] ?? null;
}

/** The list row glyph ({ kind, label }), or null. */
export function addedByGlyph(addedBy) {
  return GLYPHS[addedBy] ?? null;
}
