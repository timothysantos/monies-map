// POST /api/ai-assist/receipt-read (DOMAIN.md, "Receipt Read").
//
// Takes one receipt image the user explicitly pasted, dropped, scanned or
// shared, as multipart form data (field "image") or JSON
// { image: { mediaType, base64 } }. The client must downscale it and strip
// EXIF and location data before sending; a PDF receipt is sent as one
// rendered page image. The image is read once by the optional AI provider
// and discarded: it is never stored, logged or cached here, and the
// gateway call has logging and caching off.
//
// Answers:
// - 200 { ok, available: true, receipt: ReceiptReadDto, provider, remaining }
// - 200 { ok, available: false, reason } when AI is off, unconfigured, over
//   its allowance or failing; the client then runs in-browser OCR
//   (readReceiptOcrText) on the same image.
// - 400 / 413 / 415 { ok: false, error } for a missing, oversized or
//   unsupported image, before any AI call or allowance use.

import { getAiProviderUnavailableReason, runVisionJson, type AiImageMediaType, type AiProviderEnv } from "../domain/ai-provider";
import { finalizeReceiptRead, RECEIPT_READ_JSON_SCHEMA, RECEIPT_READ_PROMPT } from "../domain/receipt-read";
import type { ReceiptReadDto } from "../types/dto";
import { json } from "./json";
import { readFormBody, readJsonBody, RequestBodyTooLargeError } from "./limited-body";
import { RECEIPT_IMAGE_MAX_BYTES } from "../domain/request-limits";

// 1.5 MiB after the client downscales; a phone photo resized to about
// 1600 px on the long side is well under this.
export { RECEIPT_IMAGE_MAX_BYTES };
// Base64 grows by a third; allow for the JSON or multipart wrapper.
const MAX_REQUEST_BYTES = Math.ceil(RECEIPT_IMAGE_MAX_BYTES * 4 / 3) + 16 * 1024;
// Enough for 30 line items plus the fields; Claude adds thinking headroom.
const RECEIPT_MAX_TOKENS = 1200;

type ReceiptReadEnv = AiProviderEnv & { DB: D1Database };

class ReceiptImageError extends Error {
  constructor(readonly status: 400 | 413 | 415, message: string) {
    super(message);
  }
}

export async function handleReceiptRead(request: Request, env: ReceiptReadEnv): Promise<Response> {
  const offReason = getAiProviderUnavailableReason(env);
  if (offReason) {
    return json({ ok: true, available: false, reason: offReason });
  }

  let image: { mediaType: AiImageMediaType; base64: string };
  try {
    image = await readReceiptImage(request);
  } catch (error) {
    if (error instanceof ReceiptImageError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: "The receipt image is too large." }, 413);
    }
    return json({ ok: false, error: "The receipt image could not be read." }, 400);
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = await runVisionJson<ReceiptReadDto>(env.DB, env, {
    capability: "receipt_read",
    images: [image],
    prompt: RECEIPT_READ_PROMPT,
    schema: RECEIPT_READ_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: RECEIPT_MAX_TOKENS,
    parse: (value) => finalizeReceiptRead(value, { today, source: "ai" })
  });
  if (!result.available || !result.value) {
    return json({ ok: true, available: false, reason: result.reason, remaining: result.remaining });
  }
  return json({ ok: true, available: true, receipt: result.value, provider: result.provider, remaining: result.remaining });
}

async function readReceiptImage(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let mediaType: string;
  let bytes: Uint8Array;
  if (contentType.startsWith("multipart/form-data")) {
    // Counted as it arrives, so a chunked upload with no Content-Length is cut off too.
    const form = await readFormBody(request, MAX_REQUEST_BYTES);
    const file = form.get("image");
    if (!file || typeof file === "string") {
      throw new ReceiptImageError(400, "No receipt image was sent.");
    }
    mediaType = file.type;
    assertSupportedType(mediaType);
    if (file.size > RECEIPT_IMAGE_MAX_BYTES) {
      throw new ReceiptImageError(413, "The receipt image is too large.");
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const body = await readJsonBody(request, MAX_REQUEST_BYTES) as { image?: { mediaType?: unknown; base64?: unknown } } | null;
    const base64 = typeof body?.image?.base64 === "string" ? body.image.base64.replace(/^data:[^,]*,/, "").trim() : "";
    mediaType = typeof body?.image?.mediaType === "string" ? body.image.mediaType : "";
    if (!body?.image) {
      throw new ReceiptImageError(400, "No receipt image was sent.");
    }
    assertSupportedType(mediaType);
    if (!base64) {
      throw new ReceiptImageError(400, "No receipt image was sent.");
    }
    if (base64.length > Math.ceil(RECEIPT_IMAGE_MAX_BYTES / 3) * 4) {
      throw new ReceiptImageError(413, "The receipt image is too large.");
    }
    bytes = decodeBase64(base64);
  }

  if (bytes.byteLength > RECEIPT_IMAGE_MAX_BYTES) {
    throw new ReceiptImageError(413, "The receipt image is too large.");
  }
  if (sniffImageType(bytes) !== mediaType) {
    throw new ReceiptImageError(415, "Only JPEG, PNG or WebP receipt images are supported.");
  }
  return { mediaType: mediaType as AiImageMediaType, base64: encodeBase64(bytes) };
}

function assertSupportedType(mediaType: string) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    throw new ReceiptImageError(415, "Only JPEG, PNG or WebP receipt images are supported.");
  }
}

// The file's own bytes must agree with its declared type, so a renamed
// PDF or GIF never reaches a provider.
function sniffImageType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) {
    return "image/png";
  }
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.byteLength >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function decodeBase64(base64: string) {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new ReceiptImageError(400, "The receipt image could not be read.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
