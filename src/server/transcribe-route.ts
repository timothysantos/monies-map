// /api/ai-assist/transcribe: the Ask page's voice fallback (docs/flows/ask-flow.md,
// "Voice input"). The browser's own speech recognition comes first and sends
// nothing here; this route is used only when the browser has none.
//
// - GET answers { ok, available } (plus the caps when available), so the
//   client knows before recording whether to offer the fallback at all. It
//   calls no AI and uses no allowance.
// - POST takes one short clip the person recorded by holding or tapping the
//   mic, as multipart form data: an "audio" part and a "durationMs" field.
//   The clip is written down once by Workers AI speech-to-text and dropped:
//   it is never stored, logged or cached, and neither are the words. The only
//   write is the shared daily allowance counter (1 unit).
//
// Answers:
// - 200 { ok, available: true, text, remaining }
// - 200 { ok, available: false, code, reason } when AI is off or unconfigured
//   (code "off"), over its allowance ("allowance") or failing ("failed").
// - 400 / 413 / 415 { ok: false, error } for a missing, too long or
//   unsupported clip, before any AI call or allowance use.

import { reserveDailyAiBudget, type AiAssistEnv } from "../domain/ai-assistance";
import { json } from "./json";
import { readFormBody, RequestBodyTooLargeError } from "./limited-body";

// Workers AI's Whisper large v3 turbo: base64 audio in, { text } out.
export const TRANSCRIBE_MODEL = "@cf/openai/whisper-large-v3-turbo";
// The client records at most 30 s; allow a little for the recorder stopping.
export const TRANSCRIBE_MAX_DURATION_MS = 31_000;
// 30 s of speech is about 120 KB of Opus at 32 kbit/s and under 500 KB of
// AAC at iPhone Safari's default bitrate.
export const TRANSCRIBE_AUDIO_MAX_BYTES = 1_048_576;
// The multipart wrapper around the clip.
const MAX_REQUEST_BYTES = TRANSCRIBE_AUDIO_MAX_BYTES + 16 * 1024;
const MAX_TEXT_LENGTH = 500;
const TRANSCRIBE_UNITS = 1;

const AUDIO_TYPES = new Map<string, AudioContainer>([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "mp4"],
  ["audio/x-m4a", "mp4"],
  ["audio/m4a", "mp4"],
  ["audio/aac", "mp4"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/wave", "wav"]
]);

type AudioContainer = "webm" | "ogg" | "mp4" | "wav";
type TranscribeEnv = AiAssistEnv & { DB: D1Database };

const UNSUPPORTED = "Only a short voice clip can be written down.";
const TOO_LONG = "The voice clip is too long. Keep it under 30 seconds.";

class ClipError extends Error {
  constructor(readonly status: 400 | 413 | 415, message: string) {
    super(message);
  }
}

function offReason(env: TranscribeEnv) {
  if (env.AI_ASSIST_ENABLED !== "true") {
    return "AI assistance is turned off.";
  }
  if (!env.AI) {
    return "AI assistance is not configured for this environment.";
  }
  return "";
}

export async function handleTranscribe(request: Request, env: TranscribeEnv): Promise<Response> {
  const off = offReason(env);
  if (request.method === "GET") {
    return json(off
      ? { ok: true, available: false }
      : { ok: true, available: true, maxSeconds: 30, maxBytes: TRANSCRIBE_AUDIO_MAX_BYTES });
  }
  if (off) {
    return json({ ok: true, available: false, code: "off", reason: off });
  }

  let audioBase64: string;
  try {
    audioBase64 = await readClip(request);
  } catch (error) {
    if (error instanceof ClipError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: TOO_LONG }, 413);
    }
    return json({ ok: false, error: "The voice clip could not be read." }, 400);
  }

  let budget: { available: boolean; reason?: string; remaining?: number };
  try {
    budget = await reserveDailyAiBudget(env.DB, env, TRANSCRIBE_UNITS);
  } catch {
    return json({ ok: true, available: false, code: "failed", reason: "AI assistance is temporarily unavailable." });
  }
  if (!budget.available) {
    return json({ ok: true, available: false, code: "allowance", reason: budget.reason, remaining: budget.remaining });
  }

  let text = "";
  try {
    const output = await env.AI!.run(TRANSCRIBE_MODEL as Parameters<Ai["run"]>[0], {
      audio: audioBase64,
      task: "transcribe",
      language: "en",
      vad_filter: true
    } as never);
    text = readTranscript(output);
  } catch {
    text = "";
  }
  if (!text) {
    return json({ ok: true, available: false, code: "failed", reason: "The voice clip could not be written down.", remaining: budget.remaining });
  }
  return json({ ok: true, available: true, text, remaining: budget.remaining });
}

