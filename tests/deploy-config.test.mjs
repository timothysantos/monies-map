import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Cloudflare Access protects the app's workers.dev address, which is the
// production URL (README "Production Auth"), so workers.dev must stay on.
// Version preview URLs are a second address per upload that the workers.dev
// Access setting does not cover, and no deploy script uses them.
test("the production app keeps its workers.dev address and has no preview URLs", async () => {
  const appConfig = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.notEqual(appConfig.workers_dev, false, "workers.dev is the Access-protected production address");
  assert.equal(appConfig.preview_urls, false);
});
