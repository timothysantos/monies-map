import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildShortcutAppUrl,
  isShortcutGatewayRequestAllowed
} from "../src/server/shortcut-gateway.ts";

const SHORTCUT_ENDPOINT_PATH = "/api/shortcuts/entries/create";

test("shortcut-only gateway rejects every route except the direct-create endpoint", () => {
  assert.equal(isShortcutGatewayRequestAllowed("true", SHORTCUT_ENDPOINT_PATH, SHORTCUT_ENDPOINT_PATH), true);
  assert.equal(isShortcutGatewayRequestAllowed("true", "/api/settings-page", SHORTCUT_ENDPOINT_PATH), false);
  assert.equal(isShortcutGatewayRequestAllowed("true", "/", SHORTCUT_ENDPOINT_PATH), false);
  assert.equal(isShortcutGatewayRequestAllowed(undefined, "/api/settings-page", SHORTCUT_ENDPOINT_PATH), true);
});

test("shortcut gateway response links resolve against the protected app origin", () => {
  const url = buildShortcutAppUrl(
    "/entries",
    "https://monies-map-shortcuts.example/api/shortcuts/entries/create",
    "https://monies-map.example"
  );
  assert.equal(url.toString(), "https://monies-map.example/entries");
});

test("production shortcut worker shares D1 but exposes no static assets", async () => {
  const [appConfig, shortcutConfig] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../wrangler.shortcuts.jsonc", import.meta.url), "utf8").then(JSON.parse)
  ]);

  assert.equal(shortcutConfig.name, "monies-map-shortcuts");
  assert.equal(shortcutConfig.vars.SHORTCUT_API_ONLY, "true");
  assert.equal(shortcutConfig.vars.SHORTCUT_APP_ORIGIN, "https://monies-map.timsantos-accts.workers.dev");
  assert.equal(shortcutConfig.assets, undefined);
  assert.equal(shortcutConfig.d1_databases[0].database_id, appConfig.d1_databases[0].database_id);
  assert.equal(
    appConfig.vars.SHORTCUT_PUBLIC_ENDPOINT,
    "https://monies-map-shortcuts.timsantos-accts.workers.dev/api/shortcuts/entries/create"
  );
});
