// The Bring files status box (src/client/import-upload-status.js): files
// queued but not reviewed wait in the butter tone and open the queue; the
// other tones keep their look and words.
import assert from "node:assert/strict";
import test from "node:test";

import { describeUploadStatus } from "../src/client/import-upload-status.js";

test("files added to the queue wait for review and open the queue", () => {
  assert.deepEqual(describeUploadStatus({ tone: "waiting", message: "3 files added to the intake queue." }, { hasWaitingFiles: true }), {
    tone: "waiting",
    title: "Waiting for review",
    message: "3 files added to the intake queue.",
    role: "status",
    opensQueue: true
  });
});

test("reading, a parsed file ready and an error keep their tones and words", () => {
  assert.deepEqual(describeUploadStatus({ tone: "active", message: "Reading a.pdf." }), {
    tone: "active", title: "Working", message: "Reading a.pdf.", role: "status", opensQueue: false
  });
  assert.deepEqual(describeUploadStatus({ tone: "success", message: "a.csv is loaded. Review the mapping below." }), {
    tone: "success", title: "Ready", message: "a.csv is loaded. Review the mapping below.", role: "status", opensQueue: false
  });
  assert.deepEqual(describeUploadStatus({ tone: "error", message: "Statement import failed." }), {
    tone: "error", title: "Import needs attention", message: "Statement import failed.", role: "alert", opensQueue: false
  });
});

test("with nothing left waiting, a waiting status shows nothing, and no status is no box", () => {
  assert.equal(describeUploadStatus({ tone: "waiting", message: "3 files added to the intake queue." }, { hasWaitingFiles: false }), null);
  assert.equal(describeUploadStatus({ tone: "waiting", message: "3 files added to the intake queue." }), null);
  assert.equal(describeUploadStatus(null), null);
});
