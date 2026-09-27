import assert from "node:assert/strict";
import test from "node:test";

import { fetchTextWithTransientWorkerRetry, fetchWithTimeout } from "../src/client/request-timeout.js";

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

// A response whose body only arrives when released; aborting the fetch signal
// during body reading must reject text() with AbortError.
function withMockFetch(implementation, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  return Promise.resolve().then(run).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test("an upstream abort after headers also stops body reading", async () => {
  await withMockFetch(async (_url, options = {}) => {
    const signal = options.signal;
    const body = new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError")));
      }
    });
    return new Response(body, { status: 200 });
  }, async () => {
    const upstream = new AbortController();
    const response = await fetchWithTimeout("/api/entries-page", { signal: upstream.signal }, "Entries page request");
    const reading = response.text();
    upstream.abort();
    await assert.rejects(reading, (error) => error.name === "AbortError");
  });
});

test("without an upstream signal, fetch still gets the timeout signal only", async () => {
  let seenSignal = null;
  await withMockFetch(async (_url, options = {}) => {
    seenSignal = options.signal;
    return new Response("{}", { status: 200 });
  }, async () => {
    await fetchWithTimeout("/api/entries-page", { maxAttempts: 1, requestLabel: "x" }, "Entries page request");
  });
  assert.ok(seenSignal instanceof AbortSignal);
  assert.equal(seenSignal.aborted, false);
});

test("transient Worker bodies retry three times for required work and once for speculative work", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => originalSetTimeout(callback, 0);
  try {
    let calls = 0;
    const transient = async () => {
      calls += 1;
      return new Response("Your worker restarted mid-request", { status: 503 });
    };
    await withMockFetch(transient, async () => {
      const required = await fetchTextWithTransientWorkerRetry("/api/month-page", { requestLabel: "Page request" });
      assert.equal(calls, 3);
      assert.equal(required.response.status, 503);
      calls = 0;
      const speculative = await fetchTextWithTransientWorkerRetry("/api/month-page", { requestLabel: "Page request", maxAttempts: 1 });
      assert.equal(calls, 1);
      assert.match(speculative.responseText, /worker restarted/);
    });
    calls = 0;
    await withMockFetch(async () => { calls += 1; return new Response('{"ok":true}', { status: 200 }); }, async () => {
      const result = await fetchTextWithTransientWorkerRetry("/api/month-page", {});
      assert.equal(calls, 1, "a normal body never retries");
      assert.equal(result.responseText, '{"ok":true}');
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});
