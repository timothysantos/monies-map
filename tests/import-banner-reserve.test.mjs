// The room kept for the import banner (import-banner-reserve.js): a device that
// remembers the banner keeps its real height; one that has never seen it keeps
// the usual room on a wide screen only (a phone never fetches Imports for the
// banner); blocked or odd storage never throws.
import assert from "node:assert/strict";
import test from "node:test";

import { GUESSED_RESERVE_MS, IMPORT_BANNER_HEIGHT_KEY, initialBannerReserve, readRememberedBannerHeight } from "../src/client/import-banner-reserve.js";

const storageWith = (value) => ({ getItem: (key) => (key === IMPORT_BANNER_HEIGHT_KEY ? value : null) });

test("a device that has seen the banner keeps exactly its height, on any width", () => {
  assert.deepEqual(initialBannerReserve({ storage: storageWith("74"), phone: false, width: 1440 }), { height: 74, guessed: false });
  assert.deepEqual(initialBannerReserve({ storage: storageWith("131"), phone: true, width: 390 }), { height: 131, guessed: false });
  // A stored 0 means "no banner last time": nothing is kept, and nothing is guessed.
  assert.deepEqual(initialBannerReserve({ storage: storageWith("0"), phone: false, width: 1440 }), { height: 0, guessed: false });
});

test("a first visit on a wide screen keeps the usual room as a guess: one line from 1,100px, two below", () => {
  assert.deepEqual(initialBannerReserve({ storage: storageWith(null), phone: false, width: 1440 }), { height: 74, guessed: true });
  assert.deepEqual(initialBannerReserve({ storage: storageWith(null), phone: false, width: 1100 }), { height: 74, guessed: true });
  assert.deepEqual(initialBannerReserve({ storage: storageWith(null), phone: false, width: 900 }), { height: 95, guessed: true });
});

test("a first visit on a phone keeps nothing: no warmup fetches the answer there", () => {
  assert.deepEqual(initialBannerReserve({ storage: storageWith(null), phone: true, width: 390 }), { height: 0, guessed: false });
});

test("blocked, empty or nonsense storage is a first visit and never throws", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); } };
  assert.equal(readRememberedBannerHeight(blocked), null);
  assert.equal(readRememberedBannerHeight(null), null);
  assert.equal(readRememberedBannerHeight(storageWith("")), null);
  assert.equal(readRememberedBannerHeight(storageWith("tall")), null);
  assert.equal(readRememberedBannerHeight(storageWith("-5")), null);
  assert.equal(readRememberedBannerHeight(storageWith("9000")), 400, "never more than a banner can be");
  assert.deepEqual(initialBannerReserve({ storage: blocked, phone: false, width: 1440 }), { height: 74, guessed: true });
});

test("a guessed room is given back after a short wait if no answer comes", () => {
  assert.ok(GUESSED_RESERVE_MS >= 5_000 && GUESSED_RESERVE_MS <= 15_000);
});
