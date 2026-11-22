// Reading a queue of receipt photos (docs/flows/ask-flow.md "Many receipts
// at once"), one after another, never in parallel bursts. Each photo is
// made small and clean in this browser first (ask-receipt-image.js: at most
// 1,600 px, re-encoded as JPEG, no EXIF or location), read by the receipt
// reader (one model call, AI_ASSIST_VISION_UNITS allowance units), or on this
// device when the reader is off,
// over its allowance, failing or offline: from then on the rest of the go
// are read on this device too, and the page says so once. Then the server
// is asked whether the purchase is already in the ledger
// (/api/ask/receipt-match, no AI).
//
// Photos live only in this module's memory, by receipt id, until their
// receipt is read: a read photo is dropped at once, a failed one is kept for
// Try again until the tab goes. Nothing here stores, logs or caches a photo;
// the conversation store keeps only what each read validated.
//
// The loop writes through `update` (the conversation store), so it keeps
// going when the person leaves the Ask page and its results are there when
// they come back.

import { readServerChange } from "./ask-turn-api";
import { matchNoteLines } from "./ask-receipt-items-card";
import { prepareReceiptImage, readReceiptTextOnDevice } from "./ask-receipt-image";
import {
  findReceipt,
  hasUsableRead,
  markDeviceNoted,
  markReadOnDevice,
  markReceiptFailed,
  markReceiptRead,
  markReceiptReading,
  nextWaitingReceipt,
  setReceiptMatch
} from "./ask-receipt-queue";

export const RECEIPT_MATCH_ENDPOINT = "/api/ask/receipt-match";

const photos = new Map();
const running = new Set();

export function holdReceiptPhoto(id, file) {
  photos.set(id, file);
}

export function hasReceiptPhoto(id) {
  return photos.has(id);
}

export function dropReceiptPhoto(id) {
  photos.delete(id);
}

/**
 * A short fingerprint of the photo's own bytes (SHA-256), so the same photo
 * sent twice is noticed. Only the hash is kept, never the photo. "" when
 * this browser cannot hash.
 */
export async function fingerprintPhoto(file) {
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

// The receipt reader's reasons that mean "not now for the rest of this go".
// "unreadable" is about one photo only: that one is read on the device and
// the next still goes to the reader.
function readerIsOff(reason) {
  return reason !== "unreadable";
}

/** The fields the match route takes, from a receipt read; null when it has no shop, day or total. */
export function matchRequestOf(read, { householdCurrency = "SGD", noteLines = [] } = {}) {
  const merchant = read?.merchant?.value ?? "";
  const date = read?.date?.value ?? "";
  const totalMinor = read?.total?.amountMinor ?? 0;
  if (!merchant || !date || !(totalMinor > 0)) return null;
  return { merchant, date, totalMinor, currency: read.total.currency ?? householdCurrency, noteLines };
}

function readOption(option) {
  if (!option || typeof option !== "object" || typeof option.id !== "string" || !["entry", "tap"].includes(option.kind)) return null;
  const change = option.change === null ? null : readServerChange(option.change);
  if (option.change !== null && !change) return null;
  return {
    id: option.id,
    kind: option.kind,
    description: String(option.description ?? ""),
    date: String(option.date ?? ""),
    amountMinor: Number.isInteger(option.amountMinor) ? option.amountMinor : null,
    currency: String(option.currency ?? "SGD"),
    certified: option.certified === true,
    change
  };
}

/** The server's answer, checked; `{ kind: "unchecked" }` when it could not be asked or read. */
export function readReceiptMatchResponse(body) {
  const match = body?.ok ? body.match : null;
  if (match?.kind === "none") return { kind: "none" };
  if (match?.kind === "one") {
    const option = readOption(match.option);
    return option ? { kind: "one", option } : { kind: "unchecked" };
  }
  if (match?.kind === "several" && Array.isArray(match.options)) {
    const options = match.options.map(readOption).filter(Boolean).slice(0, 3);
    return options.length >= 2 ? { kind: "several", options } : options.length ? { kind: "one", option: options[0] } : { kind: "unchecked" };
  }
  return { kind: "unchecked" };
}

export async function requestReceiptMatch(receipt, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(RECEIPT_MATCH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt })
    });
    if (!response.ok) return { kind: "unchecked" };
    return readReceiptMatchResponse(await response.json().catch(() => null));
  } catch {
    return { kind: "unchecked", offline: true };
  }
}

// One on-device reader for the whole go: the OCR worker loads once.
function createDeviceReader() {
  let worker = null;
  return {
    async read(blob, today) {
      if (!worker) {
        const { createOcrWorker } = await import("./ocr-worker");
        worker = await createOcrWorker();
      }
      const result = await worker.recognize(blob);
      return readReceiptTextOnDevice(result?.data?.text ?? "", { today });
    },
    async close() {
      const current = worker;
      worker = null;
      await current?.terminate?.();
    }
  };
}

/**
 * Reads every waiting receipt of a conversation, one at a time, then asks
 * whether each is already in the ledger. One loop per conversation: a second
 * call while one runs does nothing (the running loop picks new photos up).
 *
 * deps:
 * - read(): the conversation's receipts now; update(fn): changes them
 * - readReceipt(blob): the receipt reader ({ ok, receipt } or { ok: false, reason })
 * - match(request): the server's answer for one read (requestReceiptMatch)
 * - onDeviceNote(reason): says once that the rest are read on this device
 * - onPrepared(id, file, prepared): the photo was made small (size notes)
 * - today, householdCurrency, prepare?, deviceReader?
 */
export async function runReceiptQueue(key, deps) {
  if (running.has(key)) return;
  running.add(key);
  const device = deps.deviceReader ?? createDeviceReader();
  const prepare = deps.prepare ?? prepareReceiptImage;
  try {
    for (let item = nextWaitingReceipt(deps.read()); item; item = nextWaitingReceipt(deps.read())) {
      const id = item.id;
      deps.update((current) => markReceiptReading(current, id));
      const file = photos.get(id);
      let read = null;
      if (file) {
        let prepared = null;
        try {
          prepared = await prepare(file);
        } catch {
          prepared = null;
          deps.onPrepareFailed?.(id);
        }
        if (prepared) {
          deps.onPrepared?.(id, file, prepared);
          let reason = "";
          if (!deps.read()?.readOnDevice) {
            const result = await deps.readReceipt(prepared.blob).catch(() => ({ ok: false, reason: "failed" }));
            read = result.ok ? result.receipt : null;
            reason = result.ok ? "" : result.reason ?? "failed";
            if (!result.ok && readerIsOff(reason)) {
              deps.update(markReadOnDevice);
              if (!deps.read()?.deviceNoted) {
                deps.update(markDeviceNoted);
                deps.onDeviceNote?.(reason);
              }
            }
          }
          if (!hasUsableRead(read)) {
            read = await device.read(prepared.blob, deps.today).catch(() => null);
          }
        }
      }
      if (!findReceipt(deps.read(), id)) continue;
      if (!hasUsableRead(read)) {
        deps.update((current) => markReceiptFailed(current, id));
        continue;
      }
      // Read: the photo is discarded.
      photos.delete(id);
      deps.update((current) => markReceiptRead(current, id, read));
      const request = matchRequestOf(read, { householdCurrency: deps.householdCurrency, noteLines: matchNoteLines(read) });
      const match = request ? await deps.match(request) : { kind: "none" };
      deps.update((current) => setReceiptMatch(current, id, match));
    }
  } finally {
    running.delete(key);
    await device.close().catch(() => undefined);
  }
}

export function isReceiptQueueRunning(key) {
  return running.has(key);
}
