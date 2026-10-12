// A receipt photo on the Ask page: made small and clean in this browser
// before anything reads it, and read on this device when the receipt reader
// is unavailable.
//
// prepareReceiptImage redraws the photo on a canvas (turned upright from its
// EXIF orientation) no larger than RECEIPT_MAX_EDGE px and re-encodes it as
// JPEG. A canvas keeps only pixels, so the result carries no EXIF block: no
// GPS position, camera or time stamp leaves the phone. The original file is
// never sent or kept; the page holds the small copy in memory for its
// thumbnail and drops it when the card goes.
//
// readReceiptOnDevice is the fallback: the app's own Tesseract worker
// (ocr-worker.js) reads the text and the shared no-AI receipt reader
// (src/domain/receipt-ocr-text.ts, via readReceiptTextOnDevice) turns it
// into the same receipt read the AI reader returns. It loads only when used.

import { readReceiptOcrText } from "../domain/receipt-ocr-text";

export const RECEIPT_MAX_EDGE = 1600;
// The household's own currency: a receipt that prints no currency is read
// as this one, so it raises no "currency missing" question. A printed
// currency (Rp, US$, ...) still wins.
const HOUSEHOLD_CURRENCY = "SGD";
const RECEIPT_JPEG_QUALITY = 0.85;

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older Safari: fall back to an <img>, which also applies orientation.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fitWithin(width, height, maxEdge = RECEIPT_MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function prepareReceiptImage(file) {
  if (!file || !String(file.type ?? "").startsWith("image/")) {
    throw new Error("That file is not a photo.");
  }
  const source = await decodeImage(file);
  const { width, height } = fitWithin(source.width, source.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("This browser could not prepare the photo.");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  if ("close" in source) {
    source.close();
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", RECEIPT_JPEG_QUALITY));
  if (!blob) {
    throw new Error("This browser could not prepare the photo.");
  }
  return { blob, width, height };
}

// OCR text -> receipt read, or null when nothing on it reads as a receipt.
export function readReceiptTextOnDevice(text, { today, defaultCurrency = HOUSEHOLD_CURRENCY }) {
  return readReceiptOcrText(String(text ?? ""), { today, defaultCurrency });
}

export async function readReceiptOnDevice(blob, { today, onProgress = undefined }) {
  const { createOcrWorker } = await import("./ocr-worker");
  const worker = await createOcrWorker(onProgress);
  try {
    const result = await worker.recognize(blob);
    return readReceiptTextOnDevice(result?.data?.text ?? "", { today });
  } finally {
    await worker.terminate();
  }
}
