// Bank alerts (DOMAIN.md "Bank Alert"): a bank's alert completes a waiting
// tap through the same all-or-nothing save as Entries' Save (the entry, its
// audit line, the tap's completion and its audit line, the month refresh
// marker in one batch). A failure at any of those statements leaves the
// database exactly as it was and the tap waiting. Real local D1, demo
// household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase
} from "./support/d1-workspace.mjs";
import { enableShortcut, TOKEN } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const CREATE = `/api/shortcuts/entries/create?shortcut_token=${TOKEN}`;
const ALERT = `/api/shortcuts/alerts/bank?shortcut_token=${TOKEN}`;
const alertBody = () => ({
  text: "A transaction of SGD 22.94 was made with your UOB Card ending 8073 on 05/10/26 at PERIPLUS BALI.",
  receivedAt: new Date().toISOString(),
  requestId: "bank-alert-20261005120130000",
  clientVersion: "bank-alert-2026-11-17-v1"
});

const failures = [
  ["the entry", /INSERT INTO transactions/, 0],
  ["the entry's audit line", /INSERT INTO audit_events/, 0],
  ["the tap's completion", /UPDATE waiting_taps\s+SET status = 'completed'/, 0],
  ["the completion's audit line", /INSERT INTO audit_events/, 1],
  ["the month refresh marker", /monthly_snapshot_refreshes/, 0]
];

for (const [what, pattern, skip] of failures) {
  test(`a bank alert completing a tap: a failure on ${what} saves no entry and the tap still waits`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    await enableShortcut(db);
    const held = await api(CREATE, {
      date: "2026-10-05", description: "Periplus Bali", name: "UOB One", requestId: "apple-pay-20261005120000000",
      clientVersion: "apple-pay-api-2026-11-17-v8", amount: ""
    });
    assert.equal(held.status, 202, JSON.stringify(held.payload));
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });
    const reply = await api(ALERT, alertBody(), { database: faulty.db });
    assert.equal(faulty.state.fired, true);
    assert.notEqual(reply.status, 200);
    assert.equal(reply.payload.completed ?? false, false);
    assertSameDatabase(await dumpDatabase(db), before);

    // Sent again once the fault is gone, it completes the tap.
    const retried = await api(ALERT, alertBody());
    assert.deepEqual([retried.status, retried.payload.completed], [200, true]);
  });
}
