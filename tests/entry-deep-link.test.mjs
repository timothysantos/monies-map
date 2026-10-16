import assert from "node:assert/strict";
import test from "node:test";

import { buildEntryDeepLink } from "../src/client/entry-deep-link.js";

test("an entry link opens its exact entry in its recorded month and view", () => {
  assert.equal(
    buildEntryDeepLink({ origin: "https://monies-map.example" }, { entryId: "txn-123", month: "2026-10", viewId: "person-tim" }),
    "https://monies-map.example/entries?view=person-tim&month=2026-10&editing_entry=txn-123"
  );
});
