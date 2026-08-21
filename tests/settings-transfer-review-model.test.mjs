import assert from "node:assert/strict";
import test from "node:test";

import { buildSettingsTransferReviewModel } from "../src/client/settings-transfer-review-model.js";

const transfer = (entryId, date, overrides = {}) => ({
  entryId,
  date,
  description: `Transfer ${entryId}`,
  accountName: "OCBC 360",
  amountMinor: 1000,
  transferDirection: "out",
  ...overrides
});

test("settings transfer review model defaults to newest month and paginates inside that month", () => {
  const transfers = [
    transfer("a", "2026-08-20"),
    transfer("b", "2026-08-19"),
    transfer("c", "2026-07-12"),
    transfer("d", "2026-06-01")
  ];

  const model = buildSettingsTransferReviewModel(transfers, undefined, 1, 1);

  assert.deepEqual(model.monthGroups, [
    { month: "2026-08", count: 2 },
    { month: "2026-07", count: 1 },
    { month: "2026-06", count: 1 }
  ]);
  assert.equal(model.activeMonth, "2026-08");
  assert.equal(model.activeTransfers.length, 2);
  assert.equal(model.visibleTransfers.length, 1);
  assert.equal(model.pageCount, 2);
});

test("settings transfer review model honors a selected month and counts shortened descriptions", () => {
  const transfers = [
    transfer("a", "2026-08-20"),
    transfer("b", "2026-07-12", { descriptionTruncated: true }),
    transfer("c", "2026-07-01", { descriptionTruncated: true })
  ];

  const model = buildSettingsTransferReviewModel(transfers, "2026-07", 3, 6);

  assert.equal(model.activeMonth, "2026-07");
  assert.deepEqual(model.visibleTransfers.map((item) => item.entryId), ["b", "c"]);
  assert.equal(model.currentPage, 1);
  assert.equal(model.truncatedDescriptionCount, 2);
});
