// Imports' side of files sent to Monies Map: which listed files a visit
// pulls (once each, in one order whatever order they arrived in) and the
// line that says how and when each arrived.
import assert from "node:assert/strict";
import test from "node:test";

import { describeWaitingFileArrival, selectWaitingFilesToPull } from "../src/client/waiting-files-model.js";
import { orderIntakeQueue } from "../src/client/import-intake-model.js";

const statement = { id: "waiting-b", fileName: "eStatement Apr 2026.pdf", fileKind: "pdf", arrivedVia: "shortcut", receivedAt: "2026-11-12T01:30:00.000Z" };
const activity = { id: "waiting-a", fileName: "ACC_TXN_History.xls", fileKind: "xls", arrivedVia: "shortcut", receivedAt: "2026-11-11T17:30:00.000Z" };

test("the files to pull come in one order, and a file is pulled once per visit", () => {
  assert.deepEqual(selectWaitingFilesToPull([statement, activity], new Set()).map((file) => file.id), ["waiting-a", "waiting-b"]);
  assert.deepEqual(selectWaitingFilesToPull([activity, statement], new Set()).map((file) => file.id), ["waiting-a", "waiting-b"]);
  assert.deepEqual(selectWaitingFilesToPull([activity, statement], new Set(["waiting-a"])).map((file) => file.id), ["waiting-b"]);
  assert.deepEqual(selectWaitingFilesToPull(undefined, new Set()), []);
  assert.deepEqual(selectWaitingFilesToPull([{ fileName: "no id.pdf" }], new Set()), []);
});

test("each sent file says how and when it arrived, in Singapore days", () => {
  assert.equal(describeWaitingFileArrival(statement), "Sent from your phone, 12 Nov");
  // 17:30 UTC on 11 Nov is 01:30 on 12 Nov in Singapore.
  assert.equal(describeWaitingFileArrival(activity), "Sent from your phone, 12 Nov");
  assert.equal(describeWaitingFileArrival({ ...statement, arrivedVia: "mailbox" }), "Sent to Monies Map, 12 Nov");
  assert.equal(describeWaitingFileArrival({ ...statement, receivedAt: "not a date" }), "Sent from your phone");
  assert.equal(describeWaitingFileArrival(undefined), "");
});

test("files that tie on kind and date are ordered by name, never by arrival", () => {
  const first = { id: "1", fileName: "b-activity.csv", sourceType: "csv", fingerprint: "x", parsed: { rows: [{ date: "2026-05-01" }] } };
  const second = { id: "2", fileName: "a-activity.csv", sourceType: "csv", fingerprint: "y", parsed: { rows: [{ date: "2026-05-01" }] } };
  assert.deepEqual(orderIntakeQueue([first, second]).map((item) => item.fileName), ["a-activity.csv", "b-activity.csv"]);
  assert.deepEqual(orderIntakeQueue([second, first]).map((item) => item.fileName), ["a-activity.csv", "b-activity.csv"]);
  // The kind and date still come first.
  const statementLater = { id: "3", fileName: "z.pdf", sourceType: "pdf", fingerprint: "z", parsed: { rows: [], checkpoints: [{ statementStartDate: "2026-06-01" }] } };
  assert.deepEqual(orderIntakeQueue([first, second, statementLater]).map((item) => item.fileName), ["z.pdf", "a-activity.csv", "b-activity.csv"]);
});
