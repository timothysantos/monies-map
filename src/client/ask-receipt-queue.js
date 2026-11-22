// The receipt queue on the Ask page (docs/flows/ask-flow.md "Many receipts
// at once"): several receipt photos sent in one go, read one after another,
// then reviewed one at a time with the existing entry card or change card.
// Pure: no React, fetch or DOM. The conversation keeps the queue as
// `conversation.receipts` (ask-conversation-store.js); photos are never in
// it, only what each receipt read validated and what happened to it.
//
// An item moves through:
//   waiting -> reading -> ready -> open -> saved | updated | skipped
//                      \-> failed (Try again: waiting; Type it instead: open)
//   duplicate: the same photo twice, or a receipt whose entry this
//   conversation already saved or updated from a receipt.

export const RECEIPT_STATUSES = Object.freeze(["waiting", "reading", "ready", "open", "failed", "saved", "updated", "skipped", "duplicate"]);
const DONE = new Set(["saved", "updated", "skipped", "duplicate"]);
const READ_FIELDS = ["source", "merchant", "date", "total", "cardLast4", "lineItems", "questions"];

let nextReceiptId = 0;
const RECEIPT_ID_PREFIX = Math.random().toString(36).slice(2, 8);
export function newReceiptId() {
  nextReceiptId += 1;
  return `receipt-${RECEIPT_ID_PREFIX}-${nextReceiptId}`;
}

export function emptyReceipts() {
  return { items: [], readOnDevice: false, deviceNoted: false, autoNext: true };
}

function receiptsOf(value) {
  return value && Array.isArray(value.items) ? value : emptyReceipts();
}

/**
 * Adds one go of photos. `photos` are `{ id, fingerprint }` in the order
 * sent, already cut to the batch limit. A photo whose fingerprint is one the
 * queue already has is flagged instead of read twice. A queue whose items
 * are all finished starts afresh.
 */
export function addReceiptPhotos(current, photos) {
  const base = receiptsOf(current);
  const finished = base.items.every((item) => DONE.has(item.status));
  const kept = finished ? [] : base.items;
  // Photos of earlier goes in this conversation, by fingerprint only.
  const earlier = [...(Array.isArray(base.earlier) ? base.earlier : []), ...(finished ? base.items.map((item) => item.fingerprint).filter(Boolean) : [])].slice(-40);
  const seen = new Map([...earlier.map((fingerprint) => [fingerprint, ""]), ...kept.filter((item) => item.fingerprint).map((item) => [item.fingerprint, item.id])]);
  const added = [];
  for (const photo of photos) {
    const twin = photo.fingerprint ? seen.get(photo.fingerprint) : undefined;
    added.push(twin !== undefined
      ? { id: photo.id, fingerprint: photo.fingerprint, status: "duplicate", duplicateOf: { kind: "photo", itemId: twin }, read: null, match: null, entryId: "" }
      : { id: photo.id, fingerprint: photo.fingerprint ?? "", status: "waiting", read: null, match: null, entryId: "" });
    if (photo.fingerprint && twin === undefined) seen.set(photo.fingerprint, photo.id);
  }
  return {
    ...(finished ? emptyReceipts() : base),
    earlier,
    items: [...kept, ...added],
    autoNext: finished ? true : base.autoNext
  };
}

function patchItem(current, id, patch) {
  const base = receiptsOf(current);
  if (!base.items.some((item) => item.id === id)) return base;
  return { ...base, items: base.items.map((item) => (item.id === id ? { ...item, ...(typeof patch === "function" ? patch(item) : patch) } : item)) };
}

export function findReceipt(current, id) {
  return receiptsOf(current).items.find((item) => item.id === id) ?? null;
}

export function markReceiptReading(current, id) {
  return patchItem(current, id, { status: "reading" });
}

// A read with nothing usable on it (no shop, total or date) is a failure:
// the item says "Couldn't read this one".
export function hasUsableRead(read) {
  return Boolean(read && (read.merchant?.value || read.total?.amountMinor || read.date?.value));
}

export function markReceiptRead(current, id, read) {
  if (!hasUsableRead(read)) {
    return patchItem(current, id, { status: "failed", read: null, match: null });
  }
  return patchItem(current, id, { status: "ready", read: keepReadFields(read), match: null });
}

export function markReceiptFailed(current, id) {
  return patchItem(current, id, { status: "failed", read: null, match: null });
}

// The entries this conversation already saved or updated from a receipt.
export function receiptEntryIds(current) {
  return new Set(receiptsOf(current).items.filter((item) => (item.status === "saved" || item.status === "updated") && item.entryId).map((item) => item.entryId));
}

/**
 * What the server found for a ready receipt (`{ kind: "none" | "one" |
 * "several" }`, or `{ kind: "unchecked" }` when it could not be asked). A
 * single match on an entry this conversation already saved or updated from
 * a receipt makes the item a duplicate of that receipt.
 */
export function setReceiptMatch(current, id, match) {
  const base = receiptsOf(current);
  const used = receiptEntryIds(base);
  if (match?.kind === "one" && match.option?.kind === "entry" && used.has(match.option.id)) {
    const twin = base.items.find((item) => item.entryId === match.option.id && item.id !== id);
    return patchItem(base, id, { match, status: "duplicate", duplicateOf: { kind: "entry", itemId: twin?.id ?? "", entryId: match.option.id } });
  }
  return patchItem(base, id, { match: match ?? { kind: "unchecked" } });
}