async function readClip(request: Request) {
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    throw new ClipError(415, UNSUPPORTED);
  }
  // Counted as it arrives, so a chunked upload with no Content-Length is cut off too.
  const form = await readFormBody(request, MAX_REQUEST_BYTES);
  const file = form.get("audio");
  if (!file || typeof file === "string" || !file.size) {
    throw new ClipError(400, "No voice clip was sent.");
  }
  const container = AUDIO_TYPES.get(file.type.split(";")[0].trim().toLowerCase());
  if (!container) {
    throw new ClipError(415, UNSUPPORTED);
  }
  if (file.size > TRANSCRIBE_AUDIO_MAX_BYTES) {
    throw new ClipError(413, TOO_LONG);
  }
  const durationField = form.get("durationMs");
  const durationMs = typeof durationField === "string" && /^\d+$/.test(durationField.trim()) ? Number(durationField) : NaN;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new ClipError(400, "The voice clip's length is missing.");
  }
  if (durationMs > TRANSCRIBE_MAX_DURATION_MS) {
    throw new ClipError(413, TOO_LONG);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > TRANSCRIBE_AUDIO_MAX_BYTES) {
    throw new ClipError(413, TOO_LONG);
  }
  // The clip's own bytes must agree with its declared type, so a renamed
  // image or document never reaches the model.
  if (sniffContainer(bytes) !== container) {
    throw new ClipError(415, UNSUPPORTED);
  }
  // An MP4 says how long it is; trust that over the browser's figure.
  const containerSeconds = container === "mp4" ? readMp4DurationSeconds(bytes) : null;
  if (containerSeconds !== null && containerSeconds * 1000 > TRANSCRIBE_MAX_DURATION_MS) {
    throw new ClipError(413, TOO_LONG);
  }
  return encodeBase64(bytes);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function sniffContainer(bytes: Uint8Array): AudioContainer | null {
  if (bytes.byteLength < 12) {
    return null;
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "webm";
  }
  if (ascii(bytes, 0, 4) === "OggS") {
    return "ogg";
  }
  if (ascii(bytes, 4, 8) === "ftyp") {
    return "mp4";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") {
    return "wav";
  }
  return null;
}

// The movie header's duration, from moov > mvhd. Null when the clip does not
// carry one where it can be read (the declared duration still applies).
function readMp4DurationSeconds(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const findBox = (type: string, start: number, end: number): { start: number; end: number } | null => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      let header = 8;
      if (size === 1 && offset + 16 <= end) {
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) {
        return null;
      }
      if (ascii(bytes, offset + 4, offset + 8) === type) {
        return { start: offset + header, end: offset + size };
      }
      offset += size;
    }
    return null;
  };
  const moov = findBox("moov", 0, bytes.byteLength);
  const mvhd = moov ? findBox("mvhd", moov.start, moov.end) : null;
  if (!mvhd || mvhd.end - mvhd.start < 20) {
    return null;
  }
  const version = bytes[mvhd.start];
  if (version === 1) {
    if (mvhd.end - mvhd.start < 32) {
      return null;
    }
    const timescale = view.getUint32(mvhd.start + 20);
    const duration = Number(view.getBigUint64(mvhd.start + 24));
    return timescale ? duration / timescale : null;
  }
  const timescale = view.getUint32(mvhd.start + 12);
  const duration = view.getUint32(mvhd.start + 16);
  return timescale ? duration / timescale : null;
}

function readTranscript(output: unknown) {
  const text = output && typeof output === "object" && "text" in output ? (output as { text?: unknown }).text : null;
  if (typeof text !== "string") {
    return "";
  }
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH).trim();
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
