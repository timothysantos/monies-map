export function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return jsonFromText(serializeJson(payload), status, headers);
}

// Split out so a caller can time serialization before building the response.
// Compact: indentation added about 30% to every body (12% after gzip) and
// no client reads the raw text.
export function serializeJson(payload: unknown) {
  return JSON.stringify(payload);
}

export function jsonFromText(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}
