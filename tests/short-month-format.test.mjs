import assert from "node:assert/strict";
import test from "node:test";

import { formatDate, formatDateOnly, formatMonthLabel } from "../src/client/formatters.js";
import { formatArchiveDate } from "../src/client/split-helpers.js";
import { formatRowDateLabel } from "../src/client/table-helpers.js";
import { shortMonthText } from "../src/lib/short-month";

// Newer ICU data spells September "Sept" in en-SG; the app writes "Sep".
test("short month labels spell September as Sep everywhere the app formats one", () => {
  assert.equal(formatMonthLabel("2026-09"), "Sep 2026");
  assert.equal(formatMonthLabel("2026-08"), "Aug 2026");
  assert.match(formatDateOnly("2026-09-05"), /^5 Sep 2026$/);
  assert.equal(formatRowDateLabel({ dayLabel: "2026-09-05" }, "2026-09"), "5 Sep");
  assert.match(formatDate("2026-09-05T04:30:00Z"), /^5 Sep 2026/);
  assert.equal(formatArchiveDate("2026-09-05"), "05 Sep");
});

test("shortMonthText only rewrites the word Sept", () => {
  assert.equal(shortMonthText("Sept 2026"), "Sep 2026");
  assert.equal(shortMonthText("5 Sept"), "5 Sep");
  assert.equal(shortMonthText("September"), "September");
  assert.equal(shortMonthText("Jun 2026"), "Jun 2026");
});
