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
// (ocr-worker.js) reads the text and parseReceiptText
// picks out the shop, total, date and card ending. It loads only when used.

export const RECEIPT_MAX_EDGE = 1600;
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

export async function readReceiptOnDevice(blob, { today = undefined, onProgress = undefined } = {}) {
  const { createOcrWorker } = await import("./ocr-worker");
  const worker = await createOcrWorker(onProgress);
  try {
    const result = await worker.recognize(blob);
    return parseReceiptText(result?.data?.text ?? "", { today });
  } finally {
    await worker.terminate();
  }
}

const MONEY = /(?:S\$|\$|SGD\s*)?(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+\.\d{2})\b/g;
const TOTAL_LINE = /\b(grand\s+total|total\s+due|amount\s+due|total\s+amount|nett?\s+total|total|amount\s+paid|balance\s+due)\b/i;
const NOT_TOTAL_LINE = /\b(sub\s*-?\s*total|subtotal|total\s+qty|total\s+items?|savings|discount|change|gst\s+total|tax)\b/i;
const NOT_MERCHANT_LINE = /\b(tax\s+invoice|receipt|invoice|gst\s+reg|uen|tel|phone|date|time|table|cashier|order|www\.|http)\b/i;

function toMinor(text) {
  const value = Number(String(text).replace(/,/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

function amountsIn(line) {
  return [...line.matchAll(MONEY)].map((match) => toMinor(match[1])).filter((value) => value !== null);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoFrom(year, month, day) {
  const fullYear = year < 100 ? 2000 + year : year;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const iso = `${fullYear}-${pad(month)}-${pad(day)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.getUTCDate() === day ? iso : null;
}

function daysBetween(left, right) {
  return Math.round((new Date(`${right}T00:00:00Z`).getTime() - new Date(`${left}T00:00:00Z`).getTime()) / 86_400_000);
}

// Day-first, as receipts in Singapore print them; a date that also reads
// month-first is offered as the other choice.
function findDate(lines, today) {
  for (const line of lines) {
    const iso = line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (iso) {
      const value = isoFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      if (value) return { value, candidates: [] };
    }
    const dmy = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (dmy) {
      const [first, second, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
      const dayFirst = isoFrom(year, second, first);
      const monthFirst = isoFrom(year, first, second);
      const usable = [dayFirst, monthFirst].filter((value) => value && (!today || daysBetween(value, today) >= -1));
      const unique = [...new Set(usable)];
      if (unique.length) return { value: unique[0], candidates: unique.length > 1 ? unique : [] };
    }
  }
  return { value: null, candidates: [] };
}

export function parseReceiptText(text, { today = undefined } = {}) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const merchantLine = lines.find((line) => /[a-z]{3,}/i.test(line) && !NOT_MERCHANT_LINE.test(line) && amountsIn(line).length === 0);

  let totalMinor = null;
  for (const line of lines) {
    if (TOTAL_LINE.test(line) && !NOT_TOTAL_LINE.test(line)) {
      const amounts = amountsIn(line);
      if (amounts.length) {
        // The last labelled total wins (a grand total follows the total).
        totalMinor = amounts[amounts.length - 1];
      }
    }
  }
  if (totalMinor === null) {
    const all = lines.flatMap(amountsIn).filter((value) => value > 0);
    totalMinor = all.length ? Math.max(...all) : null;
  }

  const date = findDate(lines, today);
  const card = String(text ?? "").match(/(?:\*{2,}|x{3,}|ending(?:\s+in)?|card\s*(?:no\.?|number)?\s*[:#]?\s*[*x]*)\s*(\d{4})\b/i);
  const questions = [];
  if (!merchantLine) questions.push({ field: "merchant", reason: "missing" });
  if (totalMinor === null) questions.push({ field: "total", reason: "missing" });
  if (!date.value) questions.push({ field: "date", reason: "missing" });
  else if (date.candidates.length) questions.push({ field: "date", reason: "ambiguous", candidates: date.candidates });

  return {
    source: "ocr",
    merchant: { value: merchantLine ?? null, confidence: merchantLine ? "medium" : "low" },
    date: { value: date.value, confidence: date.candidates.length ? "low" : date.value ? "medium" : "low" },
    total: { amountMinor: totalMinor, currency: null, confidence: totalMinor === null ? "low" : "medium" },
    cardLast4: card ? card[1] : null,
    lineItems: [],
    questions
  };
}