export function openReceipt(current, id) {
  const base = receiptsOf(current);
  // One open at a time: one left open (a reload in between) goes back to ready.
  return {
    ...base,
    items: base.items.map((item) => (item.id === id ? { ...item, status: "open" } : item.status === "open" ? { ...item, status: "ready" } : item))
  };
}

/**
 * The open receipt's outcome: "saved" (a new entry), "updated" (an entry or
 * waiting tap already there), "skipped" (Not now). Saving or updating waits
 * for the person's Next; Not now goes straight on to the next one.
 */
export function finishReceipt(current, id, outcome, entryId = "") {
  const next = patchItem(current, id, { status: outcome, ...(entryId ? { entryId } : {}) });
  return { ...next, autoNext: outcome === "skipped" };
}

// Undo of a saved receipt card gives the receipt back to review.
export function reopenReceipt(current, id) {
  return patchItem(current, id, { status: "open", entryId: "" });
}

// A left-out receipt (a duplicate) has had its line said in the conversation.
export function noteReceipt(current, id) {
  return patchItem(current, id, { noted: true });
}

// "Back to the ones left": the receipts put off with Not now come back to
// review, in their order.
export function reviewSkippedReceipts(current) {
  const base = receiptsOf(current);
  return { ...base, autoNext: true, items: base.items.map((item) => (item.status === "skipped" ? { ...item, status: "ready" } : item)) };
}

export function retryReceipt(current, id) {
  return patchItem(current, id, { status: "waiting", read: null, match: null });
}

export function allowAutoNext(current, value = true) {
  return { ...receiptsOf(current), autoNext: value };
}

export function markReadOnDevice(current) {
  return { ...receiptsOf(current), readOnDevice: true };
}

export function markDeviceNoted(current) {
  return { ...receiptsOf(current), deviceNoted: true };
}

export function nextWaitingReceipt(current) {
  return receiptsOf(current).items.find((item) => item.status === "waiting") ?? null;
}

// The next receipt to review: read, with the server's answer (or none).
export function nextReadyReceipt(current) {
  return receiptsOf(current).items.find((item) => item.status === "ready" && item.match) ?? null;
}

export function openReceiptItem(current) {
  return receiptsOf(current).items.find((item) => item.status === "open") ?? null;
}

/** Counts for the progress line ("Reading 3 of 7", "Receipt 2 of 7"). */
export function receiptProgress(current) {
  const items = receiptsOf(current).items;
  const total = items.length;
  const readingIndex = items.findIndex((item) => item.status === "reading");
  const openIndex = items.findIndex((item) => item.status === "open");
  const left = items.filter((item) => item.status === "ready").length;
  const done = items.filter((item) => DONE.has(item.status)).length;
  const working = items.some((item) => item.status === "waiting" || item.status === "reading");
  return {
    total,
    reading: readingIndex >= 0 ? readingIndex + 1 : 0,
    open: openIndex >= 0 ? openIndex + 1 : 0,
    left,
    done,
    skipped: items.filter((item) => item.status === "skipped").length,
    working,
    failed: items.filter((item) => item.status === "failed").length,
    finished: total > 0 && items.every((item) => DONE.has(item.status))
  };
}

// Only the fields a receipt read validated, as text and numbers.
function keepReadFields(read) {
  const kept = {};
  for (const key of READ_FIELDS) {
    if (read[key] !== undefined) kept[key] = read[key];
  }
  return JSON.parse(JSON.stringify(kept));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The queue as the conversation store keeps it, and as it reads it back
 * after a reload: no photo, no URL, and an item that was waiting or being
 * read has lost its photo, so it is "Couldn't read this one" with only Type
 * it instead (`lost`).
 */
export function readStoredReceipts(value, { reloaded = false } = {}) {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  const items = value.items
    .filter((item) => isObject(item) && typeof item.id === "string" && RECEIPT_STATUSES.includes(item.status))
    .slice(0, 40)
    .map((item) => {
      const read = isObject(item.read) && isObject(item.read.merchant) && isObject(item.read.total) && isObject(item.read.date) ? item.read : null;
      const lostPhoto = reloaded && (item.status === "waiting" || item.status === "reading" || item.status === "failed");
      const status = lostPhoto ? "failed" : item.status;
      return {
        id: item.id,
        fingerprint: typeof item.fingerprint === "string" ? item.fingerprint.slice(0, 64) : "",
        status: (status === "ready" || status === "open") && !read ? "failed" : status,
        read: status === "failed" ? null : read,
        match: isObject(item.match) ? item.match : null,
        entryId: typeof item.entryId === "string" ? item.entryId : "",
        ...(isObject(item.duplicateOf) ? { duplicateOf: item.duplicateOf } : {}),
        ...(item.noted === true ? { noted: true } : {}),
        ...(lostPhoto || item.lost === true ? { lost: true } : {})
      };
    });
  if (!items.length) return null;
  const earlier = Array.isArray(value.earlier) ? value.earlier.filter((fingerprint) => typeof fingerprint === "string").map((fingerprint) => fingerprint.slice(0, 64)).slice(-40) : [];
  return { items, earlier, readOnDevice: value.readOnDevice === true, deviceNoted: value.deviceNoted === true, autoNext: value.autoNext !== false };
}
