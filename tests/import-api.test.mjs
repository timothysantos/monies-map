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

test("previewImportBatch records diagnostics for non-JSON failures", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/error-diagnostics/record") {
      return new Response(JSON.stringify({ ok: true, diagnosticId: "diagnostic-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      "<html><body><h1>Worker exceeded resource limits</h1><style>body{margin:0}</style></body></html>",
      { status: 503, statusText: "Service Unavailable", headers: { "content-type": "text/html" } }
    );
  };

  try {
    await assert.rejects(
      () => previewImportBatch({
        sourceLabel: "test",
        sourceType: "csv",
        rows: [],
        ownershipType: "direct",
        ownerName: "Tim",
        splitPercent: "50",
        statementCheckpoints: [],
        diagnosticContext: {
          action: "Preview import: test (0 rows, csv)",
          previousAction: "Upload file",
          requestContext: { rowCount: 0 }
        }
      }),
      (error) => {
        assert.match(error.message, /Cloudflare ended the request because the Worker exceeded resource limits/);
        assert.equal(error.diagnosticHref, "/settings?settings_section=errorDiagnostics");
        assert.equal(error.diagnosticId, "diagnostic-1");
        return true;
      }
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, "/api/error-diagnostics/record");
    const diagnosticPayload = JSON.parse(calls[1].options.body);
    assert.equal(diagnosticPayload.action, "Preview import: test (0 rows, csv)");
    assert.equal(diagnosticPayload.previousAction, "Upload file");
    assert.match(diagnosticPayload.responseBody, /Worker exceeded resource limits/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
