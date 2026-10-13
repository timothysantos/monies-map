// Reads a request body up to a byte limit and stops there. A route's
// Content-Length check only helps when the client sends that header; a
// chunked upload has none, and request.json() / request.formData() would
// buffer all of it. These helpers count the bytes as they arrive, so an
// oversized body is cut off at the limit, before any parsing, allowance use
// or AI call.

export class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super("The request is too large.");
  }
}

// The body's bytes, or RequestBodyTooLargeError past `maxBytes`.
export async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }
  if (!request.body) {
    return new Uint8Array(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// The parsed JSON body, or null when it is not valid JSON.
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBodyBytes(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// The parsed JSON body as an object: {} when it is not valid JSON or not an
// object, so a route reads its fields from it without a null check.
export async function readJsonObject<T extends object>(request: Request, maxBytes: number): Promise<Partial<T>> {
  const parsed = await readJsonBody(request, maxBytes);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Partial<T> : {};
}

// The multipart form body, parsed after its size is known to be within the limit.
export async function readFormBody(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBodyBytes(request, maxBytes);
  return new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
}

// A JSON request for the small AI routes: a question, a sentence, an amount.
// Real bodies are a few hundred bytes; 64 KiB is far past any of them.
export const SMALL_JSON_MAX_BYTES = 64 * 1024;
