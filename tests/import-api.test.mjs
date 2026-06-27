import assert from "node:assert/strict";
import test from "node:test";

import { previewImportBatch } from "../src/client/import-api.js";

test("previewImportBatch surfaces JSON server errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ ok: false, error: "Unknown account: UOB One Card" }),
    { status: 400, headers: { "content-type": "application/json" } }
  );

  try {
    await assert.rejects(
      () => previewImportBatch({
        sourceLabel: "test",
        sourceType: "csv",
        rows: [],
        ownershipType: "direct",
        ownerName: "Tim",
        splitPercent: "50",
        statementCheckpoints: []
      }),
      /Unknown account: UOB One Card/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("previewImportBatch includes HTTP context for non-JSON failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    "<html><body><h1>Service Unavailable</h1><p>edge timeout</p></body></html>",
    { status: 503, statusText: "Service Unavailable", headers: { "content-type": "text/html" } }
  );

  try {
    await assert.rejects(
      () => previewImportBatch({
        sourceLabel: "test",
        sourceType: "csv",
        rows: [],
        ownershipType: "direct",
        ownerName: "Tim",
        splitPercent: "50",
        statementCheckpoints: []
      }),
      /Import preview failed\. HTTP 503 Service Unavailable: Service Unavailable edge timeout/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
