export function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return jsonFromText(serializeJson(payload), status, headers);
}

// Split out so a caller can time serialization before building the response.
export function serializeJson(payload: unknown) {
  return JSON.stringify(payload, null, 2);
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
