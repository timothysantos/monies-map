import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithTimeout } from "../src/client/request-timeout.js";

test("fetchWithTimeout rejects stalled requests with a visible timeout message", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { __MONIES_MAP_REQUEST_TIMEOUT_MS__: 10 };
  globalThis.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });

  try {
    await assert.rejects(
      fetchWithTimeout("/api/imports-page", { cache: "no-store" }, "Page request"),
      /Page request timed out after 10 ms\./
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});
